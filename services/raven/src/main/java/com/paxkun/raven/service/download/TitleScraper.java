package com.paxkun.raven.service.download;

import lombok.extern.slf4j.Slf4j;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.springframework.stereotype.Component;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * TitleScraper handles searching for manga titles and scraping chapter lists
 * from weebcentral.com using Selenium and Jsoup.
 *
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
            Thread.sleep(2000); // Wait for page to load fully

            Document doc = Jsoup.parse(Objects.requireNonNull(driver.getPageSource()));
            Elements mangaResults = doc.select("a.link.link-hover, a.line-clamp-1.link.link-hover");

            int index = 1;
            for (Element manga : mangaResults) {
                Map<String, String> data = new HashMap<>();
                data.put("index", String.valueOf(index));
                data.put("title", manga.text());
                data.put("href", manga.absUrl("href"));
                results.add(data);
                index++;
            }

            lastSearchResults = results;

        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            log.error("Interrupted during manga search: {}", ie.getMessage(), ie);
        } catch (Exception e) {
            log.error("Error searching manga: {}", e.getMessage(), e);
        } finally {
            driver.quit();
        }

        return results;
    }

    /**
     * Retrieves a search result by its 1-based index from the last performed search.
     *
     * @param index The 1-based index of the desired result.
     * @return Map containing "index", "title", and "href" keys.
     */
    public Map<String, String> getResultByIndex(int index) {
        int adjustedIndex = index - 1;
        if (lastSearchResults != null && adjustedIndex >= 0 && adjustedIndex < lastSearchResults.size()) {
            return lastSearchResults.get(adjustedIndex);
        } else {
            throw new IndexOutOfBoundsException("Invalid index for search results: " + index);
        }
    }

    /**
     * Returns the most recent search results.
     *
     * @return List of maps containing search results.
     */
    public List<Map<String, String>> getLastSearchResults() {
        return Collections.unmodifiableList(lastSearchResults);
    }

    /**
     * Retrieves all chapters for a given title page.
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
            Thread.sleep(2000); // Wait for page to load

            Document doc = Jsoup.parse(driver.getPageSource());
            Elements chapterLinks = doc.select("a.text-xs"); // adjust selector if needed

            int index = 0;
            for (Element chapter : chapterLinks) {
                Map<String, String> data = new HashMap<>();
                data.put("chapter_number", String.valueOf(index));
                data.put("chapter_title", chapter.text());
                data.put("href", chapter.absUrl("href"));
                chapters.add(data);
                index++;
            }

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.error("Interrupted during chapter scraping: {}", e.getMessage(), e);
        } catch (Exception e) {
            log.error("Error scraping chapters: {}", e.getMessage(), e);
        } finally {
            driver.quit();
        }

        return chapters;
    }
}
