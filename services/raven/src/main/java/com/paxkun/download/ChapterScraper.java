package com.paxkun.download;

import org.jetbrains.annotations.NotNull;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.openqa.selenium.support.ui.WebDriverWait;
import org.openqa.selenium.support.ui.ExpectedConditions;
import io.github.bonigarcia.wdm.WebDriverManager;

import java.time.Duration;
import java.util.*;
import java.util.regex.*;

public class ChapterScraper {

    @NotNull
    public static Map<Integer, String> chapterLinks(String url) {
        // Setup WebDriver using WebDriverManager
        WebDriverManager.chromedriver().driverVersion("134.0.6998.178").setup();
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless"); // Run in headless mode (no GUI)
        options.addArguments("--no-sandbox");
        options.addArguments("--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        Map<Integer, String> chapters = new LinkedHashMap<>();

        try {
            // Open the page
            driver.get(url);

            // Wait for chapter links to load
            WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));
            wait.until(ExpectedConditions.presenceOfElementLocated(By.cssSelector("div.flex.items-center a")));

            // Retrieve all chapter links using the specified CSS selector
            List<WebElement> chapterLinks = driver.findElements(By.cssSelector("div.flex.items-center a"));

            // Iterate through chapter links and match chapter numbers using regex
            Pattern pattern = Pattern.compile("Chapter\\s+(\\d+(?:\\.\\d+)?)", Pattern.CASE_INSENSITIVE);
            for (WebElement link : chapterLinks) {
                String href = link.getAttribute("href");

                // Regex match for chapter number in the link text or href
                Matcher matcher = pattern.matcher(link.getText());
                if (matcher.find()) {
                    double chapterNumber = Double.parseDouble(matcher.group(1));
                    chapters.put((int) chapterNumber, href); // Store chapter number and link
                }
            }

        } finally {
            driver.quit(); // Always quit the driver at the end
        }

        return chapters; // Return the map of chapter numbers to URLs
    }

    /*
    public static void main(String[] args) {
        String url = "https://weebcentral.com/series/01J76XY7E9FNDZ1DBBM6PBJPFK/full-chapter-list";
        Map<Integer, String> chapterLinks = chapterLinks(url);

        // Print chapter links
        for (Map.Entry<Integer, String> entry : chapterLinks.entrySet()) {
            System.out.println("Chapter " + entry.getKey() + ": " + entry.getValue());
        }
    }

     */
}

