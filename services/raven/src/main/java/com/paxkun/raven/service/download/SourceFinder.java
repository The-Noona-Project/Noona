package com.paxkun.raven.service.download;

import lombok.extern.slf4j.Slf4j;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
public class SourceFinder {

    public static Optional<String> findSource(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        Pattern pattern = Pattern.compile("(https://\\S+/manga/[^/]+/\\d{4}-001\\.png)");
        ChromeDriver driver = null;

        try {
            driver = new ChromeDriver(options);
            driver.get(chapterUrl);
            Thread.sleep(2000);

            List<WebElement> images = driver.findElements(By.tagName("img"));
            log.info("Found {} <img> tags on page {}", images.size(), chapterUrl);

            for (WebElement img : images) {
                String src = img.getAttribute("src");
                if ((src == null || src.isEmpty()) && img.getAttribute("data-src") != null) {
                    src = img.getAttribute("data-src");
                }
                if (src == null || src.isEmpty()) continue;

                log.debug("Checking image src: {}", src);

                Matcher matcher = pattern.matcher(src);
                if (matcher.find()) {
                    String fullUrl = matcher.group(1);
                    int lastSlash = fullUrl.lastIndexOf('/');
                    if (lastSlash != -1) {
                        String result = fullUrl.substring(0, lastSlash + 1);
                        log.info("Base source URL found: {}", result);
                        return Optional.of(result);
                    }
                }
            }

            log.warn("No matching image source found for URL: {}", chapterUrl);

        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.error("Interrupted while finding source: {}", ie.getMessage(), ie);
        } catch (Exception e) {
            log.error("Error finding source for URL: {}", chapterUrl, e);
        } finally {
            if (driver != null) {
                driver.quit();
            }
        }

        return Optional.empty();
    }
}
