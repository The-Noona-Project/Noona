package com.paxkun.raven.service.download;

import lombok.extern.slf4j.Slf4j;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
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
@Slf4j
@Component
public class SourceFinder {

    private static final int MAX_PAGES = 500;

    /**
     * Retrieves all image URLs for the given chapter.
     *
     * @param chapterUrl The URL of the manga chapter page.
     * @return List of full image URLs for the chapter.
     */
    public List<String> findSource(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        List<String> imageUrls = new ArrayList<>();

        try {
            driver.get(chapterUrl);
            Thread.sleep(2000); // Ensure full page load

            List<WebElement> images = driver.findElements(By.tagName("img"));
            String baseSourceUrl = null;

            for (WebElement img : images) {
                String src = img.getAttribute("src");
                if (src == null) continue;

                if (src.contains("/manga/")) {
                    int index = src.indexOf("/manga/");
                    baseSourceUrl = src.substring(0, index + 7); // includes "/manga/"
                    break;
                }
            }

            if (baseSourceUrl == null) {
                log.warn("⚠️ No base source URL found on page: {}", chapterUrl);
                return imageUrls;
            }

            log.info("✅ Found base source URL: {}", baseSourceUrl);

            // Determine manga folder from URL structure
            String mangaName = extractMangaName(baseSourceUrl);

            // Determine chapter number from the page URL or site pattern if needed
            String chapterNumber = extractChapterNumber(chapterUrl);

            // Generate sequential page URLs and test existence
            for (int i = 1; i <= MAX_PAGES; i++) {
                String pageFile = String.format("%s/%s-%03d.png", mangaName, chapterNumber, i);
                String fullUrl = baseSourceUrl + pageFile;

                if (urlExists(fullUrl)) {
                    imageUrls.add(fullUrl);
                } else {
                    break; // No more pages for this chapter
                }
            }

            log.info("📄 Found {} pages for Chapter {}", imageUrls.size(), chapterNumber);

        } catch (Exception e) {
            log.error("❌ Error finding source for URL: {}", chapterUrl, e);
        } finally {
            driver.quit();
        }

        return imageUrls;
    }

    /**
     * Extracts the manga name from the base source URL.
     *
     * @param baseSourceUrl The base URL string.
     * @return Manga folder name.
     */
    private String extractMangaName(String baseSourceUrl) {
        String[] parts = baseSourceUrl.split("/");
        return parts[parts.length - 1].isEmpty() ? parts[parts.length - 2] : parts[parts.length - 1];
    }

    /**
     * Extracts chapter number from the chapter URL.
     * Adjust logic based on your site pattern.
     *
     * @param chapterUrl The chapter URL.
     * @return Chapter number as string.
     */
    private String extractChapterNumber(String chapterUrl) {
        String[] parts = chapterUrl.split("/");
        return parts[parts.length - 1];
    }

    /**
     * Checks if a URL exists using HEAD request with proper headers.
     *
     * @param urlStr The URL to check.
     * @return true if exists, false otherwise.
     */
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
            return false;
        }
    }
}
