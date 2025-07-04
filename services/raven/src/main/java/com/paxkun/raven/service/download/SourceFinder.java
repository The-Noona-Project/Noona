package com.paxkun.raven.service.download;

import lombok.extern.slf4j.Slf4j;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SourceFinder locates the base source URL for chapter images using Selenium and ChromeDriver.
 * Targets Tailwind and Glide structures for reliability.
 *
 * Author: Pax
 */
@Slf4j
public class SourceFinder {

    /**
     * Finds the base source URL for chapter images.
     *
     * @param chapterUrl the URL of the chapter page
     * @return Optional of the source URL prefix, empty if not found
     */
    public static Optional<String> findSource(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        Pattern pattern = Pattern.compile("(https://[^\\s\"']+/(?:uploads|manga)/[^/]+/\\d{4}-001\\.png)");

        WebDriver driver = null;
        try {
            driver = new ChromeDriver(options);
            driver.get(chapterUrl);

            // Wait up to 10s for Glide slides or images to load
            WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));
            wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector(".glide__slide img, img")));

            List<WebElement> images = driver.findElements(By.cssSelector(".glide__slide img, img"));
            log.info("🔍 Found {} images on page {}", images.size(), chapterUrl);

            for (WebElement img : images) {
                String src = img.getAttribute("src");
                if (src == null || src.isEmpty()) {
                    src = img.getAttribute("data-src");
                }
                if (src == null || src.isEmpty()) continue;

                Matcher matcher = pattern.matcher(src);
                if (matcher.find()) {
                    String fullUrl = matcher.group(1);
                    int lastSlash = fullUrl.lastIndexOf('/');
                    if (lastSlash != -1) {
                        String result = fullUrl.substring(0, lastSlash + 1);
                        log.info("✅ Base source URL found: {}", result);
                        return Optional.of(result);
                    }
                }
            }

            log.warn("⚠️ No matching image source found for URL: {}", chapterUrl);

        } catch (Exception e) {
            log.error("❌ Error finding source for URL: {}", chapterUrl, e);
        } finally {
            if (driver != null) {
                driver.quit();
            }
        }

        return Optional.empty();
    }
}
