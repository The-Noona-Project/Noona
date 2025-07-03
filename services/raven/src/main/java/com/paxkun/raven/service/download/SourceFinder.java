package com.paxkun.raven.service.download;

import lombok.extern.slf4j.Slf4j;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SourceFinder locates the base source URL for chapter images using Selenium and ChromeDriver.
 * Used by Raven for chapter downloads.
 *
 * @author Pax
 */
@Slf4j
public class SourceFinder {

    /**
     * Finds the base source URL for chapter images.
     *
     * @param chapterUrl the URL of the chapter page
     * @return the source URL prefix, or an empty string if not found
     */
    public static String findSource(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        String result = "";

        try {
            driver.get(chapterUrl);
            Thread.sleep(2000); // Ensure page fully loads

            List<WebElement> images = driver.findElements(By.tagName("img"));
            Pattern pattern = Pattern.compile("(https://[^\\s]+/manga/[^/]+/\\d{4}-001\\.png)");

            for (WebElement img : images) {
                String src = img.getAttribute("src");
                if (src == null || src.isEmpty()) continue;

                Matcher matcher = pattern.matcher(src);
                if (matcher.find()) {
                    String fullUrl = matcher.group(1);
                    int index = fullUrl.indexOf("/manga/");
                    if (index != -1) {
                        result = fullUrl.substring(0, index + 7);
                        log.info("Base source URL found: {}", result);
                        return result;
                    }
                }
            }

            log.warn("No matching image source found for URL: {}", chapterUrl);

        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt(); // restore interrupt status
            log.error("Interrupted while finding source: {}", ie.getMessage(), ie);
        } catch (Exception e) {
            log.error("Error finding source for URL: {}", chapterUrl, e);
        } finally {
            driver.quit();
        }

        return result;
    }
}
