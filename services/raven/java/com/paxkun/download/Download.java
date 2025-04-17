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
            //System.out.println(responseCode);
            return (200 <= responseCode && responseCode < 400);
        } catch (IOException e) {
            return false;
        }
    }

    public void downloadChapter(@NotNull List<String> imageUrls, String cbzFilename, String outputFolder) {
        Path outputDir = Path.of(outputFolder); // e.g., "outputFolder/MANGA"
        Path cbzPath = outputDir.resolve(cbzFilename); // Final output: outputFolder/MANGA/file.cbz
        Path inputPath = Path.of("/temp");  // Still using this as the source for local images

        try {
            Files.createDirectories(cbzPath.getParent()); // Ensure output directory exists

            try (ZipOutputStream zipOut = new ZipOutputStream(Files.newOutputStream(cbzPath))) {
                int index = 1;
                for (String imageUrl : imageUrls) {
                    boolean downloaded = false;
                    int attempts = 0;

                    while (attempts < 3 && !downloaded) {
                        if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
                            try (InputStream in = new URL(imageUrl).openStream()) {
                                String imageName = String.format("%03d.png", index++);
                                ZipEntry entry = new ZipEntry(imageName);
                                zipOut.putNextEntry(entry);
                                in.transferTo(zipOut);
                                zipOut.closeEntry();
                                //System.out.println("Added: " + imageName);
                                downloaded = true;
                            } catch (IOException e) {
                                attempts++;
                                System.err.println("Failed to download: " + imageUrl + " (Attempt " + attempts + "/3)");
                                if (attempts == 3) {
                                    System.err.println("Failed to download after 3 attempts: " + imageUrl);
                                }
                            }
                        } else {
                            Path imagePath = inputPath.resolve(imageUrl);
                            if (Files.exists(imagePath)) {
                                try (InputStream in = Files.newInputStream(imagePath)) {
                                    String imageName = String.format("%03d.png", index++);
                                    ZipEntry entry = new ZipEntry(imageName);
                                    zipOut.putNextEntry(entry);
                                    in.transferTo(zipOut);
                                    zipOut.closeEntry();
                                    //System.out.println("Added: " + imageName);
                                    downloaded = true;
                                } catch (IOException e) {
                                    attempts++;
                                    System.err.println("Failed to read: " + imagePath + " (Attempt " + attempts + "/3)");
                                    if (attempts == 3) {
                                        System.err.println("Failed to read after 3 attempts: " + imagePath);
                                    }
                                }
                            } else {
                                System.err.println("Image not found: " + imagePath);
                                downloaded = true;
                            }
                        }
                    }
                }
            }

            System.out.println("Saved CBZ: " + cbzPath);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
