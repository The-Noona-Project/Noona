package com.paxkun;
import com.paxkun.download.*;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class Main {

    private static final int PAGE_LIMIT = 9999;
    private static final int THREADS = 5;

    public static void main(String[] args) {
        Map<String, String> data = MangaScraper.searchManga();
        if (data.isEmpty()) return;
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
                    String SOURCE_URL = SourceFinder.findSource(chapterLink);
                    if (SOURCE_URL.isEmpty()) return;

                    for (int i = 1; i < PAGE_LIMIT; i++) {
                        String s = SOURCE_URL + manga + "/" + String.format("%04d", chapterNumber) + "-" + String.format("%03d", i) + ".png";
                        if (Download.urlExists(s)) {
                            imageUrls.add(s);
                        } else {
                            break;
                        }
                    }

                    download.downloadChapter(
                            imageUrls,
                            manga + "-" + String.format("%04d", chapterNumber) + ".cbz",
                            "downloads/" + data.get("title") + "/"
                    );
                });
            }
        }
    }
}
