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
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * DownloadService manages manga download operations.
 * Provides search and full title download as CBZ files.
 *
 * Author: Pax
 */
@Slf4j
@Service
public class DownloadService {

    private final TitleScraper titleScraper = new TitleScraper();
    private static final int PAGE_LIMIT = 9999;

    private static final Path DOWNLOAD_ROOT = Path.of(
            Optional.ofNullable(System.getenv("APPDATA"))
                    .orElse("/app/downloads") + "/Noona/raven/downloads"
    );

    /**
     * Searches for a manga title and returns possible matches.
     *
     * @param titleName The title to search.
     * @return SearchTitle containing results and a generated searchId.
     */
    public SearchTitle searchTitle(String titleName) {
        List<Map<String, String>> searchResults = titleScraper.searchManga(titleName);
        String searchId = UUID.randomUUID().toString();

        for (int i = 0; i < searchResults.size(); i++) {
            searchResults.get(i).put("option_number", String.valueOf(i + 1));
        }

        return new SearchTitle(searchId, searchResults);
    }

    /**
     * Downloads all chapters for a selected title.
     *
     * @param searchId  The search session ID.
     * @param userIndex The selected option index (1-based).
     * @return DownloadChapter status.
     */
    public DownloadChapter downloadAllChapters(String searchId, int userIndex) {
        DownloadChapter result = new DownloadChapter();

        try {
            Map<String, String> selectedTitle = getSelectedTitle(userIndex);
            String titleName = selectedTitle.get("title");
            String titleUrl = selectedTitle.get("href");

            log.info("🚀 Starting full download for [{}]", titleName);

            List<Map<String, String>> chapters = titleScraper.getChapters(titleUrl);
            if (chapters.isEmpty()) {
                throw new RuntimeException("No chapters found for this title.");
            }

            String titleSlug = titleName.replaceAll("\\s+", "_").toLowerCase();

            for (Map<String, String> chapter : chapters) {
                String chapterNumber = chapter.get("chapter_number");
                String chapterUrl = chapter.get("href");

                log.info("📥 Downloading Chapter [{}]: {}", chapterNumber, chapterUrl);

                String baseSourceUrl = SourceFinder.findSource(chapterUrl)
                        .orElseThrow(() -> new RuntimeException("Could not find source for chapter: " + chapterNumber));

                List<String> imageUrls = fetchImageUrls(baseSourceUrl, chapterNumber);
                if (imageUrls.isEmpty()) {
                    log.warn("⚠️ No pages found for chapter {}. Skipping.", chapterNumber);
                    continue;
                }

                Path chapterFolder = DOWNLOAD_ROOT.resolve(titleSlug).resolve(chapterNumber);
                saveImagesToFolder(imageUrls, chapterFolder);

                Path cbzPath = DOWNLOAD_ROOT.resolve(titleSlug).resolve(chapterNumber + ".cbz");
                zipFolderAsCbz(chapterFolder, cbzPath);

                log.info("📦 Chapter [{}] saved as CBZ at {}", chapterNumber, cbzPath);
            }

            result.setChapterName(titleName);
            result.setStatus("✅ All chapters downloaded successfully.");

        } catch (Exception e) {
            log.error("❌ Failed to download all chapters: {}", e.getMessage(), e);
            result.setChapterName("Unknown");
            result.setStatus("Download failed: " + e.getMessage());
        }

        return result;
    }

    /** Helper: Retrieves selected title from last search results. */
    private Map<String, String> getSelectedTitle(int userIndex) {
        int optionIndex = userIndex - 1;
        if (optionIndex < 0 || optionIndex >= titleScraper.getLastSearchResults().size()) {
            throw new IndexOutOfBoundsException("Invalid option index: " + userIndex);
        }
        return titleScraper.getResultByIndex(userIndex);
    }

    /** Helper: Builds list of page image URLs for a chapter. */
    private List<String> fetchImageUrls(String baseSourceUrl, String chapterNumber) {
        List<String> imageUrls = new ArrayList<>();
        for (int i = 1; i < PAGE_LIMIT; i++) {
            String imageUrl = baseSourceUrl
                    + String.format("%04d", Integer.parseInt(chapterNumber))
                    + "-"
                    + String.format("%03d", i)
                    + ".png";

            if (urlExists(imageUrl)) {
                imageUrls.add(imageUrl);
            } else {
                break;
            }
        }
        return imageUrls;
    }

    private boolean urlExists(String urlStr) {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(urlStr).openConnection();
            connection.setRequestMethod("HEAD");
            connection.setConnectTimeout(3000);
            connection.setReadTimeout(3000);
            return (200 <= connection.getResponseCode() && connection.getResponseCode() < 400);
        } catch (IOException e) {
            log.warn("⚠️ Failed to check URL: {} - {}", urlStr, e.getMessage());
            return false;
        }
    }

    private void saveImagesToFolder(List<String> imageUrls, Path folderPath) {
        try {
            Files.createDirectories(folderPath);
            int index = 1;
            for (String imageUrl : imageUrls) {
                Path imagePath = folderPath.resolve(String.format("%04d-%03d.png", index, index));
                try (InputStream in = new URL(imageUrl).openStream()) {
                    Files.copy(in, imagePath, StandardCopyOption.REPLACE_EXISTING);
                    log.info("➕ Saved image: {}", imagePath);
                }
                index++;
            }
        } catch (IOException e) {
            log.error("❌ Failed saving images: {}", e.getMessage(), e);
        }
    }

    private void zipFolderAsCbz(Path folderPath, Path cbzPath) {
        try (ZipOutputStream zipOut = new ZipOutputStream(Files.newOutputStream(cbzPath))) {
            Files.walk(folderPath)
                    .filter(Files::isRegularFile)
                    .forEach(path -> {
                        try (InputStream in = Files.newInputStream(path)) {
                            zipOut.putNextEntry(new ZipEntry(folderPath.relativize(path).toString()));
                            in.transferTo(zipOut);
                            zipOut.closeEntry();
                        } catch (IOException e) {
                            log.error("❌ Failed adding to CBZ: {}", e.getMessage(), e);
                        }
                    });
        } catch (IOException e) {
            log.error("❌ Failed to create CBZ: {}", e.getMessage(), e);
        }
    }
}
