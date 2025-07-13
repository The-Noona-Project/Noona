package com.paxkun.raven.service;

import com.paxkun.raven.service.download.DownloadChapter;
import com.paxkun.raven.service.download.SearchTitle;
import com.paxkun.raven.service.download.SourceFinder;
import com.paxkun.raven.service.download.TitleScraper;
import com.paxkun.raven.service.library.NewTitle;
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

@Service
public class DownloadService {

    @Autowired private TitleScraper titleScraper;
    @Autowired private SourceFinder sourceFinder;
    @Autowired private LoggerService logger;

    private static final String USER_AGENT = "Mozilla/5.0";
    private static final String REFERER = "https://weebcentral.com";

    private static final Path DOWNLOAD_ROOT = Path.of(
            Optional.ofNullable(System.getenv("APPDATA")).orElse("/app/downloads") + "/Noona/raven/downloads"
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
            if (results == null || results.isEmpty()) return "⚠️ No search results to download.";

            StringBuilder queued = new StringBuilder("✅ Queued downloads for: ");
            for (Map<String, String> title : results) {
                String titleName = title.get("title");
                if (activeDownloads.containsKey(titleName)) {
                    logger.info("DOWNLOAD", "🔁 Skipping already active download: " + titleName);
                    continue;
                }

                Future<?> future = executor.submit(() -> runDownload(titleName, title));
                activeDownloads.put(titleName, future);
                queued.append(titleName).append(", ");
            }
            return queued.toString();

        } else {
            Map<String, String> selectedTitle = getSelectedTitle(userIndex);
            String titleName = selectedTitle.get("title");

            if (activeDownloads.containsKey(titleName)) {
                return "⚠️ Download already in progress for: " + titleName;
            }

            Future<?> future = executor.submit(() -> runDownload(titleName, selectedTitle));
            activeDownloads.put(titleName, future);
            return "✅ Download queued for: " + titleName;
        }
    }

    private void runDownload(String titleName, Map<String, String> selectedTitle) {
        DownloadChapter result = new DownloadChapter();

        try {
            String titleUrl = selectedTitle.get("href");
            logger.info("DOWNLOAD", "🚀 Starting download for [" + titleName + "]");

            List<Map<String, String>> chapters = fetchAllChaptersWithRetry(titleUrl);
            if (chapters.isEmpty()) throw new RuntimeException("No chapters found for this title.");

            String cleanTitle = titleName.replaceAll("[^a-zA-Z0-9\\s]", "").trim();
            Path titleFolder = DOWNLOAD_ROOT.resolve(cleanTitle);
            Files.createDirectories(titleFolder);

            for (Map<String, String> chapter : chapters) {
                String chapterTitle = chapter.get("chapter_title");
                String chapterNumber = extractChapterNumberFull(chapterTitle);
                String chapterUrl = chapter.get("href");

                logger.info("DOWNLOAD", "📥 Downloading Chapter [" + chapterNumber + "]: " + chapterUrl);

                List<String> pageUrls = sourceFinder.findSource(chapterUrl);
                if (pageUrls.isEmpty()) {
                    logger.warn("DOWNLOAD", "⚠️ No pages found for chapter " + chapterNumber + ". Skipping.");
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
                logger.warn("SCRAPER", "⚠️ Stale element detected, retrying (" + attempts + "/3)");
                try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
            }
        }
        throw new RuntimeException("Failed to fetch chapters after multiple retries.");
    }

    private Map<String, String> getSelectedTitle(int userIndex) {
        int index = userIndex - 1;
        List<Map<String, String>> results = titleScraper.getLastSearchResults();
        if (results == null || index < 0 || index >= results.size()) {
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

    private int saveImagesToFolder(List<String> urls, Path folder) {
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

    private void zipFolderAsCbz(Path folder, Path cbzPath) {
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

    private void deleteFolder(Path folderPath) {
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

    public static List<Map<String, String>> parseChapters(String url) {
        return new TitleScraper().getChapters(url);
    }

    public void downloadSingleChapter(NewTitle title, String chapterNumber) {
        String titleUrl = title.getSourceUrl();
        String cleanTitle = title.getTitleName().replaceAll("[^a-zA-Z0-9\\s]", "").trim();
        Path titleFolder = DOWNLOAD_ROOT.resolve(cleanTitle);

        try {
            List<Map<String, String>> chapters = titleScraper.getChapters(titleUrl);
            Optional<Map<String, String>> match = chapters.stream()
                    .filter(c -> chapterNumber.equals(extractChapterNumberFull(c.get("chapter_title"))))
                    .findFirst();

            if (match.isEmpty()) {
                logger.warn("DOWNLOAD", "⚠️ Chapter " + chapterNumber + " not found for " + title.getTitleName());
                return;
            }

            Map<String, String> chapter = match.get();
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
}
