package com.paxkun.raven.service.download;

import com.paxkun.raven.service.LoggerService;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.net.URL;
import java.util.*;

/**
 * SourceFinder scrapes actual page image URLs for a given manga chapter.
 * Supports multiple known host patterns via an easy-to-extend scraper map.
 *
 * Author: Pax
 */
@Component
public class SourceFinder {

    @Autowired
    private LoggerService logger;

    /**
     * Map of domain -> ScraperFunction
     */
    private final Map<String, ScraperFunction> scrapers = new HashMap<>();

    public SourceFinder() {
        // Register supported domain scrapers here
        scrapers.put("hot.planeptune.us", this::scrapePlaneptune);
        scrapers.put("scans.lastation.us", this::scrapeLastation);
        scrapers.put("official.lowee.us", this::scrapeLowee);
        // Add more as needed
    }

    /**
     * Finds the source images for a given chapter URL.
     */
    public List<String> findSource(String chapterUrl) {
        List<String> imageUrls = new ArrayList<>();
        String domain = extractDomain(chapterUrl);

        ScraperFunction scraper = scrapers.get(domain);
        if (scraper != null) {
            logger.info("SOURCE", "🔍 Using scraper for domain: " + domain);
            imageUrls = scraper.scrape(chapterUrl);
        } else {
            logger.warn("SOURCE", "⚠️ No scraper registered for domain: " + domain + ". Attempting default strategy.");
            imageUrls = defaultScrape(chapterUrl);
        }

        logger.info("SOURCE", "📄 Total pages scraped: " + imageUrls.size());
        return imageUrls;
    }

    /**
     * Default scraper strategy using general image selection.
     */
    private List<String> defaultScrape(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        List<String> imageUrls = new ArrayList<>();

        try {
            driver.get(chapterUrl);
            Thread.sleep(2000);

            List<WebElement> images = driver.findElements(By.tagName("img"));
            for (WebElement img : images) {
                String src = img.getAttribute("src");
                if (src != null && !src.isEmpty()) {
                    imageUrls.add(src);
                    logger.info("SOURCE", "🖼️ Found image: " + src);
                }
            }

        } catch (Exception e) {
            logger.error("SOURCE", "❌ Default scrape failed for: " + chapterUrl + " | " + e.getMessage(), e);
        } finally {
            driver.quit();
        }

        return imageUrls;
    }

    /**
     * Scraper for hot.planeptune.us
     */
    private List<String> scrapePlaneptune(String chapterUrl) {
        return genericImageScrape(chapterUrl, "img.maw-w-full.mx-auto");
    }

    /**
     * Scraper for scans.lastation.us
     */
    private List<String> scrapeLastation(String chapterUrl) {
        return genericImageScrape(chapterUrl, "img.maw-w-full.mx-auto");
    }

    /**
     * Scraper for official.lowee.us
     */
    private List<String> scrapeLowee(String chapterUrl) {
        return genericImageScrape(chapterUrl, "img.maw-w-full.mx-auto");
    }

    /**
     * Generic scraper for a given CSS selector.
     */
    private List<String> genericImageScrape(String chapterUrl, String cssSelector) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        List<String> imageUrls = new ArrayList<>();

        try {
            driver.get(chapterUrl);
            Thread.sleep(2000);

            List<WebElement> images = driver.findElements(By.cssSelector(cssSelector));
            if (images.isEmpty()) {
                logger.warn("SOURCE", "⚠️ No images found with selector: " + cssSelector);
            } else {
                for (WebElement img : images) {
                    String src = img.getAttribute("src");
                    if (src != null && !src.isEmpty()) {
                        imageUrls.add(src);
                        logger.info("SOURCE", "🖼️ Found page image: " + src);
                    }
                }
            }

        } catch (Exception e) {
            logger.error("SOURCE", "❌ Scrape failed for " + chapterUrl + " | " + e.getMessage(), e);
        } finally {
            driver.quit();
        }

        return imageUrls;
    }

    /**
     * Extracts the domain from a URL.
     */
    private String extractDomain(String url) {
        try {
            return new URL(url).getHost();
        } catch (Exception e) {
            logger.warn("SOURCE", "⚠️ Failed to extract domain from URL: " + url);
            return "unknown";
        }
    }

    /**
     * Functional interface for scrapers.
     */
    @FunctionalInterface
    interface ScraperFunction {
        List<String> scrape(String chapterUrl);
    }
}
