package com.paxkun.raven.service;

import com.paxkun.raven.service.download.DownloadChapter;
import com.paxkun.raven.service.download.DownloadProgress;
import com.paxkun.raven.service.download.SearchTitle;
import com.paxkun.raven.service.download.SourceFinder;
import com.paxkun.raven.service.download.TitleScraper;
import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import org.openqa.selenium.StaleElementReferenceException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.*;
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

    private static final String USER_AGENT = "Mozilla/5.0";
    private static final String REFERER = "https://weebcentral.com";

    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private final Map<String, Future<?>> activeDownloads = new ConcurrentHashMap<>();
    private final Map<String, DownloadProgress> downloadProgress = new ConcurrentHashMap<>();
    private final Deque<DownloadProgress> progressHistory = new ConcurrentLinkedDeque<>();
    private final Map<String, SearchSession> searchSessions = new ConcurrentHashMap<>();

    private static final long SEARCH_TTL_MILLIS = TimeUnit.MINUTES.toMillis(10);
    private Supplier<Long> currentTimeSupplier = System::currentTimeMillis;

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
                Future<?> future = executor.submit(() -> runDownload(titleName, title, progress));
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
            Future<?> future = executor.submit(() -> runDownload(titleName, selectedTitle, progress));
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

            List<Map<String, String>> chapters = fetchAllChaptersWithRetry(titleUrl);
            if (chapters.isEmpty()) {
                progress.markFailed("No chapters found for this title.");
                throw new RuntimeException("No chapters found for this title.");
            }
            logger.debug(
                    "DOWNLOAD",
                    "Fetched chapters | title=" + sanitizeForLog(titleName) +
                            " | count=" + chapters.size());

            String cleanTitle = titleName.replaceAll("[^a-zA-Z0-9\\s]", "").trim();
            Path titleFolder = getDownloadRoot().resolve(cleanTitle);
            Files.createDirectories(titleFolder);

            progress.markStarted(chapters.size());

            for (Map<String, String> chapter : chapters) {
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
                int pageCount = saveImagesToFolder(pageUrls, chapterFolder);

                String cbzName = String.format("Chapter %s [Pages %d %s - Noona].cbz", chapterNumber, pageCount, sourceDomain);
                Path cbzPath = titleFolder.resolve(cbzName);

                zipFolderAsCbz(chapterFolder, cbzPath);
                deleteFolder(chapterFolder);

                logger.info("DOWNLOAD", "📦 Saved [" + cbzName + "] with " + pageCount + " pages at " + cbzPath);

                titleRecord.setLastDownloaded(chapterNumber);
                libraryService.addOrUpdateTitle(titleRecord, new NewChapter(chapterNumber));
                progress.chapterCompleted();
            }

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

    protected int saveImagesToFolder(List<String> urls, Path folder) {
        int count = 0;
        try {
            Files.createDirectories(folder);
            int index = 1;
            for (String url : urls) {
                String ext = url.substring(url.lastIndexOf('.')).split("\\?")[0];
                Path path = folder.resolve(String.format("%03d%s", index, ext));
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

    public void clearDownloadStatus(String titleName) {
        downloadProgress.remove(titleName);
        progressHistory.removeIf(progress -> progress.getTitle().equals(titleName));
        logger.debug("DOWNLOAD_SERVICE", "Cleared progress entry for title=" + sanitizeForLog(titleName));
    }

    public void downloadSingleChapter(NewTitle title, String chapterNumber) {
        String titleUrl = title.getSourceUrl();
        String cleanTitle = title.getTitleName().replaceAll("[^a-zA-Z0-9\\s]", "").trim();
        Path titleFolder = getDownloadRoot().resolve(cleanTitle);

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
            int count = saveImagesToFolder(pages, chapterFolder);

            String cbzName = String.format("Chapter %s [Pages %d %s - Noona].cbz", chapterNumber, count, domain);
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
