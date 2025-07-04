package com.paxkun.raven.service.download;

import com.paxkun.raven.service.LoggerService;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.openqa.selenium.*;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

/**
 * TitleScraper handles searching for manga titles and scraping chapter lists
 * from weebcentral.com using Selenium and Jsoup.
 *
 * Author: Pax
 */
@Component
public class TitleScraper {

    @Autowired
    private LoggerService logger;

    private List<Map<String, String>> lastSearchResults = new ArrayList<>();

    public List<Map<String, String>> searchManga(String titleName) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        List<Map<String, String>> results = new ArrayList<>();

        try {
            String encodedTitle = URLEncoder.encode(titleName, StandardCharsets.UTF_8);
            String searchUrl = "https://weebcentral.com/search/?text=" + encodedTitle +
                    "&sort=Best+Match&order=Ascending&official=Any&anime=Any&adult=Any&display_mode=Full+Display";

            driver.get(searchUrl);

            WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));
            wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector("section#search-results a.line-clamp-1.link.link-hover")));

            Document doc = Jsoup.parse(driver.getPageSource());
            Elements mangaResults = doc.select("section#search-results a.line-clamp-1.link.link-hover");

            logger.info("SCRAPER", "🔍 Found " + mangaResults.size() + " manga search results for '" + titleName + "'");

            int index = 1;
            for (Element manga : mangaResults) {
                Map<String, String> data = new HashMap<>();
                data.put("index", String.valueOf(index));
                data.put("title", manga.text());
                data.put("href", manga.absUrl("href"));
                results.add(data);

                logger.info("SCRAPER", "➡️ [" + index + "] " + manga.text() + " -> " + manga.absUrl("href"));
                index++;
            }

            lastSearchResults = results;

        } catch (Exception e) {
            logger.error("SCRAPER", "❌ Error searching manga: " + e.getMessage(), e);
        } finally {
            driver.quit();
        }

        return results;
    }

    public Map<String, String> getResultByIndex(int index) {
        int adjustedIndex = index - 1;
        if (lastSearchResults != null && adjustedIndex >= 0 && adjustedIndex < lastSearchResults.size()) {
            return lastSearchResults.get(adjustedIndex);
        } else {
            throw new IndexOutOfBoundsException("Invalid index for search results: " + index);
        }
    }

    public List<Map<String, String>> getLastSearchResults() {
        return Collections.unmodifiableList(lastSearchResults);
    }

    public List<Map<String, String>> getChapters(String titleUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        List<Map<String, String>> chapters = new ArrayList<>();

        try {
            driver.get(titleUrl);
            WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));

            List<WebElement> showAllButtons = driver.findElements(By.xpath("//button[contains(text(), 'Show All Chapters')]"));
            if (!showAllButtons.isEmpty()) {
                WebElement button = showAllButtons.get(0);
                logger.info("SCRAPER", "🔄 'Show All Chapters' button found, clicking...");
                button.click();

                wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector("a.flex.items-center.p-2")));
                Thread.sleep(1000);
                logger.info("SCRAPER", "🔁 Re-fetching chapter links after expanding full list...");
            }

            List<WebElement> chapterLinks = driver.findElements(By.cssSelector("a.flex.items-center.p-2"));
            logger.info("SCRAPER", "🔍 Found " + chapterLinks.size() + " chapter links for URL: " + titleUrl);

            int index = 0;
            for (WebElement chapter : chapterLinks) {
                try {
                    String chapterTitle = chapter.getText();
                    String href = chapter.getAttribute("href");

                    String chapterNumber = extractChapterNumber(chapterTitle);
                    Map<String, String> data = new HashMap<>();
                    data.put("chapter_number", chapterNumber.isEmpty() ? String.valueOf(index) : chapterNumber);
                    data.put("chapter_title", chapterTitle);
                    data.put("href", href);
                    chapters.add(data);

                    logger.info("SCRAPER", "📄 Chapter [" + index + "]: " + chapterTitle + " -> " + href);
                } catch (Exception inner) {
                    logger.warn("SCRAPER", "⚠️ Failed to parse chapter at index " + index + ": " + inner.getMessage());
                }
                index++;
            }

        } catch (Exception e) {
            logger.error("SCRAPER", "❌ Error scraping chapters: " + e.getMessage(), e);
        } finally {
            driver.quit();
        }

        return chapters;
    }

    private String extractChapterNumber(String text) {
        String cleaned = text.replaceAll("[^0-9.]", "");
        if (cleaned.contains(".")) {
            String[] parts = cleaned.split("\\.");
            return parts[0];
        }
        return cleaned;
    }
}
