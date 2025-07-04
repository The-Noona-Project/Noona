package com.paxkun.raven.service.download;

import com.paxkun.raven.service.LoggerService;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

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

    public List<String> findSource(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        List<String> imageUrls = new ArrayList<>();

        try {
            driver.get(chapterUrl);
            Thread.sleep(2000);

            // Update: Select correct images
            List<WebElement> images = driver.findElements(By.cssSelector("img.maw-w-full.mx-auto"));

            if (images.isEmpty()) {
                logger.warn("SOURCE", "⚠️ No pages found for chapter: " + chapterUrl);
            } else {
                for (WebElement img : images) {
                    String src = img.getAttribute("src");
                    if (src != null && !src.isEmpty()) {
                        imageUrls.add(src);
                        logger.info("SOURCE", "🖼️ Found page image: " + src);
                    }
                }
            }

            logger.info("SOURCE", "📄 Total pages scraped: " + imageUrls.size());

        } catch (Exception e) {
            logger.error("SOURCE", "❌ Error finding source for URL: " + chapterUrl + " | " + e.getMessage(), e);
        } finally {
            driver.quit();
        }

        return imageUrls;
    }
}
