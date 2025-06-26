package com.paxkun.old;

import org.jetbrains.annotations.NotNull;

import java.io.*;
import java.nio.file.*;
import java.util.Set;

/**
 * DownloadAPI is responsible for downloading files from the URLs
 * provided by the SearchAPI and organizing them into folders.
 */
public class DownloadAPI {

    private static Path downloadDirectory;
    private static int totalFiles = 0;
    private static int filesDownloaded = 0;

    /**
     * Starts the download process for a set of file URLs.
     *
     * @param fileLinks The set of file URLs to download.
     */
    public static void startDownload(@NotNull Set<String> fileLinks) {
        if (fileLinks.isEmpty()) {
            StatusAPI.updateLog("⚠️ No files to download.");
            return;
        }

        totalFiles = fileLinks.size();
        filesDownloaded = 0;

        try {
            downloadDirectory = createDownloadDirectory();
            StatusAPI.updateLog("📂 Downloading files to: " + downloadDirectory.toAbsolutePath());

            for (String fileUrl : fileLinks) {
                if (CancelAPI.isCancelRequested()) {
                    StatusAPI.updateLog("⛔ Download canceled by user.");
                    return;
                }

                downloadFile(fileUrl);
            }

            StatusAPI.updateLog("✅ All files downloaded. Starting ZIP process...");
            ZipperAPI.zipAllFiles(downloadDirectory);

        } catch (Exception e) {
            StatusAPI.updateLog("❌ Download error: " + e.getMessage());
        }
    }

    /**
     * Downloads a single file from a given URL.
     *
     * @param fileUrl The URL of the file to download.
     */
    private static void downloadFile(String fileUrl) {
        try {
            String fileName = new File(fileUrl).getName();
            Path filePath = downloadDirectory.resolve(fileName);

            StatusAPI.updateLog("⬇️ Downloading: " + fileName);

            try (InputStream in = new FileInputStream(filePath.toFile())) {
                OutputStream out = Files.newOutputStream(filePath);
                in.transferTo(out);
            }

            filesDownloaded++;
            int progress = (filesDownloaded * 100) / totalFiles;
            StatusAPI.updateLog(String.valueOf(progress));

            StatusAPI.updateLog("✅ Downloaded: " + fileName);

        } catch (Exception e) {
            StatusAPI.updateLog("❌ Error downloading file: " + e.getMessage());
        }
    }

    /**
     * Creates a download directory based on the current timestamp.
     *
     * @return The created directory path.
     * @throws IOException If an error occurs while creating the directory.
     */
    @NotNull
    private static Path createDownloadDirectory() throws IOException {
        Path path = Paths.get("downloads", "session_" + System.currentTimeMillis());
        Files.createDirectories(path);
        return path;
    }
}
