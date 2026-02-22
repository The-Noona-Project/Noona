package com.paxkun.raven.service;

import com.paxkun.raven.service.download.*;
import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import com.paxkun.raven.service.settings.DownloadNamingSettings;
import com.paxkun.raven.service.settings.SettingsService;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.openqa.selenium.StaleElementReferenceException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
public class DownloadService {

    @Autowired private TitleScraper titleScraper;
    @Autowired private SourceFinder sourceFinder;
    @Autowired private LoggerService logger;
    @Autowired @Lazy private LibraryService libraryService;
    @Autowired
    private SettingsService settingsService;

    private static final String USER_AGENT = "Mozilla/5.0";
    private static final String REFERER = "https://weebcentral.com";

    @Value("${raven.download.threads:${RAVEN_DOWNLOAD_THREADS:3}}")
    private int configuredDownloadThreads;

    private ExecutorService executor;
    private final Map<String, Future<?>> activeDownloads = new ConcurrentHashMap<>();
    private final Map<String, DownloadProgress> downloadProgress = new ConcurrentHashMap<>();
    private final Deque<DownloadProgress> progressHistory = new ConcurrentLinkedDeque<>();
    private final Map<String, SearchSession> searchSessions = new ConcurrentHashMap<>();

    private static final long SEARCH_TTL_MILLIS = TimeUnit.MINUTES.toMillis(10);
    private Supplier<Long> currentTimeSupplier = System::currentTimeMillis;

    private synchronized ExecutorService ensureExecutor() {
        if (executor != null && !executor.isShutdown() && !executor.isTerminated()) {
            return executor;
        }

        int normalizedThreads = Math.max(1, configuredDownloadThreads);
        configuredDownloadThreads = normalizedThreads;
        executor = Executors.newFixedThreadPool(normalizedThreads);
        return executor;
    }

    @PostConstruct
    public void initExecutor() {
        ensureExecutor();
    }

    @PreDestroy
    public void shutdownExecutor() {
        if (executor == null) {
            return;
        }

        executor.shutdownNow();
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

    public String queueDownloadAllChapters(String searchId, int userIndex) {
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

                DownloadProgress progress = new DownloadProgress(titleName);
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

            DownloadProgress progress = new DownloadProgress(titleName);
            downloadProgress.put(titleName, progress);
            Future<?> future = ensureExecutor().submit(() -> runDownload(titleName, selectedTitle, progress));
            activeDownloads.put(titleName, future);
            searchSessions.remove(searchId);
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
            String titleUrl = selectedTitle.get("href");
            logger.info("DOWNLOAD", "🚀 Starting download for [" + titleName + "]");
            logger.debug(
                    "DOWNLOAD",
                    "Resolved title URL | title=" + sanitizeForLog(titleName) +
                            " | url=" + sanitizeForLog(titleUrl));

            NewTitle titleRecord = libraryService.resolveOrCreateTitle(titleName, titleUrl);

            String coverUrl = selectedTitle.get("coverUrl");
            if (coverUrl != null && !coverUrl.isBlank()) {
                titleRecord.setCoverUrl(coverUrl.trim());
            }

            String normalizedType = normalizeMediaType(selectedTitle.get("type"));
            if (normalizedType != null) {
                titleRecord.setType(normalizedType);
            }

            String summary = titleScraper.getSummary(titleUrl);
            if (summary != null && !summary.isBlank()) {
                titleRecord.setSummary(summary);
            }

            List<Map<String, String>> chapters = fetchAllChaptersWithRetry(titleUrl);
            if (chapters.isEmpty()) {
                progress.markFailed("No chapters found for this title.");
                throw new RuntimeException("No chapters found for this title.");
            }
            logger.debug(
                    "DOWNLOAD",
                    "Fetched chapters | title=" + sanitizeForLog(titleName) +
                            " | count=" + chapters.size());

            DownloadNamingSettings naming = settingsService.getDownloadNamingSettings();
            Path titleFolder = resolveTitleFolder(titleName, titleRecord.getType(), naming);
            String existingDownloadPath = titleRecord.getDownloadPath();
            if (existingDownloadPath != null && !existingDownloadPath.isBlank()) {
                try {
                    Path existingPath = Path.of(existingDownloadPath);
                    if (!existingPath.normalize().equals(titleFolder.normalize()) && Files.exists(existingPath) && Files.isDirectory(existingPath) && !Files.exists(titleFolder)) {
                        Files.createDirectories(titleFolder.getParent());
                        Files.move(existingPath, titleFolder);
                    }
                } catch (Exception e) {
                    logger.warn(
                            "DOWNLOAD",
                            "Failed to migrate title folder for [" + sanitizeForLog(titleName) + "]: " + e.getMessage());
                }
            }
            Files.createDirectories(titleFolder);
            titleRecord.setDownloadPath(titleFolder.toString());
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

            titleRecord.setChapterCount(chaptersToDownload.size());
            progress.markStarted(chaptersToDownload.size());

            titleRecord.setChaptersDownloaded(0);
            libraryService.addOrUpdateTitle(
                    titleRecord,
                    new NewChapter(Optional.ofNullable(titleRecord.getLastDownloaded()).orElse("0"))
            );

            for (Map<String, String> chapter : chaptersToDownload) {
                String chapterTitle = chapter.get("chapter_title");
                String chapterNumber = extractChapterNumberFull(chapterTitle);
                String chapterUrl = chapter.get("href");

                progress.chapterStarted(chapterTitle);

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
                    progress.chapterCompleted();
                    continue;
                }

                String sourceDomain = extractDomain(pageUrls.get(0));
                Path chapterFolder = titleFolder.resolve("temp_" + chapterNumber);
                int pageCount = saveImagesToFolder(pageUrls, chapterFolder, naming, titleName, titleRecord.getType(), chapterNumber);

                String cbzName = formatChapterCbzName(naming, titleName, titleRecord.getType(), chapterNumber, pageCount, sourceDomain);
                Path cbzPath = titleFolder.resolve(cbzName);

                zipFolderAsCbz(chapterFolder, cbzPath);
                deleteFolder(chapterFolder);

                logger.info("DOWNLOAD", "📦 Saved [" + cbzName + "] with " + pageCount + " pages at " + cbzPath);

                progress.chapterCompleted();
                titleRecord.setLastDownloaded(chapterNumber);
                titleRecord.setChaptersDownloaded(progress.getCompletedChapters());
                libraryService.addOrUpdateTitle(titleRecord, new NewChapter(chapterNumber));
            }

            titleRecord.setChaptersDownloaded(progress.getCompletedChapters());
            libraryService.addOrUpdateTitle(
                    titleRecord,
                    new NewChapter(Optional.ofNullable(titleRecord.getLastDownloaded()).orElse("0"))
            );

            result.setChapterName(titleName);
            result.setStatus("✅ Download completed.");
            progress.markCompleted();

        } catch (Exception e) {
            logger.error("DOWNLOAD", "❌ Download failed for [" + titleName + "]: " + e.getMessage(), e);
            progress.markFailed(e.getMessage());
        } finally {
            activeDownloads.remove(titleName);
            logger.debug(
                    "DOWNLOAD",
                    "Removed active download entry | title=" + sanitizeForLog(titleName));
            finalizeProgress(titleName, progress);
        }
    }

    private void finalizeProgress(String titleName, DownloadProgress progress) {
        DownloadProgress snapshot = progress.copy();
        downloadProgress.remove(titleName);
        progressHistory.addFirst(snapshot);
        while (progressHistory.size() > 10) {
            progressHistory.removeLast();
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

        int chapterPad = naming != null && naming.getChapterPad() != null ? Math.max(1, naming.getChapterPad()) : 4;
        String chapterPadded = formatChapterPadded(chapter, chapterPad);

        String template = naming != null ? naming.getChapterTemplate() : null;
        if (template == null || template.isBlank()) {
            template = "Chapter {chapter} [Pages {pages} {domain} - Noona].cbz";
        }

        Map<String, String> values = new HashMap<>();
        values.put("title", title);
        values.put("type", normalizedType != null ? normalizedType : "");
        values.put("type_slug", typeSlug != null ? typeSlug : "");
        values.put("chapter", chapter);
        values.put("chapter_padded", chapterPadded);
        values.put("pages", String.valueOf(pageCount));
        values.put("domain", domain != null ? domain : "");

        String raw = applyTemplate(template, values);
        if (raw == null || raw.isBlank()) {
            raw = String.format("Chapter %s [Pages %d %s - Noona].cbz", chapter, pageCount, domain);
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

        int chapterPad = naming != null && naming.getChapterPad() != null ? Math.max(1, naming.getChapterPad()) : 4;
        String chapterPadded = formatChapterPadded(chapter, chapterPad);

        String template = naming != null ? naming.getPageTemplate() : null;
        if (template == null || template.isBlank()) {
            template = "{page_padded}{ext}";
        }

        Map<String, String> values = new HashMap<>();
        values.put("title", title);
        values.put("type", normalizedType != null ? normalizedType : "");
        values.put("type_slug", typeSlug != null ? typeSlug : "");
        values.put("chapter", chapter);
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
                        Files.copy(in, path, StandardCopyOption.REPLACE_EXISTING);
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
        return activeDownloads.size();
    }

    public void clearDownloadStatus(String titleName) {
        downloadProgress.remove(titleName);
        progressHistory.removeIf(progress -> progress.getTitle().equals(titleName));
        logger.debug("DOWNLOAD_SERVICE", "Cleared progress entry for title=" + sanitizeForLog(titleName));
    }

    public void downloadSingleChapter(NewTitle title, String chapterNumber) {

        String titleUrl = title.getSourceUrl();
        DownloadNamingSettings naming = settingsService.getDownloadNamingSettings();
        Path titleFolder = resolveTitleFolder(title, naming);
        try {
            String sanitizedTitle = sanitizeForLog(title.getTitleName());
            logger.debug(
                    "DOWNLOAD",
                    "Single chapter download requested | title=" + sanitizedTitle +
                            " | chapterNumber=" + sanitizeForLog(chapterNumber));
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
                return;
            }

            Map<String, String> chapter = match.get();
            logger.debug(
                    "DOWNLOAD",
                    "Matched chapter | title=" + sanitizedTitle +
                            " | chapterTitle=" + sanitizeForLog(chapter.get("chapter_title")) +
                            " | url=" + sanitizeForLog(chapter.get("href")));
            List<String> pages = sourceFinder.findSource(chapter.get("href"));

            if (pages.isEmpty()) {
                logger.warn("DOWNLOAD", "⚠️ No pages found for chapter " + chapterNumber);
                return;
            }

            String domain = extractDomain(pages.get(0));
            Path chapterFolder = titleFolder.resolve("temp_" + chapterNumber);
            Files.createDirectories(titleFolder);
            int count = saveImagesToFolder(pages, chapterFolder, naming, title.getTitleName(), title.getType(), chapterNumber);

            String cbzName = formatChapterCbzName(naming, title.getTitleName(), title.getType(), chapterNumber, count, domain);
            Path cbzPath = titleFolder.resolve(cbzName);
            zipFolderAsCbz(chapterFolder, cbzPath);
            deleteFolder(chapterFolder);

            logger.info("DOWNLOAD", "📦 Saved " + cbzName + " at " + cbzPath);

        } catch (Exception e) {
            logger.error("DOWNLOAD", "❌ Failed single chapter download: " + e.getMessage(), e);
        }
    }

    private Path getDownloadRoot() {
        Path root = logger.getDownloadsRoot();
        if (root == null) {
            throw new IllegalStateException("LoggerService has not initialized the downloads root directory");
        }
        return root;
    }


    private Path resolveTitleFolder(NewTitle title) {
        return resolveTitleFolder(title, settingsService.getDownloadNamingSettings());
    }

    private Path resolveTitleFolder(NewTitle title, DownloadNamingSettings naming) {
        if (title == null) {
            return getDownloadRoot();
        }

        String downloadPath = title.getDownloadPath();
        if (downloadPath != null && !downloadPath.isBlank()) {
            return Path.of(downloadPath);
        }

        return resolveTitleFolder(title.getTitleName(), title.getType(), naming);
    }

    private Path resolveTitleFolder(String titleName, String type) {
        return resolveTitleFolder(titleName, type, settingsService.getDownloadNamingSettings());
    }

    private Path resolveTitleFolder(String titleName, String type, DownloadNamingSettings naming) {
        String cleanTitle = formatTitleFolderName(naming, titleName, type);
        if (cleanTitle == null || cleanTitle.isBlank()) {
            throw new IllegalArgumentException("titleName is required");
        }

        Path root = getDownloadRoot();
        String typeFolder = resolveMediaTypeFolder(type);
        Path base = typeFolder != null ? root.resolve(typeFolder) : root;
        return base.resolve(cleanTitle);
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
}
