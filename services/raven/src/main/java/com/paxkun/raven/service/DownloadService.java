package com.paxkun.raven.service;

import com.paxkun.raven.service.download.DownloadChapter;
import com.paxkun.raven.service.download.SearchTitle;
import com.paxkun.raven.service.download.SourceFinder;
import com.paxkun.raven.service.download.TitleScraper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * DownloadService manages search and download operations, including creating CBZ archives.
 */
@Slf4j
@Service
public class DownloadService {

    private final TitleScraper titleScraper = new TitleScraper();
    private static final int PAGE_LIMIT = 9999;

    private static final Path DOWNLOAD_ROOT = Path.of(
            Optional.ofNullable(System.getenv("APPDATA"))
                    .orElse("/app/downloads") + "/Noona/raven"
    );

    public SearchTitle searchTitle(String titleName) {
        List<Map<String, String>> searchResults = titleScraper.searchManga(titleName);
        String searchId = UUID.randomUUID().toString();

        for (int i = 0; i < searchResults.size(); i++) {
            searchResults.get(i).put("option_number", String.valueOf(i + 1));
        }

        return new SearchTitle(searchId, searchResults);
    }

    public DownloadChapter downloadSelectedTitle(String searchId, int userIndex) {
        DownloadChapter result = new DownloadChapter();

        try {
            int optionIndex = userIndex - 1;

            if (optionIndex < 0 || optionIndex >= titleScraper.getLastSearchResults().size()) {
                throw new IndexOutOfBoundsException("Invalid option index: " + userIndex);
            }

            Map<String, String> selectedTitle = titleScraper.getResultByIndex(userIndex);
            String titleName = selectedTitle.get("title");
            String chapterUrl = selectedTitle.get("href");

            log.info("🚀 Starting download for title [{}] from URL [{}]", titleName, chapterUrl);

            String baseSourceUrl = SourceFinder.findSource(chapterUrl)
                    .orElseThrow(() -> new RuntimeException("Could not find base source URL for: " + chapterUrl));

            log.info("✅ Base source URL resolved: {}", baseSourceUrl);

            List<String> imageUrls = new ArrayList<>();
            for (int i = 1; i < PAGE_LIMIT; i++) {
                String imageUrl = baseSourceUrl
                        + String.format("%04d", userIndex)
                        + "-"
                        + String.format("%03d", i)
                        + ".png";

                if (urlExists(imageUrl)) {
                    imageUrls.add(imageUrl);
                } else {
                    break;
                }
            }

            if (imageUrls.isEmpty()) {
                throw new RuntimeException("No pages found for download.");
            }

            String cbzFilename = titleName.replaceAll("\\s+", "_") + ".cbz";
            Path titleFolder = DOWNLOAD_ROOT.resolve(titleName);
            createCbzFromImages(imageUrls, cbzFilename, titleFolder);

            result.setChapterName(titleName);
            result.setStatus("✅ Downloaded and saved as CBZ at " + titleFolder.toAbsolutePath());
        } catch (Exception e) {
            log.error("❌ Failed to download chapter: {}", e.getMessage(), e);
            result.setChapterName("Unknown");
            result.setStatus("Download failed: " + e.getMessage());
        }

        return result;
    }

    private void createCbzFromImages(List<String> imageUrls, String cbzFilename, Path outputFolder) {
        Path cbzPath = outputFolder.resolve(cbzFilename);

        try {
            Files.createDirectories(outputFolder);

            try (ZipOutputStream zipOut = new ZipOutputStream(Files.newOutputStream(cbzPath))) {
                int index = 1;
                for (String imageUrl : imageUrls) {
                    addImageToZip(imageUrl, zipOut, index);
                    index++;
                }
            }

            log.info("💾 Saved CBZ: {}", cbzPath);
        } catch (IOException e) {
            log.error("❌ Failed to create CBZ: {}", e.getMessage(), e);
        }
    }

    private boolean urlExists(String urlStr) {
        try {
            URL url = new URL(urlStr);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("HEAD");
            connection.setConnectTimeout(3000);
            connection.setReadTimeout(3000);
            int responseCode = connection.getResponseCode();
            return (200 <= responseCode && responseCode < 400);
        } catch (IOException e) {
            log.warn("⚠️ Failed to check URL: {} - {}", urlStr, e.getMessage());
            return false;
        }
    }

    private void addImageToZip(String imageUrl, ZipOutputStream zipOut, int index) {
        try (InputStream in = new URL(imageUrl).openStream()) {
            String imageName = String.format("%03d.png", index);
            ZipEntry entry = new ZipEntry(imageName);
            zipOut.putNextEntry(entry);
            in.transferTo(zipOut);
            zipOut.closeEntry();
            log.info("➕ Added image to CBZ: {}", imageName);
        } catch (IOException e) {
            log.error("❌ Failed to download and add image to zip: {} - {}", imageUrl, e.getMessage());
        }
    }
}
