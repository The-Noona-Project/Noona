package com.paxkun.raven.service;

import com.paxkun.raven.service.download.DownloadChapter;
import com.paxkun.raven.service.download.SearchTitle;
import com.paxkun.raven.service.download.SourceFinder;
import com.paxkun.raven.service.download.TitleScraper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
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
@Slf4j
@Service
public class DownloadService {

    @Autowired
    private TitleScraper titleScraper;

    @Autowired
    private SourceFinder sourceFinder;

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
     * Downloads all chapters for a selected title as CBZ files.
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

                List<String> pageUrls = sourceFinder.findSource(chapterUrl);
                if (pageUrls.isEmpty()) {
                    log.warn("⚠️ No pages found for chapter {}. Skipping.", chapterNumber);
                    continue;
                }

                Path chapterFolder = DOWNLOAD_ROOT.resolve(titleSlug).resolve(chapterNumber);
                saveImagesToFolder(pageUrls, chapterFolder);

                Path cbzPath = DOWNLOAD_ROOT.resolve(titleSlug).resolve(chapterNumber + ".cbz");
                zipFolderAsCbz(chapterFolder, cbzPath);

                log.info("📦 Chapter [{}] saved as CBZ at {}", chapterNumber, cbzPath);

                deleteFolder(chapterFolder);
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

    /**
     * Retrieves the selected title from last search results.
     *
     * @param userIndex 1-based index provided by user.
     * @return Map with title data.
     */
    private Map<String, String> getSelectedTitle(int userIndex) {
        int optionIndex = userIndex - 1;
        if (optionIndex < 0 || optionIndex >= titleScraper.getLastSearchResults().size()) {
            throw new IndexOutOfBoundsException("Invalid option index: " + userIndex);
        }
        return titleScraper.getResultByIndex(userIndex);
    }

    /**
     * Saves images from URLs into a chapter folder, retaining original extensions.
     *
     * @param imageUrls URLs of images to save.
     * @param folderPath Destination folder path.
     */
    private void saveImagesToFolder(List<String> imageUrls, Path folderPath) {
        try {
            Files.createDirectories(folderPath);
            int index = 1;
            for (String imageUrl : imageUrls) {
                String ext = imageUrl.substring(imageUrl.lastIndexOf('.')); // retain original extension
                Path imagePath = folderPath.resolve(String.format("%03d%s", index, ext));
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

    /**
     * Zips a chapter folder as a CBZ archive.
     *
     * @param folderPath Folder containing images.
     * @param cbzPath    Destination CBZ file path.
     */
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

    /**
     * Deletes a folder and all its contents.
     *
     * @param folderPath Folder path to delete.
     */
    private void deleteFolder(Path folderPath) {
        try {
            Files.walk(folderPath)
                    .sorted(Comparator.reverseOrder())
                    .forEach(path -> {
                        try {
                            Files.delete(path);
                        } catch (IOException e) {
                            log.warn("⚠️ Failed to delete file {}: {}", path, e.getMessage());
                        }
                    });
            log.info("🗑️ Deleted temp folder: {}", folderPath);
        } catch (IOException e) {
            log.warn("⚠️ Failed to delete folder {}: {}", folderPath, e.getMessage());
        }
    }
}
