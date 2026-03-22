/**
 * Coordinates Raven search sessions, queueing, worker execution, persistence, and chapter downloads.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/library/NewChapter.java
 * - src/main/java/com/paxkun/raven/service/library/NewTitle.java
 * - src/main/java/com/paxkun/raven/service/settings/DownloadNamingSettings.java
 * - src/main/java/com/paxkun/raven/service/settings/DownloadVpnSettings.java
 * Times this file has been edited: 37
 */
package com.paxkun.raven.service;

import com.paxkun.raven.service.download.*;
import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import com.paxkun.raven.service.settings.DownloadNamingSettings;
import com.paxkun.raven.service.settings.DownloadVpnSettings;
import com.paxkun.raven.service.settings.SettingsService;
import com.paxkun.raven.service.vpn.VpnRuntimeStatus;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.openqa.selenium.StaleElementReferenceException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Coordinates Raven search sessions, queueing, worker execution, persistence, and chapter downloads.
 */

@Service
public class DownloadService {
    private static final String DOWNLOAD_WORKER_NAME_PREFIX = "raven-download-";
    private static final String EXECUTION_MODE_THREAD = "thread";
    private static final String EXECUTION_MODE_PROCESS = "process";
    private static final String DOWNLOADING_FOLDER_NAME = "downloading";
    private static final String DOWNLOADED_FOLDER_NAME = "downloaded";
    private static final String TASK_COLLECTION = "raven_download_tasks";
    private static final String CURRENT_TASK_REDIS_KEY = "raven:download:current-task";
    private static final long VAULT_SNAPSHOT_WARNING_COOLDOWN_MS = TimeUnit.SECONDS.toMillis(30);
    private static final long VPN_CONNECTION_WAIT_POLL_MS = 1000L;
    private static final long WORKER_SUPERVISOR_POLL_MS = 1000L;
    private static final int MAX_STATUS_HISTORY_ENTRIES = 10;
    private static final Set<String> ACTIVE_TASK_STATUSES = Set.of(
            "queued",
            "downloading",
            "recovering"
    );
    private static final Set<String> RESTORABLE_TASK_STATUSES = Set.of(
            "queued",
            "downloading",
            "recovering",
            "interrupted"
    );
    private static final Set<String> TERMINAL_STATUSES = Set.of(
            "completed",
            "failed",
            "interrupted",
            "cancelled",
            "canceled",
            "paused"
    );

    @Autowired private TitleScraper titleScraper;
    @Autowired private SourceFinder sourceFinder;
    @Autowired private LoggerService logger;
    @Autowired @Lazy private LibraryService libraryService;
    @Autowired
    private VaultService vaultService;
    @Autowired
    private SettingsService settingsService;
    @Autowired
    @Lazy
    private VPNServices vpnServices;
    private final Object processWorkerLock = new Object();
    private final Map<String, ActiveWorkerProcess> activeWorkerProcesses = new ConcurrentHashMap<>();
    private final Map<Integer, String> workerSlots = new ConcurrentHashMap<>();

    private static final String USER_AGENT = "Mozilla/5.0";
    private static final String REFERER = "https://weebcentral.com";

    @Value("${raven.download.threads:${RAVEN_DOWNLOAD_THREADS:3}}")
    private int configuredDownloadThreads;

    private ExecutorService executor;
    private final Map<String, Future<?>> activeDownloads = new ConcurrentHashMap<>();
    @Autowired(required = false)
    private RavenRuntimeProperties runtimeProperties = new RavenRuntimeProperties();
    @Autowired(required = false)
    private RavenWorkerLauncher workerLauncher = new RavenWorkerLauncher();
    @Autowired(required = false)
    private LinuxCpuAffinity cpuAffinity = new LinuxCpuAffinity();
    private ScheduledExecutorService workerSupervisor;
    private final AtomicBoolean maintenancePauseActive = new AtomicBoolean(false);
    private final Map<String, DownloadProgress> downloadProgress = new ConcurrentHashMap<>();
    private final Deque<DownloadProgress> progressHistory = new ConcurrentLinkedDeque<>();
    private final Map<String, SearchSession> searchSessions = new ConcurrentHashMap<>();
    private volatile long lastSnapshotWarningAtMs = 0L;

    private static final long SEARCH_TTL_MILLIS = TimeUnit.MINUTES.toMillis(10);
    private Supplier<Long> currentTimeSupplier = System::currentTimeMillis;

    private synchronized ExecutorService ensureExecutor() {
        if (isProcessWorkerMain()) {
            throw new IllegalStateException("Executor-backed downloads are disabled while Raven is supervising process workers.");
        }
        if (executor != null && !executor.isShutdown() && !executor.isTerminated()) {
            return executor;
        }

        int normalizedThreads = Math.max(1, configuredDownloadThreads);
        configuredDownloadThreads = normalizedThreads;
        AtomicInteger workerCounter = new AtomicInteger(1);
        executor = Executors.newFixedThreadPool(normalizedThreads, runnable -> {
            Thread thread = new Thread(runnable);
            thread.setName(DOWNLOAD_WORKER_NAME_PREFIX + workerCounter.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        });
        return executor;
    }

    /**
     * Handles init executor.
     */

    @PostConstruct
    public void initExecutor() {
        if (isWorkerMode()) {
            return;
        }

        if (isProcessWorkerMain()) {
            startWorkerSupervisor();
            // Restoring downloads can be a heavy operation that blocks startup.
            // Run it in a background thread to ensure Spring Boot starts quickly and health checks pass.
            CompletableFuture.runAsync(() -> {
                try {
                    restorePersistedDownloadsForProcessMode();
                    dispatchQueuedProcessWorkers();
                } catch (Exception e) {
                    logger.error("DOWNLOAD_SERVICE", "⚠️ Failed to async restore process-mode downloads", e);
                }
            });
            return;
        }

        ensureExecutor();
        // Offload restoration to avoid blocking Spring initialization
        CompletableFuture.runAsync(() -> {
            try {
                restorePersistedDownloadsForThreadMode();
            } catch (Exception e) {
                logger.error("DOWNLOAD_SERVICE", "⚠️ Failed to async restore thread-mode downloads", e);
            }
        });
    }

    /**
     * Handles shutdown executor.
     */

    @PreDestroy
    public void shutdownExecutor() {
        if (workerSupervisor != null) {
            workerSupervisor.shutdownNow();
        }

        synchronized (processWorkerLock) {
            for (ActiveWorkerProcess handle : activeWorkerProcesses.values()) {
                stopWorkerProcess(handle);
            }
            activeWorkerProcesses.clear();
            workerSlots.clear();
        }

        if (executor != null) {
            executor.shutdownNow();
        }
    }

    void restorePersistedDownloadsForThreadMode() {
        try {
            List<Map<String, Object>> docs = vaultService.findMany(
                    TASK_COLLECTION,
                    Map.of("status", Map.of("$in", new ArrayList<>(RESTORABLE_TASK_STATUSES)))
            );
            if (docs == null || docs.isEmpty()) {
                return;
            }

            List<DownloadProgress> persistedTasks = new ArrayList<>();
            for (Map<String, Object> doc : docs) {
                DownloadProgress progress = vaultService.parseJson(doc, DownloadProgress.class);
                if (progress == null) {
                    continue;
                }

                String titleName = progress.getTitle();
                String sourceUrl = progress.getSourceUrl();
                if (titleName == null || titleName.isBlank() || sourceUrl == null || sourceUrl.isBlank()) {
                    continue;
                }

                persistedTasks.add(progress);
            }

            persistedTasks.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt));
            for (DownloadProgress progress : persistedTasks) {
                String titleName = progress.getTitle();
                if (titleName == null || titleName.isBlank() || activeDownloads.containsKey(titleName)) {
                    continue;
                }

                if (progress.isPauseRequested()) {
                    progress.markPaused("Pause requested before download started. Task saved for later.");
                    persistTaskSnapshot(progress);
                    continue;
                }
                progress.markRecoveredFromCache("restored-from-vault");
                persistTaskSnapshot(progress);
                Future<?> future = submitThreadedDownload(titleName, buildSelectedTitle(progress), progress);
                downloadProgress.put(titleName, progress);
                activeDownloads.put(titleName, future);
            }
        } catch (Exception e) {
            logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to restore persisted Raven downloads: " + e.getMessage());
        }
    }

    void restorePersistedDownloadsForProcessMode() {
        for (DownloadProgress progress : loadPersistedTasks(new ArrayList<>(RESTORABLE_TASK_STATUSES))) {
            if (progress == null) {
                continue;
            }

            if (progress.isPauseRequested()) {
                progress.markPaused("Pause requested before download started. Task saved for later.");
                persistTaskSnapshot(progress);
                continue;
            }

            String status = normalizeStatus(progress.getStatus());
            if ("downloading".equals(status) || "interrupted".equals(status)) {
                progress.markRecoveredFromCache("restored-from-vault");
                progress.setMessage("Recovered download resumed from Vault.");
            }
            progress.assignWorker(progress.getWorkerIndex(), progress.getCpuCoreId(), null, EXECUTION_MODE_PROCESS);
            persistTaskSnapshot(progress);
        }
    }

    /**
     * Searches title.
     *
     * @param titleName The title name to search or resolve.
     * @return The resulting SearchTitle.
     */

    public SearchTitle searchTitle(String titleName) {
        cleanupExpiredSearches();

        String sanitizedTitle = sanitizeForLog(titleName);
        logger.debug("DOWNLOAD_SERVICE", "Initiating search for title: " + sanitizedTitle);
        List<Map<String, String>> searchResults = titleScraper.searchManga(titleName);
        String searchId = UUID.randomUUID().toString();
        logger.debug(
                "DOWNLOAD_SERVICE",
                "Generated searchId=" + sanitizeForLog(searchId) + " for title=" + sanitizedTitle);

        for (int i = 0; i < searchResults.size(); i++) {
            searchResults.get(i).put("option_number", String.valueOf(i + 1));
        }

        List<Map<String, String>> storedResults = new ArrayList<>();
        for (Map<String, String> result : searchResults) {
            storedResults.add(new HashMap<>(result));
        }

        searchSessions.put(searchId, new SearchSession(storedResults, currentTimeSupplier.get()));

        logger.debug(
                "DOWNLOAD_SERVICE",
                "Returning " + searchResults.size() + " results for title=" + sanitizedTitle +
                        " | searchId=" + sanitizeForLog(searchId));

        return new SearchTitle(searchId, searchResults);
    }

    /**
     * Returns title details.
     *
     * @param titleUrl The source title URL.
     * @return The resulting TitleDetails.
     */

    public TitleDetails getTitleDetails(String titleUrl) {
        return titleScraper.getTitleDetails(titleUrl);
    }

    /**
     * Queues every title matching the supplied browse filters.
     *
     * @param type        The requested content type.
     * @param nsfw        Whether adult-only titles should be matched.
     * @param titlePrefix The visible title prefix.
     * @return The resulting bulk queue summary.
     */
    public BulkQueueDownloadResult queueBulkDownload(String type, boolean nsfw, String titlePrefix) {
        String normalizedType = normalizeMediaType(type);
        String normalizedPrefix = normalizeBulkTitlePrefix(titlePrefix);
        BulkQueueDownloadResult.Filters filters = new BulkQueueDownloadResult.Filters(
                normalizedType != null ? normalizedType : normalizeQueueTitle(type),
                nsfw,
                normalizedPrefix == null ? "" : normalizedPrefix
        );

        if (normalizedType == null || normalizedPrefix == null) {
            return new BulkQueueDownloadResult(
                    BulkQueueDownloadResult.STATUS_INVALID_REQUEST,
                    "type and titlePrefix are required.",
                    filters,
                    0,
                    0,
                    0,
                    0,
                    0,
                    List.of(),
                    List.of(),
                    List.of()
            );
        }

        if (maintenancePauseActive.get()) {
            return new BulkQueueDownloadResult(
                    BulkQueueDownloadResult.STATUS_MAINTENANCE_PAUSED,
                    "Raven is temporarily pausing new downloads while VPN rotation completes.",
                    filters,
                    0,
                    0,
                    0,
                    0,
                    0,
                    List.of(),
                    List.of(),
                    List.of()
            );
        }

        logger.debug(
                "DOWNLOAD_SERVICE",
                "Bulk queue browse starting | type=" + sanitizeForLog(normalizedType) +
                        " | nsfw=" + nsfw +
                        " | titlePrefix=" + sanitizeForLog(normalizedPrefix));

        TitleScraper.BrowseResult browseResult = titleScraper.browseTitlesAlphabetically(normalizedType, nsfw, normalizedPrefix);
        List<Map<String, String>> matchedTitles = filterTitlesByPrefix(
                browseResult != null ? browseResult.titles() : List.of(),
                normalizedPrefix
        );
        int pagesScanned = browseResult != null ? browseResult.pagesScanned() : 0;
        if (matchedTitles.isEmpty()) {
            return new BulkQueueDownloadResult(
                    BulkQueueDownloadResult.STATUS_EMPTY_RESULTS,
                    "No titles matched the supplied filters.",
                    filters,
                    pagesScanned,
                    0,
                    0,
                    0,
                    0,
                    List.of(),
                    List.of(),
                    List.of()
            );
        }

        List<String> queuedTitles = new ArrayList<>();
        List<String> skippedActiveTitles = new ArrayList<>();
        List<String> failedTitles = new ArrayList<>();

        // Load all active tasks once to avoid redundant database calls in the loop
        List<DownloadProgress> activeTasks = loadPersistedTasks(new ArrayList<>(ACTIVE_TASK_STATUSES));
        Set<String> activeTitleNames = new HashSet<>();
        for (DownloadProgress p : activeTasks) {
            if (p.getTitle() != null) {
                activeTitleNames.add(p.getTitle());
            }
        }
        // Also add currently in-memory active downloads
        for (String activeTitle : activeDownloads.keySet()) {
            if (activeTitle != null) {
                activeTitleNames.add(activeTitle);
            }
        }
        for (DownloadProgress p : downloadProgress.values()) {
            if (p != null && p.getTitle() != null && ACTIVE_TASK_STATUSES.contains(normalizeStatus(p.getStatus()))) {
                activeTitleNames.add(p.getTitle());
            }
        }

        for (Map<String, String> selectedTitle : matchedTitles) {
            String titleName = normalizeQueueTitle(selectedTitle != null ? selectedTitle.get("title") : null);
            String titleUrl = selectedTitle != null ? selectedTitle.get("href") : null;
            String sanitizedTitle = sanitizeForLog(titleName);

            if (titleUrl == null || titleUrl.isBlank()) {
                failedTitles.add(titleName);
                logger.warn("DOWNLOAD_SERVICE", "Skipping bulk queue entry with missing href for title=" + sanitizedTitle);
                continue;
            }

            if (activeTitleNames.contains(titleName)) {
                skippedActiveTitles.add(titleName);
                logger.info("DOWNLOAD", "Skipping already active download: " + titleName);
                continue;
            }

            try {
                DownloadProgress progress = createQueuedProgress(titleName, selectedTitle, "library-download");
                queueProgressForExecution(titleName, selectedTitle, progress);
                queuedTitles.add(titleName);
                // Mark as active so we don't queue it twice if matchedTitles has duplicates (unlikely but safe)
                activeTitleNames.add(titleName);
            } catch (Exception e) {
                failedTitles.add(titleName);
                logger.warn(
                        "DOWNLOAD_SERVICE",
                        "Bulk queue failed for title=" + sanitizedTitle + " | reason=" + sanitizeForLog(e.getMessage()));
            }
        }

        String status = resolveBulkQueueStatus(queuedTitles, skippedActiveTitles, failedTitles);
        String message = buildBulkQueueMessage(queuedTitles, skippedActiveTitles, failedTitles, matchedTitles.size());
        return new BulkQueueDownloadResult(
                status,
                message,
                filters,
                pagesScanned,
                matchedTitles.size(),
                queuedTitles.size(),
                skippedActiveTitles.size(),
                failedTitles.size(),
                queuedTitles,
                skippedActiveTitles,
                failedTitles
        );
    }

    private Map<String, String> buildSelectedTitle(DownloadProgress progress) {
        Map<String, String> selectedTitle = new HashMap<>();
        selectedTitle.put("title", progress.getTitle());
        if (progress.getSourceUrl() != null) {
            selectedTitle.put("href", progress.getSourceUrl());
        }
        if (progress.getCoverUrl() != null) {
            selectedTitle.put("coverUrl", progress.getCoverUrl());
        }
        if (progress.getMediaType() != null) {
            selectedTitle.put("type", progress.getMediaType());
        }
        return selectedTitle;
    }

    private DownloadProgress createQueuedProgress(String titleName, Map<String, String> selectedTitle, String taskType) {
        DownloadProgress progress = new DownloadProgress(titleName);
        progress.ensureTaskId(UUID.randomUUID().toString());
        progress.attachTaskContext(
                progress.getTaskId(),
                taskType,
                null,
                selectedTitle != null ? selectedTitle.get("href") : null,
                selectedTitle != null ? selectedTitle.get("type") : null,
                selectedTitle != null ? selectedTitle.get("coverUrl") : null,
                null
        );
        progress.assignWorker(progress.getWorkerIndex(), -1, null, resolveWorkerExecutionMode());
        progress.setPauseRequested(false);
        progress.setMessage("Queued in Raven.");
        persistTaskSnapshot(progress);
        return progress;
    }

    boolean isTaskActive(String titleName) {
        if (titleName == null || titleName.isBlank()) {
            return false;
        }

        // Check in-memory status first (much faster than REST call to Vault)
        DownloadProgress inMemoryProgress = downloadProgress.get(titleName);
        if (inMemoryProgress != null && ACTIVE_TASK_STATUSES.contains(normalizeStatus(inMemoryProgress.getStatus()))) {
            return true;
        }

        if (activeDownloads.containsKey(titleName)) {
            return true;
        }

        // Fallback to Vault check for tasks that might be active in other workers or recently restored
        for (DownloadProgress progress : loadPersistedTasks(new ArrayList<>(ACTIVE_TASK_STATUSES))) {
            if (titleName.equals(progress.getTitle())) {
                return true;
            }
        }

        return false;
    }

    /**
     * Requests pause active downloads.
     *
     * @return The resulting PauseRequestResult.
     */

    public PauseRequestResult requestPauseActiveDownloads() {
        if (isProcessWorkerMain()) {
            return requestPauseForProcessWorkers();
        }

        return requestPauseForThreadedWorkers();
    }

    private PauseRequestResult requestPauseForThreadedWorkers() {
        List<String> pausedImmediately = new ArrayList<>();
        List<String> pausingAfterChapter = new ArrayList<>();

        for (Map.Entry<String, DownloadProgress> entry : downloadProgress.entrySet()) {
            String titleName = entry.getKey();
            DownloadProgress progress = entry.getValue();
            if (titleName == null || titleName.isBlank() || progress == null) {
                continue;
            }

            String status = Optional.ofNullable(progress.getStatus()).orElse("").trim().toLowerCase(Locale.ROOT);
            if (isTerminalStatus(status)) {
                continue;
            }

            progress.setPauseRequested(true);
            if ("queued".equals(status)) {
                Future<?> future = activeDownloads.get(titleName);
                boolean pausedBeforeStart = future != null && future.cancel(false);
                if (pausedBeforeStart) {
                    progress.markPaused("Pause requested before chapter download started. Task saved for later.");
                    persistTaskSnapshot(progress);
                    activeDownloads.remove(titleName);
                    finalizeProgress(titleName, progress);
                    pausedImmediately.add(titleName);
                    continue;
                }
            }

            progress.setMessage("Pause requested. Raven will stop this task after the current chapter finishes.");
            persistTaskSnapshot(progress);
            pausingAfterChapter.add(titleName);
        }

        return new PauseRequestResult(pausedImmediately, pausingAfterChapter);
    }

    private PauseRequestResult requestPauseForProcessWorkers() {
        List<String> pausedImmediately = new ArrayList<>();
        List<String> pausingAfterChapter = new ArrayList<>();

        synchronized (processWorkerLock) {
            List<DownloadProgress> activeTasks = loadPersistedTasks(new ArrayList<>(ACTIVE_TASK_STATUSES));
            activeTasks.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt));
            for (DownloadProgress progress : activeTasks) {
                if (progress == null || progress.getTaskId() == null || progress.getTaskId().isBlank()) {
                    continue;
                }

                String titleName = Optional.ofNullable(progress.getTitle()).orElse("");
                String status = normalizeStatus(progress.getStatus());
                if (isTerminalStatus(status)) {
                    continue;
                }

                progress.setPauseRequested(true);
                ActiveWorkerProcess handle = activeWorkerProcesses.get(progress.getTaskId());
                if ("queued".equals(status) && handle == null) {
                    progress.markPaused("Pause requested before download started. Task saved for later.");
                    persistTaskSnapshot(progress);
                    pausedImmediately.add(titleName);
                    continue;
                }

                progress.setMessage("Pause requested. Raven will stop this task after the current chapter finishes.");
                persistTaskSnapshot(progress);
                pausingAfterChapter.add(titleName);
            }
        }

        return new PauseRequestResult(pausedImmediately, pausingAfterChapter);
    }

    /**
     * Begins maintenance pause.
     *
     * @param reason The reason for the operation.
     */

    public void beginMaintenancePause(String reason) {
        maintenancePauseActive.set(true);
        logger.info("DOWNLOAD_SERVICE", "⏸️ Raven maintenance pause enabled. " + sanitizeForLog(reason));
    }

    /**
     * Ends maintenance pause.
     *
     * @param reason The reason for the operation.
     */

    public void endMaintenancePause(String reason) {
        maintenancePauseActive.set(false);
        logger.info("DOWNLOAD_SERVICE", "▶️ Raven maintenance pause cleared. " + sanitizeForLog(reason));
        if (isProcessWorkerMain()) {
            dispatchQueuedProcessWorkers();
        }
    }

    /**
     * Indicates whether maintenance pause active.
     *
     * @return True when the condition is satisfied.
     */

    public boolean isMaintenancePauseActive() {
        return maintenancePauseActive.get();
    }

    /**
     * Handles wait for no active downloads.
     *
     * @param timeout The timeout.
     * @return True when the condition is satisfied.
     */

    public boolean waitForNoActiveDownloads(Duration timeout) {
        long timeoutMs = timeout == null ? TimeUnit.MINUTES.toMillis(20) : Math.max(1L, timeout.toMillis());
        long deadline = System.currentTimeMillis() + timeoutMs;

        while (System.currentTimeMillis() < deadline) {
            if (!hasInFlightDownloads()) {
                return true;
            }

            try {
                Thread.sleep(500L);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return false;
            }
        }

        return !hasInFlightDownloads();
    }

    /**
     * Resumes paused downloads.
     *
     * @return The number of resumed tasks.
     */

    public int resumePausedDownloads() {
        return resumeDownloadsWithStatuses(List.of("paused", "interrupted"), "Resumed after Raven VPN rotation.");
    }

    /**
     * Resumes paused or interrupted downloads for the provided titles only.
     *
     * @param titleNames The titles Raven should resume.
     * @return The number of resumed tasks.
     */
    public int resumePausedDownloads(Collection<String> titleNames) {
        return resumeDownloadsForTitles(
                titleNames,
                List.of("paused", "interrupted"),
                "Resumed after Raven VPN rotation."
        );
    }

    /**
     * Resumes downloads with the provided statuses.
     *
     * @param statuses The statuses to resume.
     * @param message  The message to set on resumed tasks.
     * @return The count of resumed tasks.
     */

    public int resumeDownloadsWithStatuses(List<String> statuses, String message) {
        return resumeTasks(loadPersistedTasks(statuses), message);
    }

    /**
     * Resumes downloads for the provided titles when their persisted status matches the supplied list.
     *
     * @param titleNames The titles Raven should consider.
     * @param statuses   The persisted statuses to resume.
     * @param message    The message to set on resumed tasks.
     * @return The count of resumed tasks.
     */
    public int resumeDownloadsForTitles(Collection<String> titleNames, List<String> statuses, String message) {
        if (titleNames == null || titleNames.isEmpty()) {
            return 0;
        }

        LinkedHashSet<String> normalizedTitles = new LinkedHashSet<>();
        for (String titleName : titleNames) {
            if (titleName != null && !titleName.isBlank()) {
                normalizedTitles.add(titleName);
            }
        }
        if (normalizedTitles.isEmpty()) {
            return 0;
        }

        List<DownloadProgress> tasks = new ArrayList<>();
        for (String titleName : normalizedTitles) {
            tasks.addAll(loadPersistedTasks(statuses, titleName));
        }
        return resumeTasks(tasks, message);
    }

    /**
     * Resumes persisted tasks using the supplied message.
     *
     * @param tasks   The tasks Raven should resume.
     * @param message The message to set on resumed tasks.
     * @return The count of resumed tasks.
     */
    private int resumeTasks(Collection<DownloadProgress> tasks, String message) {
        if (tasks == null || tasks.isEmpty()) {
            return 0;
        }

        List<DownloadProgress> resumeCandidates = new ArrayList<>();
        LinkedHashSet<String> seenTaskIds = new LinkedHashSet<>();
        for (DownloadProgress progress : tasks) {
            if (progress == null || progress.getTaskId() == null || progress.getTaskId().isBlank()) {
                continue;
            }
            if (seenTaskIds.add(progress.getTaskId())) {
                resumeCandidates.add(progress);
            }
        }
        if (resumeCandidates.isEmpty()) {
            return 0;
        }

        resumeCandidates.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt));
        int resumed = 0;
        for (DownloadProgress progress : resumeCandidates) {
            String titleName = progress.getTitle();
            if (titleName == null || titleName.isBlank() || isTaskActive(titleName)) {
                continue;
            }

            progress.setPauseRequested(false);
            progress.markRecoveredFromCache("resume");
            progress.setMessage(message);
            persistTaskSnapshot(progress);

            if (isProcessWorkerMain()) {
                dispatchQueuedProcessWorkers();
            } else {
                downloadProgress.put(titleName, progress);
                Future<?> future = submitThreadedDownload(titleName, buildSelectedTitle(progress), progress);
                activeDownloads.put(titleName, future);
            }
            resumed++;
        }

        return resumed;
    }

    private boolean hasInFlightDownloads() {
        if (isProcessWorkerMain()) {
            return !activeWorkerProcesses.isEmpty() || getActiveDownloadCount() > 0;
        }

        if (getActiveDownloadCount() > 0) {
            return true;
        }

        for (Future<?> future : activeDownloads.values()) {
            if (future != null && !future.isDone() && !future.isCancelled()) {
                return true;
            }
        }

        return false;
    }

    DownloadProgress startTrackedTask(
            NewTitle title,
            String taskType,
            List<String> queuedChapters,
            List<String> newChapters,
            List<String> missingChapters,
            String latestChapter,
            int sourceChapterCount,
            String message) {
        String titleName = title != null && title.getTitleName() != null && !title.getTitleName().isBlank()
                ? title.getTitleName()
                : "Untitled";
        DownloadProgress progress = new DownloadProgress(titleName);
        progress.ensureTaskId(UUID.randomUUID().toString());
        progress.attachTaskContext(
                progress.getTaskId(),
                taskType,
                title != null ? title.getUuid() : null,
                title != null ? title.getSourceUrl() : null,
                title != null ? title.getType() : null,
                title != null ? title.getCoverUrl() : null,
                title != null ? title.getSummary() : null
        );
        progress.applyChapterPlan(queuedChapters, newChapters, missingChapters, latestChapter, sourceChapterCount, message);
        progress.assignWorker(progress.getWorkerIndex(), -1, ProcessHandle.current().pid(), EXECUTION_MODE_THREAD);
        progress.setPauseRequested(false);
        progress.markStarted(progress.getTotalChapters());
        downloadProgress.put(titleName, progress);
        persistTaskSnapshot(progress);
        return progress;
    }

    void updateTrackedTask(DownloadProgress progress) {
        persistTaskSnapshot(progress);
    }

    void finalizeTrackedTask(String titleName, DownloadProgress progress) {
        persistTaskSnapshot(progress);
        finalizeProgress(titleName, progress);
    }

    /**
     * Queues download all chapters.
     *
     * @param searchId The Raven search session id.
     * @param userIndex The user index.
     * @return The resulting message or value.
     */

    public String queueDownloadAllChapters(String searchId, int userIndex) {
        return queueDownloadAllChaptersResult(searchId, userIndex).getMessage();
    }

    /**
     * Queues download all chapters result.
     *
     * @param searchId  The Raven search session id.
     * @param userIndex The user index.
     * @return The resulting QueueDownloadResult.
     */

    public QueueDownloadResult queueDownloadAllChaptersResult(String searchId, int userIndex) {
        if (maintenancePauseActive.get()) {
            return new QueueDownloadResult(
                    QueueDownloadResult.STATUS_MAINTENANCE_PAUSED,
                    "Raven is temporarily pausing new downloads while VPN rotation completes.",
                    0,
                    List.of(),
                    List.of()
            );
        }

        List<Map<String, String>> results = getSearchResults(searchId);
        String sanitizedSearchId = sanitizeForLog(searchId);
        int resultsSize = results == null ? 0 : results.size();
        logger.debug(
                "DOWNLOAD_SERVICE",
                "Queue request | searchId=" + sanitizedSearchId + " | userIndex=" + userIndex +
                        " | sessionSize=" + resultsSize);
        if (results == null) {
            logger.debug(
                    "DOWNLOAD_SERVICE",
                    "Search session missing or expired | searchId=" + sanitizedSearchId);
            return new QueueDownloadResult(
                    QueueDownloadResult.STATUS_SEARCH_EXPIRED,
                    "Search session expired or not found. Please search again.",
                    0,
                    List.of(),
                    List.of()
            );
        }
        if (userIndex == 0) {
            logger.debug(
                    "DOWNLOAD_SERVICE",
                    "Processing ALL titles branch | searchId=" + sanitizedSearchId);
            if (results.isEmpty()) {
                logger.debug(
                        "DOWNLOAD_SERVICE",
                        "No titles available to queue | searchId=" + sanitizedSearchId);
                searchSessions.remove(searchId);
                return new QueueDownloadResult(
                        QueueDownloadResult.STATUS_EMPTY_RESULTS,
                        "No search results to download.",
                        0,
                        List.of(),
                        List.of()
                );
            }

            List<String> queuedTitles = new ArrayList<>();
            List<String> skippedTitles = new ArrayList<>();
            for (Map<String, String> title : results) {
                String titleName = title.get("title");
                String safeTitleName = normalizeQueueTitle(titleName);
                String sanitizedTitle = sanitizeForLog(safeTitleName);
                logger.debug(
                        "DOWNLOAD_SERVICE",
                        "Evaluating title for queue | searchId=" + sanitizedSearchId +
                                " | title=" + sanitizedTitle);
                if (isTaskActive(titleName)) {
                    logger.debug(
                            "DOWNLOAD_SERVICE",
                            "Title already downloading | title=" + sanitizedTitle);
                    logger.info("DOWNLOAD", "Skipping already active download: " + titleName);
                    skippedTitles.add(safeTitleName);
                    continue;
                }

                DownloadProgress progress = createQueuedProgress(titleName, title, "library-download");
                queueProgressForExecution(titleName, title, progress);
                queuedTitles.add(safeTitleName);
                logger.debug(
                        "DOWNLOAD_SERVICE",
                        "Queued title for download | title=" + sanitizedTitle);
            }
            searchSessions.remove(searchId);
            logger.debug(
                    "DOWNLOAD_SERVICE",
                    "Queued titles summary | searchId=" + sanitizedSearchId +
                            " | titles=" + String.join(";", queuedTitles));
            if (queuedTitles.isEmpty()) {
                return new QueueDownloadResult(
                        QueueDownloadResult.STATUS_ALREADY_ACTIVE,
                        buildAlreadyActiveMessage(skippedTitles),
                        0,
                        List.of(),
                        skippedTitles
                );
            }
            if (!skippedTitles.isEmpty()) {
                return new QueueDownloadResult(
                        QueueDownloadResult.STATUS_PARTIAL,
                        "Queued " + queuedTitles.size() + " download(s). Skipped " + skippedTitles.size()
                                + " already-active title(s).",
                        queuedTitles.size(),
                        queuedTitles,
                        skippedTitles
                );
            }
            return new QueueDownloadResult(
                    QueueDownloadResult.STATUS_QUEUED,
                    "Queued downloads for: " + String.join(", ", queuedTitles),
                    queuedTitles.size(),
                    queuedTitles,
                    List.of()
            );

        } else {
            Map<String, String> selectedTitle;
            try {
                selectedTitle = getSelectedTitle(results, userIndex);
            } catch (IndexOutOfBoundsException e) {
                logger.debug(
                        "DOWNLOAD_SERVICE",
                        "Invalid selection index | searchId=" + sanitizedSearchId +
                                " | userIndex=" + userIndex);
                return new QueueDownloadResult(
                        QueueDownloadResult.STATUS_INVALID_SELECTION,
                        "Invalid selection. Please choose a valid option.",
                        0,
                        List.of(),
                        List.of()
                );
            }
            String titleName = selectedTitle.get("title");
            String safeTitleName = normalizeQueueTitle(titleName);
            String sanitizedTitle = sanitizeForLog(safeTitleName);

            logger.debug(
                    "DOWNLOAD_SERVICE",
                    "Processing SINGLE title branch | searchId=" + sanitizedSearchId +
                            " | userIndex=" + userIndex + " | title=" + sanitizedTitle);

            if (isTaskActive(titleName)) {
                logger.debug(
                        "DOWNLOAD_SERVICE",
                        "Active download already in progress | title=" + sanitizedTitle);
                return new QueueDownloadResult(
                        QueueDownloadResult.STATUS_ALREADY_ACTIVE,
                        "Download already in progress for: " + safeTitleName,
                        0,
                        List.of(),
                        List.of(safeTitleName)
                );
            }

            DownloadProgress progress = createQueuedProgress(titleName, selectedTitle, "library-download");
            queueProgressForExecution(titleName, selectedTitle, progress);
            // Keep the search session so clients can queue multiple selected options from one search result.
            logger.debug(
                    "DOWNLOAD_SERVICE",
                    "Queued single title | title=" + sanitizedTitle +
                            " | searchId=" + sanitizedSearchId);
            return new QueueDownloadResult(
                    QueueDownloadResult.STATUS_QUEUED,
                    "Download queued for: " + safeTitleName,
                    1,
                    List.of(safeTitleName),
                    List.of()
            );
        }
    }

    private void runDownload(String titleName, Map<String, String> selectedTitle, DownloadProgress progress) {
        DownloadChapter result = new DownloadChapter();

        try {
            if (!isWorkerMode()) {
                assignThreadWorkerContext(progress);
                persistTaskSnapshot(progress);
            }

            if (!waitForVpnConnectionIfRequired(titleName, progress)) {
                result.setStatus("⏸️ Download waiting stopped.");
                return;
            }

            String titleUrl = selectedTitle.get("href");
            progress.ensureTaskId(UUID.randomUUID().toString());
            logger.info("DOWNLOAD", "🚀 Starting download for [" + titleName + "]");
            logger.debug(
                    "DOWNLOAD",
                    "Resolved title URL | title=" + sanitizeForLog(titleName) +
                            " | url=" + sanitizeForLog(titleUrl));

            NewTitle titleRecord = libraryService.resolveOrCreateTitle(titleName, titleUrl);
            if (titleRecord.getDownloadedChapterNumbers() == null) {
                titleRecord.setDownloadedChapterNumbers(new ArrayList<>());
            }

            String coverUrl = selectedTitle.get("coverUrl");
            if (coverUrl != null && !coverUrl.isBlank()) {
                titleRecord.setCoverUrl(coverUrl.trim());
            }

            String normalizedType = normalizeMediaType(selectedTitle.get("type"));
            if (normalizedType != null) {
                titleRecord.setType(normalizedType);
            }

            applyTitleDetailsMetadata(titleRecord, titleScraper.getTitleDetails(titleUrl));
            progress.attachTaskContext(
                    progress.getTaskId(),
                    Optional.ofNullable(progress.getTaskType()).orElse("library-download"),
                    titleRecord.getUuid(),
                    titleUrl,
                    titleRecord.getType(),
                    titleRecord.getCoverUrl(),
                    titleRecord.getSummary()
            );
            persistTaskSnapshot(progress);

            List<Map<String, String>> chapters = fetchAllChaptersWithRetry(titleUrl);
            if (chapters.isEmpty()) {
                progress.markFailed("No chapters found for this title.");
                persistTaskSnapshot(progress);
                throw new RuntimeException("No chapters found for this title.");
            }
            logger.debug(
                    "DOWNLOAD",
                    "Fetched chapters | title=" + sanitizeForLog(titleName) +
                            " | count=" + chapters.size());

            DownloadNamingSettings naming = settingsService.getDownloadNamingSettings();
            Path workingTitleFolder = resolveWorkingTitleFolder(titleName, titleRecord.getType(), naming);
            Path finalTitleFolder = resolveFinalTitleFolder(titleName, titleRecord.getType(), naming);
            migrateExistingTitleFolder(titleName, titleRecord.getDownloadPath(), finalTitleFolder);
            Files.createDirectories(workingTitleFolder);
            titleRecord.setDownloadPath(finalTitleFolder.toString());
            // Process oldest -> newest so lastDownloaded ends at the latest chapter number.
            List<Map<String, String>> chaptersToDownload = new ArrayList<>(chapters);
            chaptersToDownload.sort(Comparator.comparingDouble(chapter -> {
                String chapterTitle = chapter.get("chapter_title");
                String chapterNumber = extractChapterNumberFull(chapterTitle);
                if ("0000".equals(chapterNumber)) {
                    return Double.POSITIVE_INFINITY;
                }
                try {
                    return Double.parseDouble(chapterNumber);
                } catch (NumberFormatException e) {
                    return Double.POSITIVE_INFINITY;
                }
            }));

            List<Map<String, String>> plannedChapters = resolvePlannedChapters(chaptersToDownload, progress);
            List<String> plannedChapterNumbers = extractChapterNumbers(plannedChapters);
            List<String> queuedChapterNumbers = progress.getQueuedChapterNumbers().isEmpty()
                    ? plannedChapterNumbers
                    : progress.getQueuedChapterNumbers();
            List<String> newChapterNumbers = progress.getNewChapterNumbers().isEmpty()
                    ? queuedChapterNumbers
                    : progress.getNewChapterNumbers();
            List<String> missingChapterNumbers = progress.getMissingChapterNumbers();
            progress.applyChapterPlan(
                    queuedChapterNumbers,
                    newChapterNumbers,
                    missingChapterNumbers,
                    plannedChapterNumbers.isEmpty() ? "0" : plannedChapterNumbers.get(plannedChapterNumbers.size() - 1),
                    chapters.size(),
                    progress.isRecoveredFromCache() ? "Recovered download resumed from Vault." : "Downloading queued chapters."
            );
            if (plannedChapters.isEmpty()) {
                progress.setMessage("No pending chapters remained in the cached Raven task.");
                progress.markCompleted();
                persistTaskSnapshot(progress);
                return;
            }
            titleRecord.setChapterCount(chapters.size());
            titleRecord.setChaptersDownloaded(Optional.ofNullable(titleRecord.getDownloadedChapterNumbers()).orElse(List.of()).size());
            progress.markStarted(progress.getTotalChapters());
            persistTaskSnapshot(progress);
            boolean downloadedAnyChapters = false;
            List<String> failedChapters = new ArrayList<>();

            libraryService.addOrUpdateTitle(
                    titleRecord,
                    new NewChapter(Optional.ofNullable(titleRecord.getLastDownloaded()).orElse("0"))
            );

            for (Map<String, String> chapter : plannedChapters) {
                if (shouldPauseAtChapterBoundary(titleName, progress)) {
                    result.setStatus("⏸️ Download paused.");
                    return;
                }

                String chapterTitle = chapter.get("chapter_title");
                String chapterNumber = extractChapterNumberFull(chapterTitle);
                String chapterUrl = chapter.get("href");
                if (progress.hasCompletedChapter(chapterNumber)) {
                    continue;
                }

                progress.chapterStarted(chapterTitle, chapterNumber);
                persistTaskSnapshot(progress);

                logger.debug(
                        "DOWNLOAD",
                        "Preparing chapter | title=" + sanitizeForLog(titleName) +
                                " | chapterNumber=" + sanitizeForLog(chapterNumber) +
                                " | chapterTitle=" + sanitizeForLog(chapterTitle) +
                                " | url=" + sanitizeForLog(chapterUrl));

                logger.info("DOWNLOAD", "📥 Downloading Chapter [" + chapterNumber + "]: " + chapterUrl);

                List<String> pageUrls = sourceFinder.findSource(chapterUrl);
                if (pageUrls.isEmpty()) {
                    logger.warn("DOWNLOAD", "⚠️ No pages found for chapter " + chapterNumber + ". Skipping.");
                    failedChapters.add(chapterNumber);
                    progress.setMessage("Chapter " + chapterNumber + " could not be resolved. It will be left pending.");
                    persistTaskSnapshot(progress);
                    continue;
                }

                String sourceDomain = extractDomain(pageUrls.get(0));
                Path chapterFolder = workingTitleFolder.resolve("temp_" + chapterNumber);
                int pageCount = saveImagesToFolder(pageUrls, chapterFolder, naming, titleRecord, chapterNumber);
                if (pageCount <= 0) {
                    logger.warn("DOWNLOAD", "⚠️ No files were saved for chapter " + chapterNumber + ". Leaving it pending.");
                    failedChapters.add(chapterNumber);
                    progress.setMessage("Chapter " + chapterNumber + " did not finish downloading. It will be left pending.");
                    persistTaskSnapshot(progress);
                    continue;
                }

                String cbzName = formatChapterCbzName(naming, titleRecord, chapterNumber, pageCount, sourceDomain);
                Path cbzPath = workingTitleFolder.resolve(cbzName);

                zipFolderAsCbz(chapterFolder, cbzPath);
                deleteFolder(chapterFolder);
                downloadedAnyChapters = true;

                logger.info("DOWNLOAD", "📦 Saved [" + cbzName + "] with " + pageCount + " pages at " + cbzPath);

                progress.chapterCompleted(chapterNumber);
                progress.setMessage("Downloaded chapter " + chapterNumber + ".");
                persistTaskSnapshot(progress);
                titleRecord.setLastDownloaded(chapterNumber);
                mergeDownloadedChapter(titleRecord, chapterNumber);
                recordDownloadedChapterFile(titleRecord, chapterNumber, cbzName);
                titleRecord.setChaptersDownloaded(Optional.ofNullable(titleRecord.getDownloadedChapterNumbers()).orElse(List.of()).size());
                libraryService.addOrUpdateTitle(titleRecord, new NewChapter(chapterNumber));
            }

            if (downloadedAnyChapters) {
                titleRecord.setChaptersDownloaded(Optional.ofNullable(titleRecord.getDownloadedChapterNumbers()).orElse(List.of()).size());
                promoteTitleFolder(workingTitleFolder, finalTitleFolder);
                titleRecord.setDownloadPath(finalTitleFolder.toString());
                libraryService.addOrUpdateTitle(
                        titleRecord,
                        new NewChapter(Optional.ofNullable(titleRecord.getLastDownloaded()).orElse("0"))
                );
                libraryService.scanKavitaLibraryForType(titleRecord.getType());
            }

            result.setChapterName(titleName);
            if (failedChapters.isEmpty()) {
                result.setStatus("✅ Download completed.");
                progress.setMessage("Download completed.");
                progress.markCompleted();
            } else {
                String failureMessage = "Download interrupted with pending chapters: " + String.join(", ", failedChapters);
                result.setStatus("⚠️ Download interrupted.");
                progress.markInterrupted(failureMessage);
            }
            persistTaskSnapshot(progress);

        } catch (Exception e) {
            logger.error("DOWNLOAD", "❌ Download failed for [" + titleName + "]: " + e.getMessage(), e);
            progress.markFailed(e.getMessage());
            persistTaskSnapshot(progress);
        } finally {
            activeDownloads.remove(titleName);
            logger.debug(
                    "DOWNLOAD",
                    "Removed active download entry | title=" + sanitizeForLog(titleName));
            finalizeProgress(titleName, progress);
        }
    }

    private boolean waitForVpnConnectionIfRequired(String titleName, DownloadProgress progress) {
        if (isProcessWorkerMain() || isWorkerMode()) {
            return !shouldPauseBeforeDownloadStart(titleName, progress);
        }

        boolean waitingMessagePublished = false;
        String waitingMessage = "Waiting for Raven VPN connection before download starts.";

        while (shouldWaitForVpnConnection()) {
            if (shouldPauseBeforeDownloadStart(titleName, progress)) {
                return false;
            }

            if (!waitingMessagePublished || !waitingMessage.equals(progress.getMessage())) {
                progress.setMessage(waitingMessage);
                persistTaskSnapshot(progress);
                waitingMessagePublished = true;
            }

            try {
                Thread.sleep(VPN_CONNECTION_WAIT_POLL_MS);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                progress.markInterrupted("Interrupted while waiting for Raven VPN connection.");
                persistTaskSnapshot(progress);
                return false;
            }
        }

        return !shouldPauseBeforeDownloadStart(titleName, progress);
    }

    private boolean shouldWaitForVpnConnection() {
        DownloadVpnSettings vpnSettings = settingsService.getDownloadVpnSettingsFresh();
        if (vpnSettings == null || !Boolean.TRUE.equals(vpnSettings.getOnlyDownloadWhenVpnOn())) {
            return false;
        }

        VpnRuntimeStatus status = vpnServices != null ? vpnServices.getStatus() : null;
        return status == null || !status.isConnected();
    }

    private void finalizeProgress(String titleName, DownloadProgress progress) {
        DownloadProgress snapshot = progress.copy();
        downloadProgress.remove(titleName);
        progressHistory.addFirst(snapshot);
        while (progressHistory.size() > MAX_STATUS_HISTORY_ENTRIES) {
            progressHistory.removeLast();
        }
    }

    private void persistTaskSnapshot(DownloadProgress progress) {
        if (progress == null) {
            return;
        }

        try {
            progress.ensureTaskId(UUID.randomUUID().toString());
            Map<String, Object> document = buildTaskDocument(progress);
            vaultService.update(
                    TASK_COLLECTION,
                    Map.of("taskId", progress.getTaskId()),
                    Map.of("$set", document),
                    true
            );
            vaultService.setRedisValue(CURRENT_TASK_REDIS_KEY, document);
        } catch (Exception e) {
            logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to persist Raven task snapshot: " + e.getMessage());
        }
    }

    private Map<String, Object> buildTaskDocument(DownloadProgress progress) {
        Map<String, Object> document = new LinkedHashMap<>();
        document.put("taskId", progress.getTaskId());
        document.put("taskType", progress.getTaskType());
        document.put("title", progress.getTitle());
        document.put("titleUuid", progress.getTitleUuid());
        document.put("sourceUrl", progress.getSourceUrl());
        document.put("mediaType", progress.getMediaType());
        document.put("coverUrl", progress.getCoverUrl());
        document.put("summary", progress.getSummary());
        document.put("queuedAt", progress.getQueuedAt());
        document.put("totalChapters", progress.getTotalChapters());
        document.put("sourceChapterCount", progress.getSourceChapterCount());
        document.put("completedChapters", progress.getCompletedChapters());
        document.put("currentChapter", progress.getCurrentChapter());
        document.put("currentChapterNumber", progress.getCurrentChapterNumber());
        document.put("status", progress.getStatus());
        document.put("latestChapter", progress.getLatestChapter());
        document.put("message", progress.getMessage());
        document.put("startedAt", progress.getStartedAt());
        document.put("completedAt", progress.getCompletedAt());
        document.put("errorMessage", progress.getErrorMessage());
        document.put("recoveredFromCache", progress.isRecoveredFromCache());
        document.put("recoveryState", progress.getRecoveryState());
        document.put("queuedChapterNumbers", progress.getQueuedChapterNumbers());
        document.put("completedChapterNumbers", progress.getCompletedChapterNumbers());
        document.put("remainingChapterNumbers", progress.getRemainingChapterNumbers());
        document.put("newChapterNumbers", progress.getNewChapterNumbers());
        document.put("missingChapterNumbers", progress.getMissingChapterNumbers());
        document.put("workerIndex", progress.getWorkerIndex());
        document.put("cpuCoreId", progress.getCpuCoreId());
        document.put("workerPid", progress.getWorkerPid());
        document.put("executionMode", progress.getExecutionMode());
        document.put("pauseRequested", progress.isPauseRequested());
        document.put("lastUpdated", progress.getLastUpdated());
        return document;
    }

    private boolean shouldPauseBeforeDownloadStart(String titleName, DownloadProgress progress) {
        if (titleName == null || titleName.isBlank() || progress == null || !refreshPauseRequestedFlag(progress)) {
            return false;
        }

        progress.markPaused("Pause requested before download started. Task saved for later.");
        persistTaskSnapshot(progress);
        return true;
    }

    private boolean shouldPauseAtChapterBoundary(String titleName, DownloadProgress progress) {
        if (titleName == null || titleName.isBlank() || progress == null || !refreshPauseRequestedFlag(progress)) {
            return false;
        }

        List<String> remaining = progress.getRemainingChapterNumbers();
        if (remaining.isEmpty()) {
            return false;
        }

        progress.markPaused(buildPauseMessage(remaining));
        persistTaskSnapshot(progress);
        return true;
    }

    private String buildPauseMessage(List<String> remaining) {
        if (remaining == null || remaining.isEmpty()) {
            return "Pause requested. Task saved for later.";
        }

        int remainingCount = remaining.size();
        String suffix = remainingCount == 1 ? "chapter" : "chapters";
        return "Pause requested. Saved " + remainingCount + " pending " + suffix +
                ": " + formatChapterPreview(remaining) + ".";
    }

    private String formatChapterPreview(List<String> chapters) {
        if (chapters == null || chapters.isEmpty()) {
            return "";
        }

        int limit = Math.min(8, chapters.size());
        String joined = String.join(", ", chapters.subList(0, limit));
        int remaining = chapters.size() - limit;
        if (remaining > 0) {
            return joined + " +" + remaining + " more";
        }
        return joined;
    }

    private List<Map<String, String>> resolvePlannedChapters(List<Map<String, String>> chapters, DownloadProgress progress) {
        if (chapters == null || chapters.isEmpty()) {
            return List.of();
        }

        Set<String> completed = new LinkedHashSet<>(progress.getCompletedChapterNumbers());
        List<String> queued = progress.getQueuedChapterNumbers();
        if (queued.isEmpty()) {
            return chapters;
        }

        Set<String> remaining = new LinkedHashSet<>();
        for (String chapterNumber : queued) {
            if (!completed.contains(chapterNumber)) {
                remaining.add(chapterNumber);
            }
        }

        if (remaining.isEmpty()) {
            return List.of();
        }

        List<Map<String, String>> filtered = new ArrayList<>();
        for (Map<String, String> chapter : chapters) {
            String chapterNumber = extractChapterNumberFull(chapter.get("chapter_title"));
            if (remaining.contains(chapterNumber)) {
                filtered.add(chapter);
            }
        }

        return filtered;
    }

    private List<String> extractChapterNumbers(List<Map<String, String>> chapters) {
        List<String> chapterNumbers = new ArrayList<>();
        if (chapters == null) {
            return chapterNumbers;
        }

        for (Map<String, String> chapter : chapters) {
            String chapterNumber = extractChapterNumberFull(chapter.get("chapter_title"));
            if (chapterNumber != null && !chapterNumber.isBlank() && !"0000".equals(chapterNumber)) {
                chapterNumbers.add(chapterNumber);
            }
        }

        return chapterNumbers;
    }

    private void mergeDownloadedChapter(NewTitle titleRecord, String chapterNumber) {
        if (titleRecord == null || chapterNumber == null || chapterNumber.isBlank()) {
            return;
        }

        String normalizedChapterNumber = normalizeChapterNumber(chapterNumber);
        if (normalizedChapterNumber == null || normalizedChapterNumber.isBlank() || "0".equals(normalizedChapterNumber)) {
            return;
        }

        List<String> current = titleRecord.getDownloadedChapterNumbers() == null
                ? new ArrayList<>()
                : new ArrayList<>(titleRecord.getDownloadedChapterNumbers());
        if (!current.contains(normalizedChapterNumber)) {
            current.add(normalizedChapterNumber);
            current.sort(this::compareChapterNumbers);
            titleRecord.setDownloadedChapterNumbers(current);
        }
    }

    private void recordDownloadedChapterFile(NewTitle titleRecord, String chapterNumber, String cbzName) {
        if (titleRecord == null || cbzName == null || cbzName.isBlank()) {
            return;
        }

        String normalizedChapterNumber = normalizeChapterNumber(chapterNumber);
        if (normalizedChapterNumber == null || normalizedChapterNumber.isBlank() || "0".equals(normalizedChapterNumber)) {
            return;
        }

        String normalizedFileName = sanitizeStoredFileName(cbzName);
        if (normalizedFileName.isBlank()) {
            return;
        }

        Map<String, String> current = titleRecord.getDownloadedChapterFiles() == null
                ? new LinkedHashMap<>()
                : new LinkedHashMap<>(titleRecord.getDownloadedChapterFiles());
        current.put(normalizedChapterNumber, normalizedFileName);
        titleRecord.setDownloadedChapterFiles(sortChapterFileMap(current));
    }

    private List<Map<String, String>> fetchAllChaptersWithRetry(String titleUrl) {
        int attempts = 0;
        while (attempts < 3) {
            int attemptNumber = attempts + 1;
            logger.debug(
                    "SCRAPER",
                    "Fetching chapters attempt " + attemptNumber + " | url=" + sanitizeForLog(titleUrl));
            try {
                List<Map<String, String>> chapters = titleScraper.getChapters(titleUrl);
                logger.debug(
                        "SCRAPER",
                        "Fetch successful on attempt " + attemptNumber +
                                " | url=" + sanitizeForLog(titleUrl) +
                                " | count=" + chapters.size());
                return chapters;
            } catch (StaleElementReferenceException e) {
                attempts++;
                logger.warn("SCRAPER", "⚠️ Stale element detected, retrying (" + attempts + "/3)");
                try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
                logger.debug(
                        "SCRAPER",
                        "Retry scheduled | nextAttempt=" + (attempts + 1) +
                                " | url=" + sanitizeForLog(titleUrl));
            }
        }
        throw new RuntimeException("Failed to fetch chapters after multiple retries.");
    }

    private Map<String, String> getSelectedTitle(List<Map<String, String>> results, int userIndex) {
        int index = userIndex - 1;
        if (index < 0 || index >= results.size()) {
            throw new IndexOutOfBoundsException("Invalid index: " + userIndex);
        }
        return results.get(index);
    }

    private String extractChapterNumberFull(String text) {
        if (text == null || text.isBlank()) {
            return "0000";
        }

        Matcher matcher = Pattern.compile("(?i)\\bc\\s*(\\d+(\\.\\d+)?)\\b").matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }

        matcher = Pattern.compile("(?i)\\bch(?:apter)?\\.?\\s*(\\d+(\\.\\d+)?)\\b").matcher(text);
        if (matcher.find()) {
            return matcher.group(1);
        }

        String stripped = stripTrailingFileDecorators(text);
        matcher = Pattern.compile("(?i)(?:^|[^a-z])(\\d+(\\.\\d+)?)$").matcher(stripped);
        if (matcher.find()) {
            return matcher.group(1);
        }

        return "0000";
    }

    private String normalizeChapterNumber(String chapterNumber) {
        if (chapterNumber == null || chapterNumber.isBlank()) {
            return null;
        }

        try {
            return new java.math.BigDecimal(chapterNumber.trim()).stripTrailingZeros().toPlainString();
        } catch (NumberFormatException ignored) {
            return chapterNumber.trim();
        }
    }

    private int compareChapterNumbers(String left, String right) {
        String normalizedLeft = normalizeChapterNumber(left);
        String normalizedRight = normalizeChapterNumber(right);

        if (normalizedLeft == null && normalizedRight == null) {
            return 0;
        }
        if (normalizedLeft == null) {
            return -1;
        }
        if (normalizedRight == null) {
            return 1;
        }

        try {
            return new java.math.BigDecimal(normalizedLeft).compareTo(new java.math.BigDecimal(normalizedRight));
        } catch (NumberFormatException ignored) {
            return normalizedLeft.compareToIgnoreCase(normalizedRight);
        }
    }

    private String extractDomain(String url) {
        try {
            return new URL(url).getHost();
        } catch (Exception e) {
            logger.warn("DOWNLOAD", "⚠️ Failed to parse domain from URL: " + url);
            return "unknown";
        }
    }

    private String extractExtension(String url) {
        if (url == null || url.isBlank()) {
            return ".jpg";
        }

        int dot = url.lastIndexOf('.');
        if (dot < 0 || dot >= url.length() - 1) {
            return ".jpg";
        }

        String ext = url.substring(dot);
        int queryIndex = ext.indexOf('?');
        if (queryIndex >= 0) {
            ext = ext.substring(0, queryIndex);
        }

        if (!ext.startsWith(".")) {
            ext = "." + ext;
        }

        if (!ext.matches("\\.[A-Za-z0-9]{1,8}")) {
            return ".jpg";
        }

        return ext;
    }

    private String formatTitleFolderName(DownloadNamingSettings naming, String titleName, String type) {
        String title = titleName == null ? "" : titleName.trim();
        String normalizedType = normalizeMediaType(type);
        String typeSlug = resolveMediaTypeFolder(type);

        String template = naming != null ? naming.getTitleTemplate() : null;
        if (template == null || template.isBlank()) {
            template = "{title}";
        }

        Map<String, String> values = new HashMap<>();
        values.put("title", title);
        values.put("type", normalizedType != null ? normalizedType : "");
        values.put("type_slug", typeSlug != null ? typeSlug : "");

        String raw = applyTemplate(template, values);
        String sanitized = sanitizePathSegment(raw);
        if (sanitized.isBlank()) {
            sanitized = sanitizeFolderName(title);
        }
        return sanitized;
    }

    /**
     * Builds chapter archive name.
     *
     * @param title The Raven title.
     * @param chapterNumber The chapter number.
     * @param pageCount The page count.
     * @param domain The domain.
     * @return The resulting message or value.
    */

    public String buildChapterArchiveName(NewTitle title, String chapterNumber, int pageCount, String domain) {
        return formatChapterCbzName(settingsService.getDownloadNamingSettings(), title, chapterNumber, pageCount, domain);
    }

    private String formatChapterCbzName(DownloadNamingSettings naming, NewTitle titleRecord, String chapterNumber, int pageCount, String domain) {
        String title = titleRecord != null && titleRecord.getTitleName() != null ? titleRecord.getTitleName().trim() : "";
        String type = titleRecord != null ? titleRecord.getType() : null;
        String normalizedType = normalizeMediaType(type);
        String typeSlug = resolveMediaTypeFolder(type);
        String chapter = chapterNumber == null ? "" : chapterNumber.trim();

        int chapterPad = naming != null && naming.getChapterPad() != null ? Math.max(1, naming.getChapterPad()) : 3;
        String chapterPadded = formatChapterPadded(chapter, chapterPad);
        int volumePad = naming != null && naming.getVolumePad() != null ? Math.max(1, naming.getVolumePad()) : 2;
        int volumeNumber = resolveChapterVolumeNumber(titleRecord, chapterNumber);
        String volumePadded = formatVolumePadded(volumeNumber, volumePad);

        String template = naming != null ? naming.getChapterTemplate() : null;
        if (template == null || template.isBlank()) {
            template = "{title} c{chapter} (v{volume}) [Noona].cbz";
        }

        Map<String, String> values = new HashMap<>();
        values.put("title", title);
        values.put("type", normalizedType != null ? normalizedType : "");
        values.put("type_slug", typeSlug != null ? typeSlug : "");
        values.put("chapter", chapterPadded);
        values.put("chapter_padded", chapterPadded);
        values.put("volume", volumePadded);
        values.put("volume_padded", volumePadded);
        values.put("pages", String.valueOf(pageCount));
        values.put("domain", domain != null ? domain : "");

        String raw = applyTemplate(template, values);
        if (raw == null || raw.isBlank()) {
            raw = title.isBlank()
                    ? String.format("c%s (v%s) [Noona].cbz", chapterPadded, volumePadded)
                    : String.format("%s c%s (v%s) [Noona].cbz", title, chapterPadded, volumePadded);
        }

        String withExt = raw.trim();
        if (!withExt.toLowerCase(Locale.ROOT).endsWith(".cbz")) {
            withExt = withExt + ".cbz";
        }

        String sanitized = sanitizeFileName(withExt);
        if (sanitized.isBlank()) {
            sanitized = sanitizeFileName(String.format("Chapter %s.cbz", chapterPadded));
        }
        return sanitized.isBlank() ? "Chapter.cbz" : sanitized;
    }

    private String formatPageFileName(DownloadNamingSettings naming, NewTitle titleRecord, String chapterNumber, int pageIndex, String ext) {
        String title = titleRecord != null && titleRecord.getTitleName() != null ? titleRecord.getTitleName().trim() : "";
        String type = titleRecord != null ? titleRecord.getType() : null;
        String normalizedType = normalizeMediaType(type);
        String typeSlug = resolveMediaTypeFolder(type);
        String chapter = chapterNumber == null ? "" : chapterNumber.trim();
        String extension = ext == null || ext.isBlank() ? ".jpg" : ext;

        int pagePad = naming != null && naming.getPagePad() != null ? Math.max(1, naming.getPagePad()) : 3;
        String pagePadded = String.format("%0" + pagePad + "d", pageIndex);

        int chapterPad = naming != null && naming.getChapterPad() != null ? Math.max(1, naming.getChapterPad()) : 3;
        String chapterPadded = formatChapterPadded(chapter, chapterPad);
        int volumePad = naming != null && naming.getVolumePad() != null ? Math.max(1, naming.getVolumePad()) : 2;
        int volumeNumber = resolveChapterVolumeNumber(titleRecord, chapterNumber);
        String volumePadded = formatVolumePadded(volumeNumber, volumePad);

        String template = naming != null ? naming.getPageTemplate() : null;
        if (template == null || template.isBlank()) {
            template = "{page_padded}{ext}";
        }

        Map<String, String> values = new HashMap<>();
        values.put("title", title);
        values.put("type", normalizedType != null ? normalizedType : "");
        values.put("type_slug", typeSlug != null ? typeSlug : "");
        values.put("chapter", chapterPadded);
        values.put("chapter_padded", chapterPadded);
        values.put("volume", volumePadded);
        values.put("volume_padded", volumePadded);
        values.put("page", String.valueOf(pageIndex));
        values.put("page_padded", pagePadded);
        values.put("ext", extension);

        boolean hasExt = template.contains("{ext}");
        String raw = applyTemplate(template, values);
        if (raw == null) {
            raw = "";
        }
        if (!hasExt) {
            raw = raw + extension;
        }

        String sanitized = sanitizeFileName(raw);
        if (!sanitized.toLowerCase(Locale.ROOT).endsWith(extension.toLowerCase(Locale.ROOT))) {
            sanitized = sanitizeFileName(sanitized + extension);
        }

        return sanitized;
    }

    private String formatChapterPadded(String chapterNumber, int width) {
        int padWidth = Math.max(1, width);
        String trimmed = chapterNumber == null ? "" : chapterNumber.trim();
        if (trimmed.isBlank()) {
            return String.format("%0" + padWidth + "d", 0);
        }

        String[] parts = trimmed.split("\\.", 2);
        String left = parts.length > 0 ? parts[0] : trimmed;
        String right = parts.length == 2 ? parts[1] : null;

        try {
            int value = Integer.parseInt(left);
            String padded = String.format("%0" + padWidth + "d", value);
            if (right != null && !right.isBlank()) {
                return padded + "." + right;
            }
            return padded;
        } catch (NumberFormatException e) {
            return trimmed;
        }
    }

    private String formatVolumePadded(int volumeNumber, int width) {
        return String.format("%0" + Math.max(1, width) + "d", Math.max(1, volumeNumber));
    }

    private int resolveChapterVolumeNumber(NewTitle titleRecord, String chapterNumber) {
        if (titleRecord == null || titleRecord.getChapterVolumeMap() == null || titleRecord.getChapterVolumeMap().isEmpty()) {
            return 1;
        }

        String normalizedChapter = normalizeChapterNumber(chapterNumber);
        if (normalizedChapter == null || normalizedChapter.isBlank()) {
            return 1;
        }

        Integer directMatch = titleRecord.getChapterVolumeMap().get(normalizedChapter);
        if (directMatch != null && directMatch > 0) {
            return directMatch;
        }

        for (Map.Entry<String, Integer> entry : titleRecord.getChapterVolumeMap().entrySet()) {
            if (!Objects.equals(normalizeChapterNumber(entry.getKey()), normalizedChapter)) {
                continue;
            }

            Integer value = entry.getValue();
            if (value != null && value > 0) {
                return value;
            }
        }

        return 1;
    }

    private String applyTemplate(String template, Map<String, String> values) {
        if (template == null) {
            return null;
        }

        String out = template;
        for (Map.Entry<String, String> entry : values.entrySet()) {
            String key = entry.getKey();
            if (key == null || key.isBlank()) continue;
            out = out.replace("{" + key + "}", entry.getValue() == null ? "" : entry.getValue());
        }

        return out;
    }

    private String sanitizePathSegment(String raw) {
        if (raw == null) {
            return "";
        }

        String cleaned = raw
                .replaceAll("[\\\\/:*?\\\"<>|]", "")
                .replaceAll("\\p{Cntrl}", "")
                .replaceAll("\\s+", " ")
                .trim()
                .replaceAll("[ .]+$", "");

        return cleaned.trim();
    }

    private String sanitizeFileName(String raw) {
        return sanitizePathSegment(raw);
    }

    protected int saveImagesToFolder(List<String> urls, Path folder, DownloadNamingSettings naming, NewTitle titleRecord, String chapterNumber) {
        int count = 0;
        int workerRateLimitKbps = getCurrentWorkerRateLimitKbps();

        try {
            Files.createDirectories(folder);
            int index = 1;
            Set<String> usedNames = new HashSet<>();

            for (String url : urls) {
                String ext = extractExtension(url);
                String fileName = formatPageFileName(naming, titleRecord, chapterNumber, index, ext);
                if (fileName == null || fileName.isBlank() || usedNames.contains(fileName)) {
                    fileName = String.format("%03d%s", index, ext);
                }
                usedNames.add(fileName);

                Path path = folder.resolve(fileName);
                try {
                    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setRequestProperty("User-Agent", USER_AGENT);
                    connection.setRequestProperty("Referer", REFERER);
                    connection.connect();

                    try (InputStream in = connection.getInputStream()) {
                        copyInputStreamToFileWithRateLimit(in, path, workerRateLimitKbps);
                        logger.info("DOWNLOAD", "➕ Saved image: " + path);
                        count++;
                    }
                } catch (IOException e) {
                    logger.error("DOWNLOAD", "❌ Failed image download: " + e.getMessage(), e);
                }
                index++;
            }
        } catch (IOException e) {
            logger.error("DOWNLOAD", "❌ Failed to save images: " + e.getMessage(), e);
        }

        return count;
    }

    private int getCurrentWorkerRateLimitKbps() {
        Integer workerIndex = resolveCurrentThreadWorkerIndex();
        if (workerIndex == null) {
            return 0;
        }

        List<Integer> rateLimits = settingsService.getDownloadWorkerSettings(getConfiguredDownloadThreads()).getThreadRateLimitsKbps();
        if (workerIndex < 0 || workerIndex >= rateLimits.size()) {
            return 0;
        }

        Integer rateLimitKbps = rateLimits.get(workerIndex);
        return rateLimitKbps != null && rateLimitKbps > 0 ? rateLimitKbps : 0;
    }

    private void copyInputStreamToFileWithRateLimit(InputStream inputStream, Path outputPath, int rateLimitKbps) throws IOException {
        try (OutputStream outputStream = Files.newOutputStream(
                outputPath,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE)) {
            byte[] buffer = new byte[8192];
            int bytesRead;
            long windowStartNs = System.nanoTime();
            long bytesWritten = 0L;

            while ((bytesRead = inputStream.read(buffer)) >= 0) {
                outputStream.write(buffer, 0, bytesRead);
                if (rateLimitKbps <= 0) {
                    continue;
                }

                bytesWritten += bytesRead;
                long expectedElapsedNs = (bytesWritten * 1_000_000_000L) / (rateLimitKbps * 1024L);
                long actualElapsedNs = System.nanoTime() - windowStartNs;

                if (expectedElapsedNs > actualElapsedNs) {
                    long sleepMs = TimeUnit.NANOSECONDS.toMillis(expectedElapsedNs - actualElapsedNs);
                    if (sleepMs > 0) {
                        try {
                            Thread.sleep(sleepMs);
                        } catch (InterruptedException interruptedException) {
                            Thread.currentThread().interrupt();
                            throw new IOException("Interrupted while applying Raven download rate limit.", interruptedException);
                        }
                    }
                }

                if (actualElapsedNs >= TimeUnit.SECONDS.toNanos(1)) {
                    windowStartNs = System.nanoTime();
                    bytesWritten = 0L;
                }
            }
        }
    }

    protected void zipFolderAsCbz(Path folder, Path cbzPath) {
        try (ZipOutputStream zipOut = new ZipOutputStream(Files.newOutputStream(cbzPath))) {
            Files.walk(folder).filter(Files::isRegularFile).forEach(file -> {
                try (InputStream in = Files.newInputStream(file)) {
                    zipOut.putNextEntry(new ZipEntry(file.getFileName().toString()));
                    in.transferTo(zipOut);
                    zipOut.closeEntry();
                } catch (IOException e) {
                    logger.error("DOWNLOAD", "❌ Failed adding file to CBZ: " + e.getMessage(), e);
                }
            });
        } catch (IOException e) {
            logger.error("DOWNLOAD", "❌ Failed to create CBZ: " + e.getMessage(), e);
        }
    }

    protected void deleteFolder(Path folderPath) {
        try {
            Files.walk(folderPath).sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.delete(path);
                } catch (IOException e) {
                    logger.warn("DOWNLOAD", "⚠️ Failed to delete " + path + ": " + e.getMessage());
                }
            });
            logger.info("DOWNLOAD", "🗑️ Deleted temp folder: " + folderPath);
        } catch (IOException e) {
            logger.warn("DOWNLOAD", "⚠️ Failed to delete folder: " + e.getMessage());
        }
    }

    /**
     * Fetches chapters.
     *
     * @param titleUrl The source title URL.
     * @return The resulting String>>.
    */

    public List<Map<String, String>> fetchChapters(String titleUrl) {
        return fetchAllChaptersWithRetry(titleUrl);
    }

    /**
     * Returns download statuses.
     *
     * @return The resulting list.
    */

    public List<DownloadProgress> getDownloadStatuses() {
        List<DownloadProgress> persisted = loadPersistedTasks(null);
        if (!persisted.isEmpty()) {
            List<DownloadProgress> active = new ArrayList<>();
            List<DownloadProgress> terminal = new ArrayList<>();
            for (DownloadProgress progress : persisted) {
                if (ACTIVE_TASK_STATUSES.contains(normalizeStatus(progress.getStatus()))) {
                    active.add(progress);
                } else {
                    terminal.add(progress);
                }
            }

            active.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt));
            terminal.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt).reversed());

            List<DownloadProgress> combined = new ArrayList<>(active);
            for (int index = 0; index < Math.min(MAX_STATUS_HISTORY_ENTRIES, terminal.size()); index++) {
                combined.add(terminal.get(index));
            }
            combined.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt));
            return combined;
        }

        List<DownloadProgress> statuses = new ArrayList<>();
        for (DownloadProgress progress : downloadProgress.values()) {
            statuses.add(progress.copy());
        }
        for (DownloadProgress history : progressHistory) {
            statuses.add(history.copy());
        }
        statuses.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt));
        return statuses;
    }

    /**
     * Returns download history.
     *
     * @return The resulting list.
    */

    public List<DownloadProgress> getDownloadHistory() {
        List<DownloadProgress> persisted = loadPersistedTasks(null);
        if (!persisted.isEmpty()) {
            List<DownloadProgress> history = new ArrayList<>();
            for (DownloadProgress progress : persisted) {
                if (!ACTIVE_TASK_STATUSES.contains(normalizeStatus(progress.getStatus()))) {
                    history.add(progress);
                }
            }
            history.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt).reversed());
            return history;
        }

        List<DownloadProgress> history = new ArrayList<>();
        for (DownloadProgress entry : progressHistory) {
            history.add(entry.copy());
        }
        history.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt).reversed());
        return history;
    }

    /**
     * Returns configured download threads.
     *
     * @return The resulting count or numeric value.
    */

    public int getConfiguredDownloadThreads() {
        return Math.max(1, configuredDownloadThreads);
    }

    /**
     * Returns active download count.
     *
     * @return The resulting count or numeric value.
    */

    public int getActiveDownloadCount() {
        List<DownloadProgress> persisted = loadPersistedTasks(new ArrayList<>(ACTIVE_TASK_STATUSES));
        if (!persisted.isEmpty()) {
            return persisted.size();
        }

        int activeCount = 0;
        for (DownloadProgress progress : downloadProgress.values()) {
            if (ACTIVE_TASK_STATUSES.contains(normalizeStatus(progress.getStatus()))) {
                activeCount++;
            }
        }
        return activeCount;
    }

    /**
     * Returns primary active download status.
     *
     * @return The resulting DownloadProgress.
    */

    public DownloadProgress getPrimaryActiveDownloadStatus() {
        List<DownloadProgress> persisted = loadPersistedTasks(new ArrayList<>(ACTIVE_TASK_STATUSES));
        if (!persisted.isEmpty()) {
            persisted.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt));
            return persisted.getFirst();
        }

        return downloadProgress.values().stream()
                .map(DownloadProgress::copy)
                .sorted(Comparator.comparingLong(DownloadProgress::getQueuedAt))
                .findFirst()
                .orElse(null);
    }

    /**
     * Returns current task snapshot.
     *
     * @return The resulting DownloadProgress.
    */

    public DownloadProgress getCurrentTaskSnapshot() {
        DownloadProgress active = getPrimaryActiveDownloadStatus();
        if (active != null) {
            return active;
        }

        List<DownloadProgress> persisted = loadPersistedTasks(null);
        if (!persisted.isEmpty()) {
            persisted.sort(Comparator
                    .comparingLong((DownloadProgress progress) -> Math.max(progress.getLastUpdated(), progress.getQueuedAt()))
                    .reversed());
            return persisted.getFirst();
        }

        try {
            Object cached = vaultService.getRedisValue(CURRENT_TASK_REDIS_KEY);
            if (cached instanceof Map<?, ?> map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> document = (Map<String, Object>) map;
                DownloadProgress progress = vaultService.parseJson(document, DownloadProgress.class);
                if (progress != null) {
                    return progress;
                }
            }
        } catch (Exception e) {
            warnSnapshotLoadFailure(e);
        }

        DownloadProgress latestHistory = progressHistory.peekFirst();
        return latestHistory == null ? null : latestHistory.copy();
    }

    private void warnSnapshotLoadFailure(Exception error) {
        long now = System.currentTimeMillis();
        if (now - lastSnapshotWarningAtMs < VAULT_SNAPSHOT_WARNING_COOLDOWN_MS) {
            return;
        }

        lastSnapshotWarningAtMs = now;
        logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to load cached Raven task snapshot: " + error.getMessage());
    }

    /**
     * Returns thread rate limits kbps.
     *
     * @return The resulting list.
    */

    public List<Integer> getThreadRateLimitsKbps() {
        return new ArrayList<>(settingsService.getDownloadWorkerSettings(getConfiguredDownloadThreads()).getThreadRateLimitsKbps());
    }

    /**
     * Returns worker cpu core ids.
     *
     * @return The resulting list.
    */

    public List<Integer> getWorkerCpuCoreIds() {
        return new ArrayList<>(settingsService.getDownloadWorkerSettings(getConfiguredDownloadThreads()).getCpuCoreIds());
    }

    /**
     * Returns available cpu ids.
     *
     * @return The resulting list.
    */

    public List<Integer> getAvailableCpuIds() {
        return cpuAffinity == null ? List.of() : cpuAffinity.getAvailableCpuIds();
    }

    /**
     * Returns worker execution mode.
     *
     * @return The resulting message or value.
    */

    public String getWorkerExecutionMode() {
        return resolveWorkerExecutionMode();
    }

    /**
     * Returns active workers.
     *
     * @return The resulting Object>>.
    */

    public List<Map<String, Object>> getActiveWorkers() {
        List<Map<String, Object>> workers = new ArrayList<>();
        List<DownloadProgress> activeTasks = new ArrayList<>(loadPersistedTasks(new ArrayList<>(ACTIVE_TASK_STATUSES)));
        Map<String, DownloadProgress> activeByTaskId = new HashMap<>();
        for (DownloadProgress progress : activeTasks) {
            if (progress.getTaskId() != null && !progress.getTaskId().isBlank()) {
                activeByTaskId.put(progress.getTaskId(), progress);
            }
        }

        synchronized (processWorkerLock) {
            if (!activeWorkerProcesses.isEmpty()) {
                List<ActiveWorkerProcess> handles = new ArrayList<>(activeWorkerProcesses.values());
                handles.sort(Comparator.comparingInt(ActiveWorkerProcess::workerIndex));
                for (ActiveWorkerProcess handle : handles) {
                    DownloadProgress progress = activeByTaskId.get(handle.taskId());
                    Map<String, Object> worker = new LinkedHashMap<>();
                    worker.put("taskId", handle.taskId());
                    worker.put("title", progress != null ? progress.getTitle() : handle.title());
                    worker.put("status", progress != null ? progress.getStatus() : "queued");
                    worker.put("workerIndex", handle.workerIndex());
                    worker.put("cpuCoreId", handle.cpuCoreId());
                    worker.put("workerPid", handle.pid());
                    worker.put("executionMode", handle.executionMode());
                    worker.put("pauseRequested", progress != null && progress.isPauseRequested());
                    workers.add(worker);
                }
                return workers;
            }
        }

        activeTasks.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt));
        for (DownloadProgress progress : activeTasks) {
            Map<String, Object> worker = new LinkedHashMap<>();
            worker.put("taskId", progress.getTaskId());
            worker.put("title", progress.getTitle());
            worker.put("status", progress.getStatus());
            worker.put("workerIndex", progress.getWorkerIndex());
            worker.put("cpuCoreId", progress.getCpuCoreId());
            worker.put("workerPid", progress.getWorkerPid());
            worker.put("executionMode", progress.getExecutionMode());
            worker.put("pauseRequested", progress.isPauseRequested());
            workers.add(worker);
        }
        return workers;
    }

    /**
     * Clears download status.
     *
     * @param titleName The title name to search or resolve.
    */

    public void clearDownloadStatus(String titleName) {
        DownloadProgress progress = downloadProgress.get(titleName);
        if (progress != null) {
            progress.setPauseRequested(true);
        }
        downloadProgress.remove(titleName);
        progressHistory.removeIf(p -> p.getTitle().equals(titleName));
        activeDownloads.remove(titleName);

        try {
            for (DownloadProgress p : loadPersistedTasksByTitle(titleName)) {
                if (p.getTaskId() != null && !p.getTaskId().isBlank()) {
                    vaultService.delete(TASK_COLLECTION, Map.of("taskId", p.getTaskId()));
                }
            }

            DownloadProgress currentSnapshot = getCurrentTaskSnapshot();
            if (currentSnapshot != null && titleName.equals(currentSnapshot.getTitle())) {
                vaultService.deleteRedisValue(CURRENT_TASK_REDIS_KEY);
            }
        } catch (Exception e) {
            logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to clear persisted Raven status: " + e.getMessage());
        }

        logger.debug("DOWNLOAD_SERVICE", "Cleared progress entry for title=" + sanitizeForLog(titleName));
    }

    /**
     * Clears all active and queued download statuses.
     */

    public void clearAllDownloads() {
        Set<String> titlesToClear = new HashSet<>(downloadProgress.keySet());
        Set<String> taskIdsToDelete = new HashSet<>();

        try {
            List<DownloadProgress> persisted = loadPersistedTasks(new ArrayList<>(RESTORABLE_TASK_STATUSES));
            for (DownloadProgress p : persisted) {
                if (p.getTitle() != null) {
                    titlesToClear.add(p.getTitle());
                }
                if (p.getTaskId() != null && !p.getTaskId().isBlank()) {
                    taskIdsToDelete.add(p.getTaskId());
                }
            }
        } catch (Exception e) {
            logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to load persisted tasks for clear-all: " + e.getMessage());
        }

        // 1. Mark active in-memory tasks for pause
        for (String title : titlesToClear) {
            DownloadProgress p = downloadProgress.get(title);
            if (p != null) {
                p.setPauseRequested(true);
            }
        }

        // 2. Clear memory state
        downloadProgress.keySet().removeAll(titlesToClear);
        progressHistory.removeIf(p -> p.getTitle() != null && titlesToClear.contains(p.getTitle()));
        for (String title : titlesToClear) {
            activeDownloads.remove(title);
        }

        // 3. Delete from Vault
        try {
            if (!taskIdsToDelete.isEmpty()) {
                vaultService.delete(TASK_COLLECTION, Map.of("taskId", Map.of("$in", new ArrayList<>(taskIdsToDelete))));
            }
            vaultService.deleteRedisValue(CURRENT_TASK_REDIS_KEY);
        } catch (Exception e) {
            logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to clear persisted Raven status in bulk: " + e.getMessage());
        }

        logger.info("DOWNLOAD_SERVICE", "🧹 Cleared " + titlesToClear.size() + " download task(s).");
    }

    /**
     * Clears all finished and interrupted download statuses from history.
     */

    public void clearDownloadHistory() {
        Set<String> titlesToClear = new HashSet<>();
        Set<String> taskIdsToDelete = new HashSet<>();

        for (DownloadProgress p : progressHistory) {
            if (p.getTitle() != null) {
                titlesToClear.add(p.getTitle());
            }
        }

        try {
            List<DownloadProgress> persisted = loadPersistedTasks(null);
            for (DownloadProgress p : persisted) {
                if (p.getTitle() != null && !ACTIVE_TASK_STATUSES.contains(normalizeStatus(p.getStatus()))) {
                    titlesToClear.add(p.getTitle());
                    if (p.getTaskId() != null && !p.getTaskId().isBlank()) {
                        taskIdsToDelete.add(p.getTaskId());
                    }
                }
            }
        } catch (Exception e) {
            logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to load persisted tasks for clear-history: " + e.getMessage());
        }

        // 1. Clear memory state
        progressHistory.removeIf(p -> p.getTitle() != null && titlesToClear.contains(p.getTitle()));
        // History items shouldn't be in downloadProgress or activeDownloads normally, but safety first
        for (String title : titlesToClear) {
            activeDownloads.remove(title);
            DownloadProgress p = downloadProgress.get(title);
            if (p != null && !ACTIVE_TASK_STATUSES.contains(normalizeStatus(p.getStatus()))) {
                downloadProgress.remove(title);
            }
        }

        // 2. Delete from Vault
        try {
            if (!taskIdsToDelete.isEmpty()) {
                vaultService.delete(TASK_COLLECTION, Map.of("taskId", Map.of("$in", new ArrayList<>(taskIdsToDelete))));
            }
        } catch (Exception e) {
            logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to clear persisted Raven history in bulk: " + e.getMessage());
        }

        logger.info("DOWNLOAD_SERVICE", "🧹 Cleared " + titlesToClear.size() + " download history entry(s).");
    }

    /**
     * Runs persisted task in worker.
     *
     * @param taskId The Raven task id.
     * @param workerIndex The worker index.
     * @param cpuCoreId The CPU core id.
     * @param executionMode The worker execution mode.
    */

    public void runPersistedTaskInWorker(String taskId, int workerIndex, int cpuCoreId, String executionMode) {
        String normalizedTaskId = taskId == null ? "" : taskId.trim();
        if (normalizedTaskId.isBlank()) {
            throw new IllegalArgumentException("raven.worker.task-id is required when Raven runs in worker mode.");
        }

        DownloadProgress progress = loadPersistedTaskById(normalizedTaskId);
        if (progress == null) {
            throw new IllegalStateException("Unable to load persisted Raven task for worker taskId=" + normalizedTaskId);
        }

        String titleName = progress.getTitle();
        if (titleName == null || titleName.isBlank() || progress.getSourceUrl() == null || progress.getSourceUrl().isBlank()) {
            throw new IllegalStateException("Persisted Raven task is missing title metadata for taskId=" + normalizedTaskId);
        }

        String normalizedExecutionMode = executionMode == null || executionMode.isBlank()
                ? EXECUTION_MODE_PROCESS
                : executionMode.trim().toLowerCase(Locale.ROOT);
        progress.assignWorker(workerIndex, cpuCoreId, ProcessHandle.current().pid(), normalizedExecutionMode);
        persistTaskSnapshot(progress);
        if (shouldPauseBeforeDownloadStart(titleName, progress)) {
            finalizeProgress(titleName, progress);
            return;
        }

        runDownload(titleName, buildSelectedTitle(progress), progress);
    }

    private void queueProgressForExecution(String titleName, Map<String, String> selectedTitle, DownloadProgress progress) {
        if (progress == null) {
            return;
        }

        if (isProcessWorkerMain()) {
            dispatchQueuedProcessWorkers();
            return;
        }

        downloadProgress.put(titleName, progress);
        Future<?> future = submitThreadedDownload(titleName, selectedTitle, progress);
        activeDownloads.put(titleName, future);
    }

    private Future<?> submitThreadedDownload(String titleName, Map<String, String> selectedTitle, DownloadProgress progress) {
        return ensureExecutor().submit(() -> runDownload(titleName, selectedTitle, progress));
    }

    private void assignThreadWorkerContext(DownloadProgress progress) {
        if (progress == null) {
            return;
        }

        Integer workerIndex = resolveCurrentThreadWorkerIndex();
        progress.assignWorker(workerIndex, -1, ProcessHandle.current().pid(), EXECUTION_MODE_THREAD);
    }

    private Integer resolveCurrentThreadWorkerIndex() {
        String threadName = Thread.currentThread().getName();
        if (threadName == null || !threadName.startsWith(DOWNLOAD_WORKER_NAME_PREFIX)) {
            return null;
        }

        String suffix = threadName.substring(DOWNLOAD_WORKER_NAME_PREFIX.length()).trim();
        try {
            int slotNumber = Integer.parseInt(suffix);
            return Math.max(0, slotNumber - 1);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private String resolveWorkerExecutionMode() {
        if (isWorkerMode()) {
            return runtimeProperties.getNormalizedWorkerExecutionMode();
        }
        return isProcessWorkerMain() ? EXECUTION_MODE_PROCESS : EXECUTION_MODE_THREAD;
    }

    private boolean isWorkerMode() {
        return runtimeProperties != null && runtimeProperties.isWorkerMode();
    }

    private boolean isProcessWorkerMain() {
        return runtimeProperties != null && runtimeProperties.useProcessWorkers();
    }

    private synchronized void startWorkerSupervisor() {
        if (workerSupervisor != null && !workerSupervisor.isShutdown() && !workerSupervisor.isTerminated()) {
            return;
        }

        workerSupervisor = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable);
            thread.setName("raven-download-supervisor");
            thread.setDaemon(true);
            return thread;
        });
        workerSupervisor.scheduleWithFixedDelay(this::runWorkerSupervisorTick, 0L, WORKER_SUPERVISOR_POLL_MS, TimeUnit.MILLISECONDS);
    }

    private void runWorkerSupervisorTick() {
        try {
            reconcileActiveWorkerProcesses();
            dispatchQueuedProcessWorkers();
        } catch (Exception e) {
            logger.warn("DOWNLOAD_SERVICE", "⚠️ Raven worker supervisor tick failed: " + e.getMessage());
        }
    }

    private void dispatchQueuedProcessWorkers() {
        if (!isProcessWorkerMain()) {
            return;
        }

        synchronized (processWorkerLock) {
            reconcileActiveWorkerProcesses();
            if (maintenancePauseActive.get()) {
                return;
            }

            if (shouldWaitForVpnConnection()) {
                publishQueuedVpnWaitingMessages();
                return;
            }

            List<DownloadProgress> queuedTasks = loadPersistedTasks(List.of("queued", "recovering"));
            if (queuedTasks.isEmpty()) {
                return;
            }

            queuedTasks.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt));
            List<Integer> cpuCoreIds = getWorkerCpuCoreIds();
            int maxWorkers = getConfiguredDownloadThreads();
            for (DownloadProgress progress : queuedTasks) {
                if (activeWorkerProcesses.size() >= maxWorkers) {
                    return;
                }
                if (progress == null || progress.getTaskId() == null || progress.getTaskId().isBlank()) {
                    continue;
                }
                if (progress.getTitle() == null || progress.getTitle().isBlank()
                        || progress.getSourceUrl() == null || progress.getSourceUrl().isBlank()) {
                    continue;
                }
                if (activeWorkerProcesses.containsKey(progress.getTaskId())) {
                    continue;
                }
                if (progress.isPauseRequested()) {
                    progress.markPaused("Pause requested before download started. Task saved for later.");
                    persistTaskSnapshot(progress);
                    continue;
                }

                int workerIndex = reserveAvailableWorkerSlot(maxWorkers);
                if (workerIndex < 0) {
                    return;
                }

                int cpuCoreId = workerIndex < cpuCoreIds.size() ? cpuCoreIds.get(workerIndex) : -1;
                progress.assignWorker(workerIndex, cpuCoreId, null, EXECUTION_MODE_PROCESS);
                persistTaskSnapshot(progress);

                try {
                    Process process = workerLauncher.launch(new RavenWorkerLauncher.WorkerLaunchRequest(
                            progress.getTaskId(),
                            workerIndex,
                            cpuCoreId,
                            EXECUTION_MODE_PROCESS
                    ));
                    long pid = process.pid();
                    progress.assignWorker(workerIndex, cpuCoreId, pid, EXECUTION_MODE_PROCESS);
                    persistTaskSnapshot(progress);
                    ActiveWorkerProcess handle = new ActiveWorkerProcess(
                            progress.getTaskId(),
                            progress.getTitle(),
                            workerIndex,
                            cpuCoreId,
                            process,
                            pid,
                            EXECUTION_MODE_PROCESS
                    );
                    activeWorkerProcesses.put(progress.getTaskId(), handle);
                    workerSlots.put(workerIndex, progress.getTaskId());
                } catch (Exception e) {
                    workerSlots.remove(workerIndex);
                    progress.markInterrupted("Failed to launch Raven worker process: " + e.getMessage());
                    persistTaskSnapshot(progress);
                    logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to launch Raven worker process: " + e.getMessage());
                }
            }
        }
    }

    private void reconcileActiveWorkerProcesses() {
        if (!isProcessWorkerMain()) {
            return;
        }

        synchronized (processWorkerLock) {
            List<ActiveWorkerProcess> handles = new ArrayList<>(activeWorkerProcesses.values());
            for (ActiveWorkerProcess handle : handles) {
                Process process = handle.process();
                if (process != null && process.isAlive()) {
                    continue;
                }

                activeWorkerProcesses.remove(handle.taskId());
                workerSlots.remove(handle.workerIndex());

                DownloadProgress progress = loadPersistedTaskById(handle.taskId());
                if (progress == null) {
                    continue;
                }

                String status = normalizeStatus(progress.getStatus());
                if (!ACTIVE_TASK_STATUSES.contains(status)) {
                    continue;
                }

                progress.assignWorker(handle.workerIndex(), handle.cpuCoreId(), handle.pid(), handle.executionMode());
                if (progress.isPauseRequested()) {
                    progress.markPaused(buildPauseMessage(progress.getRemainingChapterNumbers()));
                } else {
                    int exitCode = safeExitCode(process);
                    progress.markInterrupted("Raven worker process exited unexpectedly (exit " + exitCode + ").");
                }
                persistTaskSnapshot(progress);
            }
        }
    }

    private void publishQueuedVpnWaitingMessages() {
        String waitingMessage = "Waiting for Raven VPN connection before download starts.";
        for (DownloadProgress progress : loadPersistedTasks(List.of("queued", "recovering"))) {
            if (progress.isPauseRequested()) {
                continue;
            }
            if (waitingMessage.equals(progress.getMessage())) {
                continue;
            }
            progress.setMessage(waitingMessage);
            persistTaskSnapshot(progress);
        }
    }

    private int reserveAvailableWorkerSlot(int maxWorkers) {
        for (int index = 0; index < Math.max(1, maxWorkers); index++) {
            if (!workerSlots.containsKey(index)) {
                workerSlots.put(index, "");
                return index;
            }
        }
        return -1;
    }

    private void stopWorkerProcess(ActiveWorkerProcess handle) {
        if (handle == null || handle.process() == null) {
            return;
        }

        Process process = handle.process();
        if (!process.isAlive()) {
            return;
        }

        process.destroy();
        try {
            if (!process.waitFor(3, TimeUnit.SECONDS)) {
                process.destroyForcibly();
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
    }

    private int safeExitCode(Process process) {
        if (process == null) {
            return -1;
        }
        try {
            return process.exitValue();
        } catch (IllegalThreadStateException ignored) {
            return -1;
        }
    }

    private List<DownloadProgress> loadPersistedTasks(Collection<String> statuses) {
        return loadPersistedTasks(statuses, null);
    }

    private List<DownloadProgress> loadPersistedTasks(Collection<String> statuses, String titleName) {
        if (vaultService == null) {
            return List.of();
        }

        try {
            Map<String, Object> query = new HashMap<>();
            if (statuses != null && !statuses.isEmpty()) {
                query.put("status", Map.of("$in", new ArrayList<>(statuses)));
            }
            if (titleName != null && !titleName.isBlank()) {
                query.put("title", titleName);
            }

            List<Map<String, Object>> docs = vaultService.findMany(TASK_COLLECTION, query);
            if (docs == null || docs.isEmpty()) {
                return List.of();
            }

            List<DownloadProgress> progressEntries = new ArrayList<>();
            for (Map<String, Object> doc : docs) {
                DownloadProgress progress = vaultService.parseJson(doc, DownloadProgress.class);
                if (progress != null && progress.getTaskId() != null && !progress.getTaskId().isBlank()) {
                    progressEntries.add(progress);
                }
            }
            return progressEntries;
        } catch (Exception e) {
            return List.of();
        }
    }

    private List<DownloadProgress> loadPersistedTasksByTitle(String titleName) {
        return loadPersistedTasks(null, titleName);
    }

    private DownloadProgress loadPersistedTaskById(String taskId) {
        if (taskId == null || taskId.isBlank() || vaultService == null) {
            return null;
        }

        try {
            Map<String, Object> document = vaultService.findOne(TASK_COLLECTION, Map.of("taskId", taskId));
            return document == null ? null : vaultService.parseJson(document, DownloadProgress.class);
        } catch (Exception e) {
            return null;
        }
    }

    private boolean refreshPauseRequestedFlag(DownloadProgress progress) {
        if (progress == null) {
            return false;
        }

        DownloadProgress persisted = loadPersistedTaskById(progress.getTaskId());
        boolean pauseRequested = persisted != null ? persisted.isPauseRequested() : progress.isPauseRequested();
        if (progress.isPauseRequested() != pauseRequested) {
            progress.setPauseRequested(pauseRequested);
        }
        return pauseRequested;
    }

    private String normalizeStatus(String status) {
        return status == null ? "" : status.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Downloads single chapter.
     *
     * @param title The Raven title.
     * @param chapterNumber The chapter number.
     * @return True when the condition is satisfied.
    */

    public boolean downloadSingleChapter(NewTitle title, String chapterNumber) {
        return downloadSingleChapter(title, chapterNumber, null);
    }

    /**
     * Downloads single chapter.
     *
     * @param title The Raven title.
     * @param chapterNumber The chapter number.
     * @param progress The progress.
     * @return True when the condition is satisfied.
    */

    public boolean downloadSingleChapter(NewTitle title, String chapterNumber, DownloadProgress progress) {

        String titleUrl = title.getSourceUrl();
        DownloadNamingSettings naming = settingsService.getDownloadNamingSettings();
        Path workingTitleFolder = resolveWorkingTitleFolder(title, naming);
        Path finalTitleFolder = resolveFinalTitleFolder(title, naming);
        boolean completed = false;
        try {
            String sanitizedTitle = sanitizeForLog(title.getTitleName());
            logger.debug(
                    "DOWNLOAD",
                    "Single chapter download requested | title=" + sanitizedTitle +
                            " | chapterNumber=" + sanitizeForLog(chapterNumber));
            migrateExistingTitleFolder(title.getTitleName(), title.getDownloadPath(), finalTitleFolder);
            List<Map<String, String>> chapters = titleScraper.getChapters(titleUrl);
            logger.debug(
                    "DOWNLOAD",
                    "Retrieved chapters for single download | title=" + sanitizedTitle +
                            " | count=" + chapters.size());
            Optional<Map<String, String>> match = chapters.stream()
                    .filter(c -> chapterNumber.equals(extractChapterNumberFull(c.get("chapter_title"))))
                    .findFirst();

            if (match.isEmpty()) {
                logger.warn("DOWNLOAD", "⚠️ Chapter " + chapterNumber + " not found for " + title.getTitleName());
                return false;
            }

            Map<String, String> chapter = match.get();
            if (progress != null) {
                progress.chapterStarted(chapter.get("chapter_title"), chapterNumber);
                progress.setMessage("Downloading chapter " + chapterNumber + ".");
                persistTaskSnapshot(progress);
            }
            logger.debug(
                    "DOWNLOAD",
                    "Matched chapter | title=" + sanitizedTitle +
                            " | chapterTitle=" + sanitizeForLog(chapter.get("chapter_title")) +
                            " | url=" + sanitizeForLog(chapter.get("href")));
            List<String> pages = sourceFinder.findSource(chapter.get("href"));

            if (pages.isEmpty()) {
                logger.warn("DOWNLOAD", "⚠️ No pages found for chapter " + chapterNumber);
                if (progress != null) {
                    progress.setMessage("Chapter " + chapterNumber + " could not be resolved.");
                    persistTaskSnapshot(progress);
                }
                return false;
            }

            String domain = extractDomain(pages.get(0));
            Path chapterFolder = workingTitleFolder.resolve("temp_" + chapterNumber);
            Files.createDirectories(workingTitleFolder);
            int count = saveImagesToFolder(pages, chapterFolder, naming, title, chapterNumber);
            if (count <= 0) {
                logger.warn("DOWNLOAD", "⚠️ No files were saved for chapter " + chapterNumber);
                if (progress != null) {
                    progress.setMessage("Chapter " + chapterNumber + " did not finish downloading.");
                    persistTaskSnapshot(progress);
                }
                return false;
            }

            String cbzName = formatChapterCbzName(naming, title, chapterNumber, count, domain);
            Path cbzPath = workingTitleFolder.resolve(cbzName);
            zipFolderAsCbz(chapterFolder, cbzPath);
            deleteFolder(chapterFolder);
            promoteTitleFolder(workingTitleFolder, finalTitleFolder);
            title.setDownloadPath(finalTitleFolder.toString());
            mergeDownloadedChapter(title, chapterNumber);
            recordDownloadedChapterFile(title, chapterNumber, cbzName);
            completed = true;
            if (progress != null) {
                progress.chapterCompleted(chapterNumber);
                progress.setMessage("Downloaded chapter " + chapterNumber + ".");
                persistTaskSnapshot(progress);
            }

            logger.info("DOWNLOAD", "📦 Saved " + cbzName + " at " + cbzPath);

        } catch (Exception e) {
            logger.error("DOWNLOAD", "❌ Failed single chapter download: " + e.getMessage(), e);
            if (progress != null) {
                progress.setMessage("Chapter " + chapterNumber + " failed: " + e.getMessage());
                persistTaskSnapshot(progress);
            }
        }
        return completed;
    }

    private Path getDownloadRoot() {
        Path root = logger.getDownloadsRoot();
        if (root == null) {
            throw new IllegalStateException("LoggerService has not initialized the downloads root directory");
        }
        return root;
    }

    private Path getDownloadingRoot() {
        return getDownloadRoot().resolve(DOWNLOADING_FOLDER_NAME);
    }

    private Path getDownloadedRoot() {
        return getDownloadRoot().resolve(DOWNLOADED_FOLDER_NAME);
    }


    private Path resolveTitleFolder(NewTitle title) {
        return resolveFinalTitleFolder(title, settingsService.getDownloadNamingSettings());
    }

    private Path resolveTitleFolder(NewTitle title, DownloadNamingSettings naming) {
        return resolveFinalTitleFolder(title, naming);
    }

    private Path resolveWorkingTitleFolder(NewTitle title, DownloadNamingSettings naming) {
        if (title == null) {
            return getDownloadingRoot();
        }

        Path managedPath = resolveManagedTitleFolder(title.getDownloadPath(), getDownloadingRoot());
        if (managedPath != null) {
            return managedPath;
        }

        return resolveWorkingTitleFolder(title.getTitleName(), title.getType(), naming);
    }

    private Path resolveFinalTitleFolder(NewTitle title, DownloadNamingSettings naming) {
        if (title == null) {
            return getDownloadedRoot();
        }

        Path managedPath = resolveManagedTitleFolder(title.getDownloadPath(), getDownloadedRoot());
        if (managedPath != null) {
            return managedPath;
        }

        return resolveFinalTitleFolder(title.getTitleName(), title.getType(), naming);
    }

    private Path resolveTitleFolder(String titleName, String type) {
        return resolveFinalTitleFolder(titleName, type, settingsService.getDownloadNamingSettings());
    }

    private Path resolveTitleFolder(String titleName, String type, DownloadNamingSettings naming) {
        return resolveFinalTitleFolder(titleName, type, naming);
    }

    private Path resolveWorkingTitleFolder(String titleName, String type, DownloadNamingSettings naming) {
        return resolveTitleFolder(getDownloadingRoot(), titleName, type, naming);
    }

    private Path resolveFinalTitleFolder(String titleName, String type, DownloadNamingSettings naming) {
        return resolveTitleFolder(getDownloadedRoot(), titleName, type, naming);
    }

    private Path resolveTitleFolder(Path root, String titleName, String type, DownloadNamingSettings naming) {
        String cleanTitle = formatTitleFolderName(naming, titleName, type);
        if (cleanTitle == null || cleanTitle.isBlank()) {
            throw new IllegalArgumentException("titleName is required");
        }

        String typeFolder = resolveMediaTypeFolder(type);
        Path base = typeFolder != null ? root.resolve(typeFolder) : root;
        return base.resolve(cleanTitle);
    }

    private Path resolveManagedTitleFolder(String downloadPath, Path targetRoot) {
        Path existingPath = parsePath(downloadPath);
        if (existingPath == null) {
            return null;
        }

        Path normalizedTargetRoot = targetRoot.normalize();
        if (existingPath.startsWith(normalizedTargetRoot)) {
            return existingPath;
        }

        Path downloadRoot = getDownloadRoot().normalize();
        if (!existingPath.startsWith(downloadRoot)) {
            return null;
        }

        Path relativePath = downloadRoot.relativize(existingPath);
        Path strippedRelativePath = stripManagedFolderPrefix(relativePath);
        if (strippedRelativePath == null) {
            return normalizedTargetRoot;
        }

        return normalizedTargetRoot.resolve(strippedRelativePath);
    }

    private Path stripManagedFolderPrefix(Path relativePath) {
        if (relativePath == null || relativePath.getNameCount() == 0) {
            return null;
        }

        String firstSegment = relativePath.getName(0).toString();
        if (!DOWNLOADING_FOLDER_NAME.equalsIgnoreCase(firstSegment) && !DOWNLOADED_FOLDER_NAME.equalsIgnoreCase(firstSegment)) {
            return relativePath;
        }

        if (relativePath.getNameCount() == 1) {
            return null;
        }

        return relativePath.subpath(1, relativePath.getNameCount());
    }

    private Path parsePath(String rawPath) {
        if (rawPath == null || rawPath.isBlank()) {
            return null;
        }

        try {
            return Path.of(rawPath).normalize();
        } catch (Exception ignored) {
            return null;
        }
    }

    private String sanitizeStoredFileName(String rawName) {
        if (rawName == null || rawName.isBlank()) {
            return "";
        }

        try {
            return Path.of(rawName).getFileName().toString().trim();
        } catch (Exception ignored) {
            return rawName.trim();
        }
    }

    private LinkedHashMap<String, String> sortChapterFileMap(Map<String, String> chapterFiles) {
        LinkedHashMap<String, String> sorted = new LinkedHashMap<>();
        if (chapterFiles == null || chapterFiles.isEmpty()) {
            return sorted;
        }

        List<Map.Entry<String, String>> entries = new ArrayList<>();
        for (Map.Entry<String, String> entry : chapterFiles.entrySet()) {
            String normalizedChapter = normalizeChapterNumber(entry.getKey());
            String normalizedFileName = sanitizeStoredFileName(entry.getValue());
            if (normalizedChapter == null || normalizedChapter.isBlank() || normalizedFileName.isBlank()) {
                continue;
            }
            entries.add(Map.entry(normalizedChapter, normalizedFileName));
        }

        entries.sort((left, right) -> compareChapterNumbers(left.getKey(), right.getKey()));
        for (Map.Entry<String, String> entry : entries) {
            sorted.put(entry.getKey(), entry.getValue());
        }
        return sorted;
    }

    private String stripTrailingFileDecorators(String rawText) {
        String stripped = rawText == null ? "" : rawText.trim();
        if (stripped.isBlank()) {
            return stripped;
        }

        stripped = stripped.replaceFirst("(?i)\\.cbz$", "").trim();
        boolean changed;
        do {
            changed = false;
            String next = stripped.replaceFirst("\\s*(\\[[^\\]]*]|\\([^)]*\\))\\s*$", "").trim();
            if (!next.equals(stripped)) {
                stripped = next;
                changed = true;
            }
        } while (changed);

        return stripped;
    }

    private void migrateExistingTitleFolder(String titleName, String existingDownloadPath, Path finalTitleFolder) {
        Path existingPath = parsePath(existingDownloadPath);
        if (existingPath == null || existingPath.equals(finalTitleFolder.normalize())) {
            return;
        }

        try {
            if (!Files.exists(existingPath) || !Files.isDirectory(existingPath)) {
                return;
            }

            promoteTitleFolder(existingPath, finalTitleFolder);
        } catch (Exception e) {
            logger.warn(
                    "DOWNLOAD",
                    "Failed to migrate title folder for [" + sanitizeForLog(titleName) + "]: " + e.getMessage());
        }
    }

    protected void promoteTitleFolder(Path sourceFolder, Path targetFolder) throws IOException {
        if (sourceFolder == null || targetFolder == null) {
            return;
        }

        Path normalizedSource = sourceFolder.normalize();
        Path normalizedTarget = targetFolder.normalize();
        if (normalizedSource.equals(normalizedTarget) || !Files.exists(normalizedSource) || !Files.isDirectory(normalizedSource)) {
            return;
        }

        Path targetParent = normalizedTarget.getParent();
        if (targetParent != null) {
            Files.createDirectories(targetParent);
        }

        if (!Files.exists(normalizedTarget)) {
            Files.move(normalizedSource, normalizedTarget, StandardCopyOption.REPLACE_EXISTING);
        } else {
            moveDirectoryContents(normalizedSource, normalizedTarget);
            Files.deleteIfExists(normalizedSource);
        }

        pruneEmptyManagedParents(normalizedSource.getParent());
    }

    private void moveDirectoryContents(Path sourceFolder, Path targetFolder) throws IOException {
        Files.createDirectories(targetFolder);

        List<Path> children;
        try (var stream = Files.list(sourceFolder)) {
            children = stream.toList();
        }

        for (Path child : children) {
            Path targetChild = targetFolder.resolve(child.getFileName().toString());
            if (Files.isDirectory(child)) {
                moveDirectoryContents(child, targetChild);
                Files.deleteIfExists(child);
                continue;
            }

            Files.move(child, targetChild, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private void pruneEmptyManagedParents(Path folder) {
        Path stopRoot = getDownloadingRoot().normalize();
        Path current = folder;
        while (current != null && current.startsWith(stopRoot) && !current.equals(stopRoot)) {
            try (var stream = Files.list(current)) {
                if (stream.findAny().isPresent()) {
                    break;
                }
            } catch (Exception ignored) {
                break;
            }

            try {
                Files.deleteIfExists(current);
            } catch (IOException ignored) {
                break;
            }
            current = current.getParent();
        }
    }

    private String resolveMediaTypeFolder(String rawType) {
        String normalized = normalizeMediaType(rawType);
        if (normalized == null) {
            return null;
        }
        return slugifyFolderSegment(normalized);
    }

    private String normalizeMediaType(String raw) {
        if (raw == null) {
            return null;
        }

        String trimmed = raw.trim();
        if (trimmed.isBlank()) {
            return null;
        }

        String cleaned = trimmed.replaceFirst("(?i)^Type:?\\s*", "").replaceAll("\\s+", " ").trim();
        if (cleaned.isBlank()) {
            return null;
        }

        String lower = cleaned.toLowerCase(Locale.ROOT);
        return switch (lower) {
            case "manga", "managa" -> "Manga";
            case "manhwa" -> "Manhwa";
            case "manhua" -> "Manhua";
            case "oel" -> "OEL";
            default -> prettifyLabel(cleaned);
        };
    }

    private void applyTitleDetailsMetadata(NewTitle titleRecord, TitleDetails details) {
        if (titleRecord == null || details == null) {
            return;
        }

        if (details.getSummary() != null && !details.getSummary().isBlank()) {
            titleRecord.setSummary(details.getSummary().trim());
        }

        String normalizedType = normalizeMediaType(details.getType());
        if (normalizedType != null) {
            titleRecord.setType(normalizedType);
        }

        if (details.getAssociatedNames() != null && !details.getAssociatedNames().isEmpty()) {
            titleRecord.setAssociatedNames(new ArrayList<>(details.getAssociatedNames()));
        }

        if (details.getStatus() != null && !details.getStatus().isBlank()) {
            titleRecord.setStatus(details.getStatus().trim());
        }

        if (details.getReleased() != null && !details.getReleased().isBlank()) {
            titleRecord.setReleased(details.getReleased().trim());
        }

        if (details.getOfficialTranslation() != null) {
            titleRecord.setOfficialTranslation(details.getOfficialTranslation());
        }

        if (details.getAnimeAdaptation() != null) {
            titleRecord.setAnimeAdaptation(details.getAnimeAdaptation());
        }

        if (details.getRelatedSeries() != null && !details.getRelatedSeries().isEmpty()) {
            List<Map<String, String>> relatedSeries = new ArrayList<>();
            for (Map<String, String> entry : details.getRelatedSeries()) {
                if (entry == null || entry.isEmpty()) {
                    continue;
                }
                relatedSeries.add(new LinkedHashMap<>(entry));
            }
            if (!relatedSeries.isEmpty()) {
                titleRecord.setRelatedSeries(relatedSeries);
            }
        }
    }

    private String prettifyLabel(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isBlank()) return null;

        boolean hasUpper = false;
        boolean hasLower = false;
        for (int i = 0; i < trimmed.length(); i++) {
            char ch = trimmed.charAt(i);
            if (!Character.isLetter(ch)) continue;
            if (Character.isUpperCase(ch)) hasUpper = true;
            if (Character.isLowerCase(ch)) hasLower = true;
        }

        if (hasUpper && hasLower) {
            return trimmed;
        }

        String[] parts = trimmed.toLowerCase(Locale.ROOT).split("\\s+");
        StringBuilder out = new StringBuilder();
        for (String part : parts) {
            if (part.isBlank()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(Character.toUpperCase(part.charAt(0)));
            if (part.length() > 1) {
                out.append(part.substring(1));
            }
        }

        String result = out.toString().trim();
        return result.isBlank() ? trimmed : result;
    }

    private String slugifyFolderSegment(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isBlank()) return null;

        String lower = trimmed.toLowerCase(Locale.ROOT);
        String slug = lower
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+", "")
                .replaceAll("-+$", "");
        return slug.isBlank() ? null : slug;
    }

    private String sanitizeFolderName(String raw) {
        if (raw == null) {
            return null;
        }

        return raw.replaceAll("[^a-zA-Z0-9\s]", "").trim();
    }

    private void cleanupExpiredSearches() {
        long now = currentTimeSupplier.get();
        logger.debug("SEARCH", "Running search session cleanup | timestamp=" + now);
        searchSessions.entrySet().removeIf(entry -> {
            boolean expired = entry.getValue().isExpired(now);
            if (expired) {
                logger.debug(
                        "SEARCH",
                        "Removing expired search session | searchId=" + sanitizeForLog(entry.getKey()));
            }
            return expired;
        });
    }

    private List<Map<String, String>> getSearchResults(String searchId) {
        cleanupExpiredSearches();
        SearchSession session = searchSessions.get(searchId);
        if (session == null) {
            return null;
        }
        return session.getResultsCopy();
    }

    void setCurrentTimeSupplier(Supplier<Long> currentTimeSupplier) {
        this.currentTimeSupplier = Objects.requireNonNull(currentTimeSupplier);
    }

    private boolean isTerminalStatus(String status) {
        return TERMINAL_STATUSES.contains(normalizeStatus(status));
    }

    private String sanitizeForLog(String value) {
        if (value == null) {
            return "";
        }
        return value.replaceAll("[\\r\\n]", "").replaceAll("[^-\\p{Alnum}\\s_:]", "").trim();
    }

    private String normalizeQueueTitle(String value) {
        if (value == null) {
            return "Unknown title";
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? "Unknown title" : trimmed;
    }

    private String buildAlreadyActiveMessage(List<String> skippedTitles) {
        if (skippedTitles == null || skippedTitles.isEmpty()) {
            return "Download already in progress.";
        }
        if (skippedTitles.size() == 1) {
            return "Download already in progress for: " + skippedTitles.get(0);
        }
        return "Downloads already in progress for: " + String.join(", ", skippedTitles);
    }

    private String normalizeBulkTitlePrefix(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private List<Map<String, String>> filterTitlesByPrefix(List<Map<String, String>> titles, String titlePrefix) {
        if (titles == null || titles.isEmpty() || titlePrefix == null || titlePrefix.isBlank()) {
            return List.of();
        }

        String normalizedPrefix = titlePrefix.toLowerCase(Locale.ROOT);
        List<Map<String, String>> matched = new ArrayList<>();
        for (Map<String, String> title : titles) {
            if (title == null || title.isEmpty()) {
                continue;
            }

            String comparableTitle = titleScraper.normalizePrefixComparableTitle(title.get("title"));
            if (comparableTitle == null || comparableTitle.isBlank()) {
                continue;
            }

            if (comparableTitle.toLowerCase(Locale.ROOT).startsWith(normalizedPrefix)) {
                matched.add(new HashMap<>(title));
            }
        }

        return matched.isEmpty() ? List.of() : List.copyOf(matched);
    }


    private String resolveBulkQueueStatus(
            List<String> queuedTitles,
            List<String> skippedActiveTitles,
            List<String> failedTitles
    ) {
        boolean hasQueued = queuedTitles != null && !queuedTitles.isEmpty();
        boolean hasSkipped = skippedActiveTitles != null && !skippedActiveTitles.isEmpty();
        boolean hasFailed = failedTitles != null && !failedTitles.isEmpty();

        if (hasQueued && !hasSkipped && !hasFailed) {
            return BulkQueueDownloadResult.STATUS_QUEUED;
        }
        if (!hasQueued && hasSkipped && !hasFailed) {
            return BulkQueueDownloadResult.STATUS_ALREADY_ACTIVE;
        }
        return BulkQueueDownloadResult.STATUS_PARTIAL;
    }

    private String buildBulkQueueMessage(
            List<String> queuedTitles,
            List<String> skippedActiveTitles,
            List<String> failedTitles,
            int matchedCount
    ) {
        int queuedCount = queuedTitles == null ? 0 : queuedTitles.size();
        int skippedCount = skippedActiveTitles == null ? 0 : skippedActiveTitles.size();
        int failedCount = failedTitles == null ? 0 : failedTitles.size();

        if (matchedCount <= 0) {
            return "No titles matched the supplied filters.";
        }
        if (queuedCount > 0 && skippedCount == 0 && failedCount == 0) {
            return "Queued " + queuedCount + " title(s) for download.";
        }
        if (queuedCount == 0 && skippedCount > 0 && failedCount == 0) {
            return buildAlreadyActiveMessage(skippedActiveTitles);
        }

        return "Queued " + queuedCount + " title(s). Skipped " + skippedCount
                + " already-active title(s). Failed " + failedCount + " title(s).";
    }

    private record ActiveWorkerProcess(
            String taskId,
            String title,
            int workerIndex,
            int cpuCoreId,
            Process process,
            long pid,
            String executionMode
    ) {
    }

    private static class SearchSession {
        private final List<Map<String, String>> results;
        private final long createdAt;

        private SearchSession(List<Map<String, String>> results, long createdAt) {
            this.results = results;
            this.createdAt = createdAt;
        }

        private boolean isExpired(long now) {
            return now - createdAt > SEARCH_TTL_MILLIS;
        }

        private List<Map<String, String>> getResultsCopy() {
            List<Map<String, String>> copy = new ArrayList<>();
            for (Map<String, String> result : results) {
                copy.add(new HashMap<>(result));
            }
            return copy;
        }
    }

    /**
     * Represents Raven search sessions, queueing, worker execution, persistence, and chapter downloads.
     *
     * @param pausedImmediately The paused immediately.
     * @param pausingAfterCurrentChapter The pausing after current chapter.
    */

    public record PauseRequestResult(
            List<String> pausedImmediately,
            List<String> pausingAfterCurrentChapter
    ) {
        public PauseRequestResult {
            pausedImmediately = pausedImmediately == null ? List.of() : List.copyOf(pausedImmediately);
            pausingAfterCurrentChapter = pausingAfterCurrentChapter == null
                    ? List.of()
                    : List.copyOf(pausingAfterCurrentChapter);
        }

        /**
         * Returns affected tasks.
         *
         * @return The resulting count or numeric value.
         */

        public int getAffectedTasks() {
            return pausedImmediately.size() + pausingAfterCurrentChapter.size();
        }

        /**
         * Returns the distinct titles affected by the pause request.
         *
         * @return The affected titles in first-seen order.
         */
        public List<String> affectedTitles() {
            LinkedHashSet<String> titles = new LinkedHashSet<>(pausedImmediately);
            titles.addAll(pausingAfterCurrentChapter);
            return List.copyOf(titles);
        }
    }
}
