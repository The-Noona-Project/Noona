package com.paxkun.download;

import org.jetbrains.annotations.NotNull;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SourceFinder {

    /**
     * Finds the base source URL for chapter images.
     *
     * @param chapterUrl the URL of the chapter page
     * @return the source URL prefix, or an empty string if not found
     */
    @NotNull
    public static String findSource(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        WebDriver driver = new ChromeDriver(options);
        try {
            driver.get(chapterUrl);
            Thread.sleep(2000); // Ensure page fully loads (adjust if necessary)

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
                        return fullUrl.substring(0, index + 7);
                    }
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt(); // restore interrupt status
            System.err.println("Interrupted while finding source: " + ie.getMessage());
        } catch (Exception e) {
            System.err.println("Error finding source for URL: " + chapterUrl);
            e.printStackTrace();
        } finally {
            driver.quit();
        }
        return "";
    }
}
