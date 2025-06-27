package com.paxkun.download;

import io.github.bonigarcia.wdm.WebDriverManager;
import org.jetbrains.annotations.NotNull;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;


public class ChapterScraper {

    /**
     * Retrieves chapter links from the specified URL.
     *
     * @param url The URL containing chapter listings.
     * @return Map of chapter numbers to their URLs.
     */
    @NotNull
    public static Map<Integer, String> chapterLinks(String url) {
        // Setup WebDriver using WebDriverManager
        WebDriverManager.chromedriver().setup();

        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new"); // Use new headless mode for stability
        options.addArguments("--no-sandbox");
        options.addArguments("--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        Map<Integer, String> chapters = new LinkedHashMap<>();

        try {
            driver.get(url);

            // Wait for chapter links to load
            WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));
            wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector("div.flex.items-center a")));

            List<WebElement> chapterLinks = driver.findElements(By.cssSelector("div.flex.items-center a"));

            Pattern pattern = Pattern.compile("Chapter\\s+(\\d+(?:\\.\\d+)?)", Pattern.CASE_INSENSITIVE);
            for (WebElement link : chapterLinks) {
                String href = link.getAttribute("href");
                if (href == null || href.isEmpty()) continue;

                Matcher matcher = pattern.matcher(link.getText());
                if (matcher.find()) {
                    double chapterNumber = Double.parseDouble(matcher.group(1));
                    chapters.put((int) chapterNumber, href);
                } else {
                    System.err.println("No chapter number found in: " + link.getText());
                }
            }

        } catch (Exception e) {
            System.err.println("Error scraping chapters from URL: " + url);
            e.printStackTrace();
        } finally {
            driver.quit();
        }

        if (chapters.isEmpty()) {
            System.out.println("No chapters found at: " + url);
        } else {
            System.out.println("Found " + chapters.size() + " chapters at: " + url);
        }

        return chapters;
    }

    /*
    public static void main(String[] args) {
        String url = "https://weebcentral.com/series/01J76XY7E9FNDZ1DBBM6PBJPFK/full-chapter-list";
        Map<Integer, String> chapterLinks = chapterLinks(url);

        for (Map.Entry<Integer, String> entry : chapterLinks.entrySet()) {
            System.out.println("Chapter " + entry.getKey() + ": " + entry.getValue());
        }
    }
    */
}
