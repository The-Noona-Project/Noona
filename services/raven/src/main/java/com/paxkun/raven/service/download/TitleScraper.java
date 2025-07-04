package com.paxkun.raven.service.download;

import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

/**
 * TitleScraper handles searching for manga titles and scraping chapter lists
 * from weebcentral.com using Selenium and Jsoup.
 * <p>
 * Author: Pax
 */
@Slf4j
@Component
public class TitleScraper {

    private List<Map<String, String>> lastSearchResults = new ArrayList<>();

    /**
     * Searches weebcentral.com for manga titles matching the provided query.
     *
     * @param titleName The manga title to search.
     * @return List of results, each as a map containing "index", "title", and "href".
     */
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

            log.info("🔍 Found {} manga search results for '{}'", mangaResults.size(), titleName);

            int index = 1;
            for (Element manga : mangaResults) {
                Map<String, String> data = new HashMap<>();
                data.put("index", String.valueOf(index));
                data.put("title", manga.text());
                data.put("href", manga.absUrl("href"));
                results.add(data);

                log.info("➡️ [{}] {} -> {}", index, manga.text(), manga.absUrl("href"));
                index++;
            }

            lastSearchResults = results;

        } catch (Exception e) {
            log.error("❌ Error searching manga: {}", e.getMessage(), e);
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

    /**
     * Retrieves all chapters for a given title page, clicking "Show All Chapters" if available.
     *
     * @param titleUrl The main title page URL.
     * @return List of chapters with "chapter_number", "chapter_title", and "href".
     */
    public List<Map<String, String>> getChapters(String titleUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        List<Map<String, String>> chapters = new ArrayList<>();

        try {
            driver.get(titleUrl);

            WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));

            // Click "Show All Chapters" if it exists
            List<WebElement> showAllButtons = driver.findElements(By.xpath("//button[contains(text(), 'Show All Chapters')]"));
            if (!showAllButtons.isEmpty()) {
                WebElement button = showAllButtons.get(0);
                log.info("🔄 'Show All Chapters' button found, clicking...");
                button.click();

                wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector("a.flex.items-center.p-2")));
                Thread.sleep(1000); // buffer for DOM update

                // ✅ Re-fetch after DOM update to avoid stale references
                log.info("🔁 Re-fetching chapter links after expanding full list...");
            }

            // Always fetch chapter links fresh after any click
            List<WebElement> chapterLinks = driver.findElements(By.cssSelector("a.flex.items-center.p-2"));
            log.info("🔍 Found {} chapter links for URL: {}", chapterLinks.size(), titleUrl);

            int index = 0;
            for (WebElement chapter : chapterLinks) {
                try {
                    String chapterTitle = chapter.getText();
                    String href = chapter.getAttribute("href");

                    // Extract numeric chapter number safely
                    String chapterNumber = extractChapterNumber(chapterTitle);
                    Map<String, String> data = new HashMap<>();
                    data.put("chapter_number", chapterNumber.isEmpty() ? String.valueOf(index) : chapterNumber);
                    data.put("chapter_title", chapterTitle);
                    data.put("href", href);
                    chapters.add(data);

                    log.info("📄 Chapter [{}]: {} -> {}", index, chapterTitle, href);
                } catch (Exception inner) {
                    log.warn("⚠️ Failed to parse chapter at index {}: {}", index, inner.getMessage());
                }
                index++;
            }

        } catch (Exception e) {
            log.error("❌ Error scraping chapters: {}", e.getMessage(), e);
        } finally {
            driver.quit();
        }

        return chapters;
    }

    /**
     * Extracts a numeric chapter number from a string.
     *
     * @param text Input text containing chapter info.
     * @return Chapter number as string, or empty if not found.
     */
    private String extractChapterNumber(String text) {
        String cleaned = text.replaceAll("[^0-9.]", "");
        if (cleaned.contains(".")) {
            String[] parts = cleaned.split("\\.");
            return parts[0]; // return integer part
        }
        return cleaned;
    }
}
