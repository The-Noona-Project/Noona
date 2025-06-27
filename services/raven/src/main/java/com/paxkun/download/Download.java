package com.paxkun.download;

import org.jetbrains.annotations.NotNull;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public class Download {

    public static boolean urlExists(String urlStr) {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(urlStr).openConnection();
            connection.setRequestMethod("HEAD");
            connection.setConnectTimeout(3000);
            connection.setReadTimeout(3000);
            int responseCode = connection.getResponseCode();
            return (200 <= responseCode && responseCode < 400);
        } catch (IOException e) {
            System.err.println("Failed to check URL: " + urlStr + " - " + e.getMessage());
            return false;
        }
    }

    public void downloadChapter(@NotNull List<String> imageUrls, String cbzFilename, String outputFolder) {
        Path outputDir = Path.of(outputFolder);
        Path cbzPath = outputDir.resolve(cbzFilename);
        Path inputPath = Path.of("/temp");  // Adjust as needed for local images

        try {
            Files.createDirectories(cbzPath.getParent());

            try (ZipOutputStream zipOut = new ZipOutputStream(Files.newOutputStream(cbzPath))) {
                int index = 1;
                for (String imageUrl : imageUrls) {
                    boolean downloaded = false;
                    int attempts = 0;

                    while (attempts < 3 && !downloaded) {
                        attempts++;
                        if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
                            downloaded = downloadFromUrl(imageUrl, zipOut, index);
                        } else {
                            downloaded = downloadFromLocal(inputPath.resolve(imageUrl), zipOut, index);
                        }

                        if (!downloaded && attempts < 3) {
                            try {
                                Thread.sleep(1000L * attempts); // Exponential backoff
                            } catch (InterruptedException ie) {
                                Thread.currentThread().interrupt();
                                System.err.println("Thread interrupted during backoff");
                                return;
                            }
                        }

                        if (downloaded) index++;
                    }

                    if (!downloaded) {
                        System.err.println("Failed to add image after 3 attempts: " + imageUrl);
                    }
                }
            }

            System.out.println("Saved CBZ: " + cbzPath);
        } catch (IOException e) {
            System.err.println("Failed to create CBZ: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private boolean downloadFromUrl(String imageUrl, ZipOutputStream zipOut, int index) {
        try (InputStream in = new URL(imageUrl).openStream()) {
            String imageName = String.format("%03d.png", index);
            ZipEntry entry = new ZipEntry(imageName);
            zipOut.putNextEntry(entry);
            in.transferTo(zipOut);
            zipOut.closeEntry();
            return true;
        } catch (IOException e) {
            System.err.println("Failed to download: " + imageUrl + " - " + e.getMessage());
            return false;
        }
    }

    private boolean downloadFromLocal(Path imagePath, ZipOutputStream zipOut, int index) {
        if (Files.exists(imagePath)) {
            try (InputStream in = Files.newInputStream(imagePath)) {
                String imageName = String.format("%03d.png", index);
                ZipEntry entry = new ZipEntry(imageName);
                zipOut.putNextEntry(entry);
                in.transferTo(zipOut);
                zipOut.closeEntry();
                return true;
            } catch (IOException e) {
                System.err.println("Failed to read local file: " + imagePath + " - " + e.getMessage());
                return false;
            }
        } else {
            System.err.println("Local image not found: " + imagePath);
            return true; // Mark as 'downloaded' to skip retries if file is missing
        }
    }
}
