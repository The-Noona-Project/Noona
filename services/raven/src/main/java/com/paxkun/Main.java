package com.paxkun;

import com.paxkun.download.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class Main {

    private static final int PAGE_LIMIT = 9999;
    private static final int THREADS = 2;

    public static void main(String[] args) {
        System.out.println("🦉 Raven downloader starting...");

        Map<String, String> data = MangaScraper.searchManga();
        if (data.isEmpty()) {
            System.out.println("No manga found. Exiting Raven.");
            return;
        }

        String href = data.get("href");
        String url = href.substring(0, href.lastIndexOf("/"));
        String manga = href.substring(href.lastIndexOf("/") + 1);
        Map<Integer, String> chapters = ChapterScraper.chapterLinks(url + "/full-chapter-list");

        try (AutoCloseableExecutor autoExec = new AutoCloseableExecutor(Executors.newFixedThreadPool(THREADS))) {
            ExecutorService executor = autoExec.executor();
            System.out.println("Number of chapters found: " + chapters.size());

            for (Map.Entry<Integer, String> entry : chapters.entrySet()) {
                int chapterNumber = entry.getKey();
                String chapterLink = entry.getValue();

                executor.submit(() -> {
                    Download download = new Download();
                    List<String> imageUrls = new ArrayList<>();

                    String sourceUrl = "";
                    try {
                        sourceUrl = SourceFinder.findSource(chapterLink);
                    } catch (Exception e) {
                        System.err.println("Failed to find source for chapter " + chapterNumber + ": " + e.getMessage());
                        e.printStackTrace();
                    }

                    if (sourceUrl == null || sourceUrl.isEmpty()) {
                        System.out.println("Skipping chapter " + chapterNumber + " due to missing source URL.");
                        return;
                    }

                    for (int i = 1; i < PAGE_LIMIT; i++) {
                        String imageUrl = sourceUrl + manga + "/" + String.format("%04d", chapterNumber) + "-" + String.format("%03d", i) + ".png";
                        if (Download.urlExists(imageUrl)) {
                            imageUrls.add(imageUrl);
                        } else {
                            break;
                        }
                    }

                    if (!imageUrls.isEmpty()) {
                        download.downloadChapter(
                                imageUrls,
                                manga + "-" + String.format("%04d", chapterNumber) + ".cbz",
                                "downloads/" + data.get("title") + "/"
                        );
                    } else {
                        System.out.println("No pages found for chapter " + chapterNumber);
                    }
                });
            }
        }

        System.out.println("✅ Raven download process completed. Exiting.");
    }
}
