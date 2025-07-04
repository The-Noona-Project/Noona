package com.paxkun.raven.service.download;

import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.select.Elements;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * SourceFinder scrapes all page image URLs for a given manga chapter.
 * <p>
 * Author: Pax
 */
@Slf4j
@Component
public class SourceFinder {

    /**
     * Retrieves all page image URLs for a given chapter URL.
     *
     * @param chapterUrl The URL of the manga chapter page.
     * @return List of image URLs.
     */
    public List<String> findSource(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        List<String> images = new ArrayList<>();

        try {
            driver.get(chapterUrl);

            WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(20)); // increased wait time

            // Use a more specific selector if possible (update based on actual site)
            By imageSelector = By.cssSelector("img"); // e.g. "img.page-image"
            wait.until(ExpectedConditions.presenceOfElementLocated(imageSelector));

            Document doc = Jsoup.parse(driver.getPageSource());
            Elements imgElements = doc.select("img"); // e.g. "img.page-image"

            for (var img : imgElements) {
                String src = img.absUrl("src");
                if (!src.isEmpty()) {
                    images.add(src);
                    log.info("🖼️ Found image: {}", src);
                }
            }

            if (images.isEmpty()) {
                log.warn("⚠️ No images found on page: {}", chapterUrl);
            } else {
                log.info("✅ Found {} images on page {}", images.size(), chapterUrl);
            }

        } catch (Exception e) {
            log.error("❌ Error finding source for URL: {}", chapterUrl, e);
            // Do NOT throw here; return empty list so DownloadService can skip
        } finally {
            driver.quit();
        }

        return images;
    }
}
