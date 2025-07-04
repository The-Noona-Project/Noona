package com.paxkun.raven.service.download;

import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.select.Elements;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * SourceFinder scrapes base image source URLs for a given manga chapter.
 *
 * Author: Pax
 */
@Slf4j
@Component
public class SourceFinder {

    /**
     * Retrieves the base URL for chapter page images.
     * For example:
     * "<a href="https://hot.planeptune.us/manga/Solo-Leveling/">...</a>"
     *
     * @param chapterUrl The URL of the manga chapter page.
     * @return List with one entry: the base source URL.
     */
    public List<String> findSource(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        List<String> sources = new ArrayList<>();

        try {
            driver.get(chapterUrl);
            Thread.sleep(2000); // Wait to ensure full page load

            List<WebElement> images = driver.findElements(By.tagName("img"));
            Pattern pattern = Pattern.compile("(https://[^\\s]+/manga/[^/]+/)");

            for (WebElement img : images) {
                String src = img.getAttribute("src");
                if (src == null) continue;

                Matcher matcher = pattern.matcher(src);
                if (matcher.find()) {
                    String baseSourceUrl = matcher.group(1);
                    log.info("✅ Found base source URL: {}", baseSourceUrl);
                    sources.add(baseSourceUrl);
                    break; // Only need the first valid match
                }
            }

            if (sources.isEmpty()) {
                log.warn("⚠️ No valid image base source found on page: {}", chapterUrl);
            }

        } catch (Exception e) {
            log.error("❌ Error finding source for URL: {}", chapterUrl, e);
        } finally {
            driver.quit();
        }

        return sources;
    }
}
