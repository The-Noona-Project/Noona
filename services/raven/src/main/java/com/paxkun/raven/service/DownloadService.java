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

@Service
public class DownloadService {
    private static final String DOWNLOAD_WORKER_NAME_PREFIX = "raven-download-";
    private static final String DOWNLOADING_FOLDER_NAME = "downloading";
    private static final String DOWNLOADED_FOLDER_NAME = "downloaded";
    private static final String TASK_COLLECTION = "raven_download_tasks";
    private static final String CURRENT_TASK_REDIS_KEY = "raven:download:current-task";
    private static final long VAULT_SNAPSHOT_WARNING_COOLDOWN_MS = TimeUnit.SECONDS.toMillis(30);
    private static final long VPN_CONNECTION_WAIT_POLL_MS = 1000L;
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

    private static final String USER_AGENT = "Mozilla/5.0";
    private static final String REFERER = "https://weebcentral.com";

    @Value("${raven.download.threads:${RAVEN_DOWNLOAD_THREADS:3}}")
    private int configuredDownloadThreads;

    private ExecutorService executor;
    private final Map<String, Future<?>> activeDownloads = new ConcurrentHashMap<>();
    private final Set<String> pauseRequestedDownloads = ConcurrentHashMap.newKeySet();
    private final AtomicBoolean maintenancePauseActive = new AtomicBoolean(false);
    private final Map<String, DownloadProgress> downloadProgress = new ConcurrentHashMap<>();
    private final Deque<DownloadProgress> progressHistory = new ConcurrentLinkedDeque<>();
    private final Map<String, SearchSession> searchSessions = new ConcurrentHashMap<>();
    private volatile long lastSnapshotWarningAtMs = 0L;

    private static final long SEARCH_TTL_MILLIS = TimeUnit.MINUTES.toMillis(10);
    private Supplier<Long> currentTimeSupplier = System::currentTimeMillis;

    private synchronized ExecutorService ensureExecutor() {
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

    @PostConstruct
    public void initExecutor() {
        ensureExecutor();
        restorePersistedDownloads();
    }

    @PreDestroy
    public void shutdownExecutor() {
        if (executor == null) {
            return;
        }

        executor.shutdownNow();
    }

    void restorePersistedDownloads() {
        try {
            List<Map<String, Object>> docs = vaultService.findMany(
                    TASK_COLLECTION,
                    Map.of("status", Map.of("$in", List.of("queued", "downloading", "recovering", "interrupted")))
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

                progress.markRecoveredFromCache("restored-from-vault");
                persistTaskSnapshot(progress);
                Future<?> future = ensureExecutor().submit(() -> runDownload(titleName, buildSelectedTitle(progress), progress));
                downloadProgress.put(titleName, progress);
                activeDownloads.put(titleName, future);
            }
        } catch (Exception e) {
            logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to restore persisted Raven downloads: " + e.getMessage());
        }
    }

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

    public TitleDetails getTitleDetails(String titleUrl) {
        return titleScraper.getTitleDetails(titleUrl);
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
        progress.setMessage("Queued in Raven.");
        persistTaskSnapshot(progress);
        return progress;
    }

    boolean isTaskActive(String titleName) {
        if (titleName == null || titleName.isBlank()) {
            return false;
        }

        DownloadProgress progress = downloadProgress.get(titleName);
        if (progress == null) {
            return activeDownloads.containsKey(titleName);
        }

        String status = Optional.ofNullable(progress.getStatus()).orElse("").trim().toLowerCase(Locale.ROOT);
        return !isTerminalStatus(status);
    }

    public PauseRequestResult requestPauseActiveDownloads() {
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

            pauseRequestedDownloads.add(titleName);
            if ("queued".equals(status)) {
                Future<?> future = activeDownloads.get(titleName);
                boolean pausedBeforeStart = future != null && future.cancel(false);
                if (pausedBeforeStart) {
                    progress.markPaused("Pause requested before chapter download started. Task saved for later.");
                    persistTaskSnapshot(progress);
                    activeDownloads.remove(titleName);
                    pauseRequestedDownloads.remove(titleName);
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

    public void beginMaintenancePause(String reason) {
        maintenancePauseActive.set(true);
        logger.info("DOWNLOAD_SERVICE", "⏸️ Raven maintenance pause enabled. " + sanitizeForLog(reason));
    }

    public void endMaintenancePause(String reason) {
        maintenancePauseActive.set(false);
        logger.info("DOWNLOAD_SERVICE", "▶️ Raven maintenance pause cleared. " + sanitizeForLog(reason));
    }

    public boolean isMaintenancePauseActive() {
        return maintenancePauseActive.get();
    }

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

    public int resumePausedDownloads() {
        List<Map<String, Object>> docs;
        try {
            docs = vaultService.findMany(TASK_COLLECTION, Map.of("status", "paused"));
        } catch (Exception e) {
            logger.warn("DOWNLOAD_SERVICE", "⚠️ Failed to read paused Raven tasks from Vault: " + e.getMessage());
            return 0;
        }

        if (docs == null || docs.isEmpty()) {
            return 0;
        }

        List<DownloadProgress> pausedTasks = new ArrayList<>();
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
            pausedTasks.add(progress);
        }

        pausedTasks.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt));
        int resumed = 0;
        for (DownloadProgress progress : pausedTasks) {
            String titleName = progress.getTitle();
            if (titleName == null || titleName.isBlank() || isTaskActive(titleName)) {
                continue;
            }

            pauseRequestedDownloads.remove(titleName);
            progress.markRecoveredFromCache("vpn-rotation-resume");
            progress.setMessage("Resumed after Raven VPN rotation.");
            persistTaskSnapshot(progress);

            Map<String, String> selectedTitle = buildSelectedTitle(progress);
            downloadProgress.put(titleName, progress);
            Future<?> future = ensureExecutor().submit(() -> runDownload(titleName, selectedTitle, progress));
            activeDownloads.put(titleName, future);
            resumed++;
        }

        return resumed;
    }

    private boolean hasInFlightDownloads() {
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

    public String queueDownloadAllChapters(String searchId, int userIndex) {
        if (maintenancePauseActive.get()) {
            return "⚠️ Raven is temporarily pausing new downloads while VPN rotation completes.";
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
            return "⚠️ Search session expired or not found. Please search again.";
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
                return "⚠️ No search results to download.";
            }

            StringBuilder queued = new StringBuilder("✅ Queued downloads for: ");
            List<String> queuedTitles = new ArrayList<>();
            for (Map<String, String> title : results) {
                String titleName = title.get("title");
                String sanitizedTitle = sanitizeForLog(titleName);
                logger.debug(
                        "DOWNLOAD_SERVICE",
                        "Evaluating title for queue | searchId=" + sanitizedSearchId +
                                " | title=" + sanitizedTitle);
                if (activeDownloads.containsKey(titleName)) {
                    logger.debug(
                            "DOWNLOAD_SERVICE",
                            "Title already downloading | title=" + sanitizedTitle);
                    logger.info("DOWNLOAD", "🔁 Skipping already active download: " + titleName);
                    continue;
                }

                DownloadProgress progress = createQueuedProgress(titleName, title, "library-download");
                downloadProgress.put(titleName, progress);
                Future<?> future = ensureExecutor().submit(() -> runDownload(titleName, title, progress));
                activeDownloads.put(titleName, future);
                queued.append(titleName).append(", ");
                queuedTitles.add(sanitizedTitle);
                logger.debug(
                        "DOWNLOAD_SERVICE",
                        "Queued title for download | title=" + sanitizedTitle);
            }
            searchSessions.remove(searchId);
            logger.debug(
                    "DOWNLOAD_SERVICE",
                    "Queued titles summary | searchId=" + sanitizedSearchId +
                            " | titles=" + String.join(";", queuedTitles));
            return queued.toString();

        } else {
            Map<String, String> selectedTitle;
            try {
                selectedTitle = getSelectedTitle(results, userIndex);
            } catch (IndexOutOfBoundsException e) {
                logger.debug(
                        "DOWNLOAD_SERVICE",
                        "Invalid selection index | searchId=" + sanitizedSearchId +
                                " | userIndex=" + userIndex);
                return "⚠️ Invalid selection. Please choose a valid option.";
            }
            String titleName = selectedTitle.get("title");
            String sanitizedTitle = sanitizeForLog(titleName);

            logger.debug(
                    "DOWNLOAD_SERVICE",
                    "Processing SINGLE title branch | searchId=" + sanitizedSearchId +
                            " | userIndex=" + userIndex + " | title=" + sanitizedTitle);

            if (activeDownloads.containsKey(titleName)) {
                logger.debug(
                        "DOWNLOAD_SERVICE",
                        "Active download already in progress | title=" + sanitizedTitle);
                return "⚠️ Download already in progress for: " + titleName;
            }

            DownloadProgress progress = createQueuedProgress(titleName, selectedTitle, "library-download");
            downloadProgress.put(titleName, progress);
            Future<?> future = ensureExecutor().submit(() -> runDownload(titleName, selectedTitle, progress));
            activeDownloads.put(titleName, future);
            // Keep the search session so clients can queue multiple selected options from one search result.
            logger.debug(
                    "DOWNLOAD_SERVICE",
                    "Queued single title | title=" + sanitizedTitle +
                            " | searchId=" + sanitizedSearchId);
            return "✅ Download queued for: " + titleName;
        }
    }

    private void runDownload(String titleName, Map<String, String> selectedTitle, DownloadProgress progress) {
        DownloadChapter result = new DownloadChapter();

        try {
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
                int pageCount = saveImagesToFolder(pageUrls, chapterFolder, naming, titleName, titleRecord.getType(), chapterNumber);
                if (pageCount <= 0) {
                    logger.warn("DOWNLOAD", "⚠️ No files were saved for chapter " + chapterNumber + ". Leaving it pending.");
                    failedChapters.add(chapterNumber);
                    progress.setMessage("Chapter " + chapterNumber + " did not finish downloading. It will be left pending.");
                    persistTaskSnapshot(progress);
                    continue;
                }

                String cbzName = formatChapterCbzName(naming, titleName, titleRecord.getType(), chapterNumber, pageCount, sourceDomain);
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
            pauseRequestedDownloads.remove(titleName);
            activeDownloads.remove(titleName);
            logger.debug(
                    "DOWNLOAD",
                    "Removed active download entry | title=" + sanitizeForLog(titleName));
            finalizeProgress(titleName, progress);
        }
    }

    private boolean waitForVpnConnectionIfRequired(String titleName, DownloadProgress progress) {
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
        DownloadVpnSettings vpnSettings = settingsService.getDownloadVpnSettings();
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
        while (progressHistory.size() > 10) {
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
        document.put("lastUpdated", progress.getLastUpdated());
        return document;
    }

    private boolean shouldPauseBeforeDownloadStart(String titleName, DownloadProgress progress) {
        if (titleName == null || titleName.isBlank() || progress == null || !pauseRequestedDownloads.contains(titleName)) {
            return false;
        }

        progress.markPaused("Pause requested before download started. Task saved for later.");
        persistTaskSnapshot(progress);
        return true;
    }

    private boolean shouldPauseAtChapterBoundary(String titleName, DownloadProgress progress) {
        if (titleName == null || titleName.isBlank() || progress == null || !pauseRequestedDownloads.contains(titleName)) {
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

        List<String> current = titleRecord.getDownloadedChapterNumbers() == null
                ? new ArrayList<>()
                : new ArrayList<>(titleRecord.getDownloadedChapterNumbers());
        if (!current.contains(chapterNumber)) {
            current.add(chapterNumber);
            current.sort(this::compareChapterNumbers);
            titleRecord.setDownloadedChapterNumbers(current);
        }
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
        if (text == null || text.isEmpty()) return "0000";

        Matcher m = Pattern.compile("Chapter\\s*(\\d+(\\.\\d+)?)").matcher(text);
        if (m.find()) return m.group(1);

        m = Pattern.compile("(\\d+(\\.\\d+)?)").matcher(text);
        if (m.find()) return m.group(1);

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

    private String formatChapterCbzName(DownloadNamingSettings naming, String titleName, String type, String chapterNumber, int pageCount, String domain) {
        String title = titleName == null ? "" : titleName.trim();
        String normalizedType = normalizeMediaType(type);
        String typeSlug = resolveMediaTypeFolder(type);
        String chapter = chapterNumber == null ? "" : chapterNumber.trim();

        int chapterPad = naming != null && naming.getChapterPad() != null ? Math.max(1, naming.getChapterPad()) : 3;
        String chapterPadded = formatChapterPadded(chapter, chapterPad);

        String template = naming != null ? naming.getChapterTemplate() : null;
        if (template == null || template.isBlank()) {
            template = "{title} c{chapter} (v01) [Noona].cbz";
        }

        Map<String, String> values = new HashMap<>();
        values.put("title", title);
        values.put("type", normalizedType != null ? normalizedType : "");
        values.put("type_slug", typeSlug != null ? typeSlug : "");
        values.put("chapter", chapterPadded);
        values.put("chapter_padded", chapterPadded);
        values.put("pages", String.valueOf(pageCount));
        values.put("domain", domain != null ? domain : "");

        String raw = applyTemplate(template, values);
        if (raw == null || raw.isBlank()) {
            raw = title.isBlank()
                    ? String.format("c%s (v01) [Noona].cbz", chapterPadded)
                    : String.format("%s c%s (v01) [Noona].cbz", title, chapterPadded);
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

    private String formatPageFileName(DownloadNamingSettings naming, String titleName, String type, String chapterNumber, int pageIndex, String ext) {
        String title = titleName == null ? "" : titleName.trim();
        String normalizedType = normalizeMediaType(type);
        String typeSlug = resolveMediaTypeFolder(type);
        String chapter = chapterNumber == null ? "" : chapterNumber.trim();
        String extension = ext == null || ext.isBlank() ? ".jpg" : ext;

        int pagePad = naming != null && naming.getPagePad() != null ? Math.max(1, naming.getPagePad()) : 3;
        String pagePadded = String.format("%0" + pagePad + "d", pageIndex);

        int chapterPad = naming != null && naming.getChapterPad() != null ? Math.max(1, naming.getChapterPad()) : 3;
        String chapterPadded = formatChapterPadded(chapter, chapterPad);

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

    protected int saveImagesToFolder(List<String> urls, Path folder, DownloadNamingSettings naming, String titleName, String type, String chapterNumber) {
        int count = 0;
        int workerRateLimitKbps = getCurrentWorkerRateLimitKbps();

        try {
            Files.createDirectories(folder);
            int index = 1;
            Set<String> usedNames = new HashSet<>();

            for (String url : urls) {
                String ext = extractExtension(url);
                String fileName = formatPageFileName(naming, titleName, type, chapterNumber, index, ext);
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
        String threadName = Thread.currentThread().getName();
        if (threadName == null || !threadName.startsWith(DOWNLOAD_WORKER_NAME_PREFIX)) {
            return 0;
        }

        String suffix = threadName.substring(DOWNLOAD_WORKER_NAME_PREFIX.length()).trim();
        int workerIndex;
        try {
            workerIndex = Integer.parseInt(suffix) - 1;
        } catch (NumberFormatException e) {
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

    public List<Map<String, String>> fetchChapters(String titleUrl) {
        return fetchAllChaptersWithRetry(titleUrl);
    }

    public List<DownloadProgress> getDownloadStatuses() {
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

    public List<DownloadProgress> getDownloadHistory() {
        List<DownloadProgress> history = new ArrayList<>();
        for (DownloadProgress entry : progressHistory) {
            history.add(entry.copy());
        }
        history.sort(Comparator.comparingLong(DownloadProgress::getQueuedAt).reversed());
        return history;
    }

    public int getConfiguredDownloadThreads() {
        return Math.max(1, configuredDownloadThreads);
    }

    public int getActiveDownloadCount() {
        int activeCount = 0;
        for (DownloadProgress progress : downloadProgress.values()) {
            String status = Optional.ofNullable(progress.getStatus()).orElse("").trim().toLowerCase(Locale.ROOT);
            if (!isTerminalStatus(status)) {
                activeCount++;
            }
        }
        return activeCount;
    }

    public DownloadProgress getPrimaryActiveDownloadStatus() {
        return downloadProgress.values().stream()
                .map(DownloadProgress::copy)
                .sorted(Comparator.comparingLong(DownloadProgress::getQueuedAt))
                .findFirst()
                .orElse(null);
    }

    public DownloadProgress getCurrentTaskSnapshot() {
        DownloadProgress active = getPrimaryActiveDownloadStatus();
        if (active != null) {
            return active;
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

    public List<Integer> getThreadRateLimitsKbps() {
        return new ArrayList<>(settingsService.getDownloadWorkerSettings(getConfiguredDownloadThreads()).getThreadRateLimitsKbps());
    }

    public void clearDownloadStatus(String titleName) {
        pauseRequestedDownloads.remove(titleName);
        downloadProgress.remove(titleName);
        progressHistory.removeIf(progress -> progress.getTitle().equals(titleName));
        logger.debug("DOWNLOAD_SERVICE", "Cleared progress entry for title=" + sanitizeForLog(titleName));
    }

    public boolean downloadSingleChapter(NewTitle title, String chapterNumber) {
        return downloadSingleChapter(title, chapterNumber, null);
    }

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
            int count = saveImagesToFolder(pages, chapterFolder, naming, title.getTitleName(), title.getType(), chapterNumber);
            if (count <= 0) {
                logger.warn("DOWNLOAD", "⚠️ No files were saved for chapter " + chapterNumber);
                if (progress != null) {
                    progress.setMessage("Chapter " + chapterNumber + " did not finish downloading.");
                    persistTaskSnapshot(progress);
                }
                return false;
            }

            String cbzName = formatChapterCbzName(naming, title.getTitleName(), title.getType(), chapterNumber, count, domain);
            Path cbzPath = workingTitleFolder.resolve(cbzName);
            zipFolderAsCbz(chapterFolder, cbzPath);
            deleteFolder(chapterFolder);
            promoteTitleFolder(workingTitleFolder, finalTitleFolder);
            title.setDownloadPath(finalTitleFolder.toString());
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
            case "manga" -> "Manga";
            case "manhwa" -> "Manhwa";
            case "manhua" -> "Manhua";
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
        return TERMINAL_STATUSES.contains(status);
    }

    private String sanitizeForLog(String value) {
        if (value == null) {
            return "";
        }
        return value.replaceAll("[\\r\\n]", "").replaceAll("[^-\\p{Alnum}\\s_:]", "").trim();
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

        public int getAffectedTasks() {
            return pausedImmediately.size() + pausingAfterCurrentChapter.size();
        }
    }
}
