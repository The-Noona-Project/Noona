package com.paxkun.raven.service;

import com.paxkun.raven.service.download.DownloadChapter;
import com.paxkun.raven.service.download.SearchTitle;
import com.paxkun.raven.service.download.SourceFinder;
import com.paxkun.raven.service.download.TitleScraper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * DownloadService manages manga download operations.
 * Downloads each chapter as a CBZ containing all page images.
 *
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

    public SearchTitle searchTitle(String titleName) {
        List<Map<String, String>> searchResults = titleScraper.searchManga(titleName);
        String searchId = UUID.randomUUID().toString();

        for (int i = 0; i < searchResults.size(); i++) {
            searchResults.get(i).put("option_number", String.valueOf(i + 1));
        }

        return new SearchTitle(searchId, searchResults);
    }

    public DownloadChapter downloadAllChapters(String searchId, int userIndex) {
        DownloadChapter result = new DownloadChapter();

        try {
            Map<String, String> selectedTitle = getSelectedTitle(userIndex);
            String titleName = selectedTitle.get("title");
            String titleUrl = selectedTitle.get("href");

            logger.info("DOWNLOAD", "🚀 Starting full download for [" + titleName + "]");

            List<Map<String, String>> chapters = titleScraper.getChapters(titleUrl);
            if (chapters.isEmpty()) {
                throw new RuntimeException("No chapters found for this title.");
            }

            String cleanTitleName = titleName.replaceAll("[^a-zA-Z0-9\\s]", "").trim();
            Path titleFolder = DOWNLOAD_ROOT.resolve(cleanTitleName);
            Files.createDirectories(titleFolder);

            for (Map<String, String> chapter : chapters) {
                String chapterNumberStr = chapter.get("chapter_number");
                String chapterUrl = chapter.get("href");

                int chapterNumber = parseChapterNumber(chapterNumberStr);
                logger.info("DOWNLOAD", "📥 Downloading Chapter [" + chapterNumber + "]: " + chapterUrl);

                List<String> pageUrls = sourceFinder.findSource(chapterUrl);
                if (pageUrls.isEmpty()) {
                    logger.warn("DOWNLOAD", "⚠️ No pages found for chapter " + chapterNumber + ". Skipping.");
                    continue;
                }

                Path chapterFolder = titleFolder.resolve(String.format("Chapter %03d", chapterNumber));
                int pageCount = saveImagesToFolder(pageUrls, chapterFolder);

                String cbzFileName = String.format("Chapter %03d Pages 1-%d.cbz", chapterNumber, pageCount);
                Path cbzPath = titleFolder.resolve(cbzFileName);
                zipFolderAsCbz(chapterFolder, cbzPath);

                logger.info("DOWNLOAD", "📦 Saved [" + cbzFileName + "] with " + pageCount + " pages at " + cbzPath);

                deleteFolder(chapterFolder);
            }

            result.setChapterName(titleName);
            result.setStatus("✅ All chapters downloaded successfully.");

        } catch (Exception e) {
            logger.error("DOWNLOAD", "❌ Failed to download all chapters: " + e.getMessage(), e);
            result.setChapterName("Unknown");
            result.setStatus("Download failed: " + e.getMessage());
        }

        return result;
    }

    private Map<String, String> getSelectedTitle(int userIndex) {
        int optionIndex = userIndex - 1;
        List<Map<String, String>> results = titleScraper.getLastSearchResults();
        if (results == null || optionIndex < 0 || optionIndex >= results.size()) {
            throw new IndexOutOfBoundsException("Invalid option index: " + userIndex);
        }
        return results.get(optionIndex);
    }

    private int parseChapterNumber(String chapterNumberStr) {
        try {
            return Integer.parseInt(chapterNumberStr.replaceAll("[^\\d]", ""));
        } catch (NumberFormatException e) {
            logger.warn("DOWNLOAD", "⚠️ Failed to parse chapter number from: " + chapterNumberStr + ". Using 0.");
            return 0;
        }
    }

    private int saveImagesToFolder(List<String> imageUrls, Path folderPath) {
        int count = 0;
        try {
            Files.createDirectories(folderPath);
            int index = 1;
            for (String imageUrl : imageUrls) {
                String ext = imageUrl.substring(imageUrl.lastIndexOf('.')).split("\\?")[0]; // strip URL params
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
