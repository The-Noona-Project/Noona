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
        logger.debug("SOURCE", "Incoming chapter URL for source finding: " + chapterUrl);
        String domain = extractDomain(chapterUrl);
        logger.debug("SOURCE", "Extracted domain: " + domain);

        ScraperFunction scraper = scrapers.get(domain);
        logger.debug("SOURCE", "Scraper function resolved: " + (scraper != null ? "registered handler" : "none"));
        if (scraper != null) {
            logger.info("SOURCE", "🔍 Using scraper for domain: " + domain);
            imageUrls = scraper.scrape(chapterUrl);
        } else {
            logger.warn("SOURCE", "⚠️ No scraper registered for domain: " + domain + ". Attempting default strategy.");
            imageUrls = defaultScrape(chapterUrl);
            logger.debug("SOURCE", "Default fallback strategy triggered for domain: " + domain);
        }

        logger.info("SOURCE", "📄 Total pages scraped: " + imageUrls.size());
        return imageUrls;
    }

    /**
     * Default scraper strategy using general image selection.
     */
    private List<String> defaultScrape(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        List<String> appliedArguments = Arrays.asList("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");
        options.addArguments(appliedArguments);
        logger.debug("SOURCE", "Default scrape ChromeOptions applied: " + appliedArguments);

        WebDriver driver = new ChromeDriver(options);
        logger.debug("SOURCE", "Initialized WebDriver for default scrape of: " + chapterUrl);
        List<String> imageUrls = new ArrayList<>();

        try {
            driver.get(chapterUrl);
            logger.debug("SOURCE", "Navigated to chapter URL, applying throttle wait of 2000ms for default scrape.");
            Thread.sleep(2000);

            By imageSelector = By.tagName("img");
            logger.debug("SOURCE", "Using selector for default scrape: " + imageSelector);
            List<WebElement> images = driver.findElements(imageSelector);
            logger.debug("SOURCE", "Raw image elements before filtering: " + images.size());
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
        List<String> appliedArguments = Arrays.asList("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");
        options.addArguments(appliedArguments);
        logger.debug("SOURCE", "Generic scrape ChromeOptions applied: " + appliedArguments);

        WebDriver driver = new ChromeDriver(options);
        logger.debug("SOURCE", "Initialized WebDriver for generic scrape of: " + chapterUrl);
        List<String> imageUrls = new ArrayList<>();

        try {
            driver.get(chapterUrl);
            logger.debug("SOURCE", "Navigated to chapter URL, applying throttle wait of 2000ms for generic scrape.");
            Thread.sleep(2000);

            List<WebElement> images = driver.findElements(By.cssSelector(cssSelector));
            logger.debug("SOURCE", "Using selector for generic scrape: " + cssSelector + ", raw elements before filtering: " + images.size());
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
