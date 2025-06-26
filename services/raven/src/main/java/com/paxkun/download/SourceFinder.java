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

    @NotNull
    public static String findSource(String chapterUrl) {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox");

        WebDriver driver = new ChromeDriver(options);
        try {
            driver.get(chapterUrl);
            Thread.sleep(2000); // Optional wait to ensure full page load

            List<WebElement> images = driver.findElements(By.tagName("img"));
            Pattern pattern = Pattern.compile("(https://[^\\s]+/manga/[^/]+/\\d{4}-001\\.png)");

            for (WebElement img : images) {
                String src = img.getAttribute("src");
                assert src != null;
                Matcher matcher = pattern.matcher(src);
                if (matcher.find()) {
                    String fullUrl = matcher.group(1);
                    int index = fullUrl.indexOf("/manga/");
                    if (index != -1) {
                        return fullUrl.substring(0, index + 7);
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            driver.quit();
        }
        return "";
    }
}
