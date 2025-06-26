package com.paxkun.old;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import java.util.HashSet;
import java.util.Set;

/**
 * SearchAPI is responsible for searching a webpage for specific file types
 * and generating a list of downloadable file URLs.
 */
public class SearchAPI {

    private static final Set<String> downloadList = new HashSet<>();

    /**
     * Starts searching for files of the given type at the specified URL.
     *
     * @param url      The URL to search for downloadable files.
     * @param fileType The file extension to filter by (e.g., ".pdf").
     */
    public static void startSearch(String url, String fileType) {
        try {
            StatusAPI.updateLog("🔍 Searching for " + fileType + " files at: " + url);
            Document doc = Jsoup.connect(url).get();
            Elements links = doc.select("a[href$=" + fileType + "]");

            downloadList.clear(); // Reset previous results

            for (Element link : links) {
                String fileUrl = link.absUrl("href");
                if (downloadList.add(fileUrl)) {
                    StatusAPI.updateLog("📄 Found: " + fileUrl);
                }
            }

            if (downloadList.isEmpty()) {
                StatusAPI.updateLog("⚠️ No matching files found.");
            } else {
                StatusAPI.updateLog("✅ Found " + downloadList.size() + " files. Starting download...");
                DownloadAPI.startDownload(downloadList); // Now correctly passing a Set<String>
            }

        } catch (Exception e) {
            StatusAPI.updateLog("❌ Error during search: " + e.getMessage());
        }
    }
}
