package com.paxkun.raven.service;

import com.paxkun.raven.service.download.DownloadChapter;
import com.paxkun.raven.service.download.SearchTitle;
import com.paxkun.raven.service.download.SourceFinder;
import com.paxkun.raven.service.download.TitleScraper;
import org.openqa.selenium.StaleElementReferenceException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * DownloadService manages manga download operations asynchronously.
 * Supports downloading all titles (option index 0) or a specific title.
 * Ensures only one active download per title, with multiple titles in parallel.
 * <p>
 * Author: Pax
 */
@Service
public class DownloadService {

    @Autowired
    private TitleScraper titleScraper;

    @Autowired
    private SourceFinder sourceFinder;

    @Autowired
    private LoggerService logger;

    private static final Path DOWNLOAD_ROOT = Path.of(
            Optional.ofNullable(System.getenv("APPDATA"))
                    .orElse("/app/downloads") + "/Noona/raven/downloads"
    );

    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private final Map<String, Future<?>> activeDownloads = new ConcurrentHashMap<>();

    public SearchTitle searchTitle(String titleName) {
        List<Map<String, String>> searchResults = titleScraper.searchManga(titleName);
        String searchId = UUID.randomUUID().toString();

        for (int i = 0; i < searchResults.size(); i++) {
            searchResults.get(i).put("option_number", String.valueOf(i + 1));
        }

        return new SearchTitle(searchId, searchResults);
    }

    public String queueDownloadAllChapters(String searchId, int userIndex) {
        List<Map<String, String>> results = titleScraper.getLastSearchResults();

        if (userIndex == 0) {
            // Queue all titles
            if (results == null || results.isEmpty()) {
                return "⚠️ No search results to download.";
            }

            StringBuilder queuedTitles = new StringBuilder("✅ Queued downloads for: ");
            for (Map<String, String> title : results) {
                String titleName = title.get("title");

                synchronized (activeDownloads) {
                    if (activeDownloads.containsKey(titleName)) {
                        logger.info("DOWNLOAD", "🔁 Skipping already active download: " + titleName);
                        continue;
                    }

                    Future<?> future = executor.submit(() -> runDownload(titleName, title));
                    activeDownloads.put(titleName, future);
                    queuedTitles.append(titleName).append(", ");
                }
            }

            return queuedTitles.toString();

        } else {
            // Queue single selected title
            Map<String, String> selectedTitle = getSelectedTitle(userIndex);
            String titleName = selectedTitle.get("title");

            synchronized (activeDownloads) {
                if (activeDownloads.containsKey(titleName)) {
                    return "⚠️ Download already in progress for: " + titleName;
                }

                Future<?> future = executor.submit(() -> runDownload(titleName, selectedTitle));
                activeDownloads.put(titleName, future);
                return "✅ Download queued for: " + titleName;
            }
        }
    }

    private void runDownload(String titleName, Map<String, String> selectedTitle) {
        DownloadChapter result = new DownloadChapter();
        try {
            String titleUrl = selectedTitle.get("href");
            logger.info("DOWNLOAD", "🚀 Starting download for [" + titleName + "]");

            List<Map<String, String>> chapters = fetchAllChaptersWithRetry(titleUrl);
            if (chapters.isEmpty()) {
                throw new RuntimeException("No chapters found for this title.");
            }

            String cleanTitleName = titleName.replaceAll("[^a-zA-Z0-9\\s]", "").trim();
            Path titleFolder = DOWNLOAD_ROOT.resolve(cleanTitleName);
            Files.createDirectories(titleFolder);

            for (Map<String, String> chapter : chapters) {
                String chapterTitle = chapter.get("chapter_title");
                String chapterNumberStr = extractChapterNumberFull(chapterTitle);
                String chapterUrl = chapter.get("href");

                logger.info("DOWNLOAD", "📥 Downloading Chapter [" + chapterNumberStr + "]: " + chapterUrl);

                List<String> pageUrls = sourceFinder.findSource(chapterUrl);
                if (pageUrls.isEmpty()) {
                    logger.warn("DOWNLOAD", "⚠️ No pages found for chapter " + chapterNumberStr + ". Skipping.");
                    continue;
                }

                String firstPageUrl = pageUrls.get(0);
                String sourceDomain = extractDomain(firstPageUrl);

                Path chapterFolder = titleFolder.resolve("temp_" + chapterNumberStr);
                int pageCount = saveImagesToFolder(pageUrls, chapterFolder);

                String cbzFileName = String.format(
                        "Chapter %s [Pages %d %s - Noona].cbz",
                        chapterNumberStr, pageCount, sourceDomain
                );

                Path cbzPath = titleFolder.resolve(cbzFileName);
                zipFolderAsCbz(chapterFolder, cbzPath);

                logger.info("DOWNLOAD", "📦 Saved [" + cbzFileName + "] with " + pageCount + " pages at " + cbzPath);

                deleteFolder(chapterFolder);
            }

            result.setChapterName(titleName);
            result.setStatus("✅ Download completed.");

        } catch (Exception e) {
            logger.error("DOWNLOAD", "❌ Download failed for [" + titleName + "]: " + e.getMessage(), e);
        } finally {
            activeDownloads.remove(titleName);
        }
    }

    private List<Map<String, String>> fetchAllChaptersWithRetry(String titleUrl) {
        int attempts = 0;
        while (attempts < 3) {
            try {
                return titleScraper.getChapters(titleUrl);
            } catch (StaleElementReferenceException e) {
                attempts++;
                logger.warn("SCRAPER", "⚠️ Stale element detected, retrying fetch (" + attempts + "/3)");
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException ignored) {}
            }
        }
        throw new RuntimeException("Failed to fetch chapters after multiple retries.");
    }

    private Map<String, String> getSelectedTitle(int userIndex) {
        int optionIndex = userIndex - 1;
        List<Map<String, String>> results = titleScraper.getLastSearchResults();
        if (results == null || optionIndex < 0 || optionIndex >= results.size()) {
            throw new IndexOutOfBoundsException("Invalid option index: " + userIndex);
        }
        return results.get(optionIndex);
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
            URL u = new URL(url);
            return u.getHost();
        } catch (Exception e) {
            logger.warn("DOWNLOAD", "⚠️ Failed to parse domain from URL: " + url);
            return "unknown";
        }
    }

    private int saveImagesToFolder(List<String> imageUrls, Path folderPath) {
        int count = 0;
        try {
            Files.createDirectories(folderPath);
            int index = 1;
            for (String imageUrl : imageUrls) {
                String ext = imageUrl.substring(imageUrl.lastIndexOf('.')).split("\\?")[0];
                Path imagePath = folderPath.resolve(String.format("%03d%s", index, ext));
                try {
                    HttpURLConnection connection = (HttpURLConnection) new URL(imageUrl).openConnection();
                    connection.setRequestProperty("User-Agent", "Mozilla/5.0");
                    connection.setRequestProperty("Referer", "https://weebcentral.com/");
                    connection.connect();

                    try (InputStream in = connection.getInputStream()) {
                        Files.copy(in, imagePath, StandardCopyOption.REPLACE_EXISTING);
                        logger.info("DOWNLOAD", "➕ Saved image: " + imagePath);
                        count++;
                    }
                } catch (IOException e) {
                    logger.error("DOWNLOAD", "❌ Failed downloading image " + imageUrl + ": " + e.getMessage(), e);
                }
                index++;
            }
        } catch (IOException e) {
            logger.error("DOWNLOAD", "❌ Failed saving images: " + e.getMessage(), e);
        }
        return count;
    }

    private void zipFolderAsCbz(Path folderPath, Path cbzPath) {
        try (ZipOutputStream zipOut = new ZipOutputStream(Files.newOutputStream(cbzPath))) {
            Files.walk(folderPath)
                    .filter(Files::isRegularFile)
                    .forEach(path -> {
                        try (InputStream in = Files.newInputStream(path)) {
                            zipOut.putNextEntry(new ZipEntry(path.getFileName().toString()));
                            in.transferTo(zipOut);
                            zipOut.closeEntry();
                        } catch (IOException e) {
                            logger.error("DOWNLOAD", "❌ Failed adding to CBZ: " + e.getMessage(), e);
                        }
                    });
        } catch (IOException e) {
            logger.error("DOWNLOAD", "❌ Failed to create CBZ: " + e.getMessage(), e);
        }
    }

    private void deleteFolder(Path folderPath) {
        try {
            Files.walk(folderPath)
                    .sorted(Comparator.reverseOrder())
                    .forEach(path -> {
                        try {
                            Files.delete(path);
                        } catch (IOException e) {
                            logger.warn("DOWNLOAD", "⚠️ Failed to delete file " + path + ": " + e.getMessage());
                        }
                    });
            logger.info("DOWNLOAD", "🗑️ Deleted temp folder: " + folderPath);
        } catch (IOException e) {
            logger.warn("DOWNLOAD", "⚠️ Failed to delete folder " + folderPath + ": " + e.getMessage());
        }
    }
}
