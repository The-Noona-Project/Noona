package com.paxkun.raven.service.download;

import com.paxkun.raven.service.LoggerService;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/**
 * SourceFinder scrapes actual page image URLs for a given manga chapter.
 *
 * Author: Pax
 */
@Component
public class SourceFinder {

    @Autowired
    private LoggerService logger;

    private static final int MAX_PAGES = 500;

    public List<String> findSource(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        List<String> imageUrls = new ArrayList<>();

        try {
            driver.get(chapterUrl);
            Thread.sleep(2000);

            List<WebElement> images = driver.findElements(By.tagName("img"));
            String baseSourceUrl = null;

            for (WebElement img : images) {
                String src = img.getAttribute("src");
                if (src == null) continue;

                if (src.contains("/manga/") && src.endsWith(".png")) {
                    int index = src.indexOf("/manga/");
                    int endIndex = src.lastIndexOf("/");
                    if (index != -1 && endIndex != -1 && endIndex > index + 7) {
                        baseSourceUrl = src.substring(0, endIndex + 1);
                        break;
                    }
                }
            }

            if (baseSourceUrl == null) {
                logger.warn("SOURCE", "⚠️ No base source URL found on page: " + chapterUrl);
                return imageUrls;
            }

            logger.info("SOURCE", "✅ Found base source URL: " + baseSourceUrl);

            String mangaName = extractMangaName(baseSourceUrl);
            String chapterNumber = extractChapterNumber(chapterUrl);

            for (int i = 1; i <= MAX_PAGES; i++) {
                String pageFile = String.format("%s/%s-%03d.png", mangaName, chapterNumber, i);
                String fullUrl = baseSourceUrl + pageFile;

                if (urlExists(fullUrl)) {
                    imageUrls.add(fullUrl);
                } else {
                    break;
                }
            }

            logger.info("SOURCE", "📄 Found " + imageUrls.size() + " pages for Chapter " + chapterNumber);

        } catch (Exception e) {
            logger.error("SOURCE", "❌ Error finding source for URL: " + chapterUrl + " | " + e.getMessage(), e);
        } finally {
            driver.quit();
        }

        return imageUrls;
    }

    private String extractMangaName(String baseSourceUrl) {
        String[] parts = baseSourceUrl.split("/");
        for (int i = 0; i < parts.length; i++) {
            if (parts[i].equals("manga") && i + 1 < parts.length) {
                return parts[i + 1];
            }
        }
        return "unknown_manga";
    }

    private String extractChapterNumber(String chapterUrl) {
        String[] parts = chapterUrl.split("/");
        String last = parts[parts.length - 1];
        if (last.matches("\\d+")) {
            return String.format("%04d", Integer.parseInt(last));
        }
        return "0000";
    }

    private boolean urlExists(String urlStr) {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(urlStr).openConnection();
            connection.setRequestMethod("HEAD");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0");
            connection.setRequestProperty("Referer", "https://weebcentral.com/");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            int responseCode = connection.getResponseCode();
            return (200 <= responseCode && responseCode < 400);
        } catch (Exception e) {
            logger.warn("SOURCE", "⚠️ Failed HEAD request for " + urlStr + ": " + e.getMessage());
            return false;
        }
    }
}
