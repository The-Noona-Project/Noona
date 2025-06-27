package com.paxkun.download;

import org.jetbrains.annotations.NotNull;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MangaScraper {

    public static void main(String[] args) {
        // For testing
        searchManga();
    }

    @NotNull
    public static Map<String, String> searchManga() {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage");

        Map<String, String> data = new HashMap<>();
        Scanner scanner = new Scanner(System.in);

        WebDriver driver = new ChromeDriver(options);
        try {
            System.out.print("Enter manga: ");
            String userManga = scanner.nextLine().trim();
            String encodedManga = URLEncoder.encode(userManga, StandardCharsets.UTF_8);
            String searchUrl = "https://weebcentral.com/search/?text=" + encodedManga + "&sort=Best+Match&order=Ascending&official=Any&anime=Any&adult=Any&display_mode=Full+Display";

            driver.get(searchUrl);
            Thread.sleep(2000); // Wait for page to load fully

            Document doc = Jsoup.parse(driver.getPageSource());
            Elements mangaResults = doc.select("a.link.link-hover, a.line-clamp-1.link.link-hover");

            if (mangaResults.isEmpty()) {
                System.out.println("Manga not found, please try a different search.");
                return data;
            }

            // Display manga results
            for (int i = 0; i < mangaResults.size(); i++) {
                Element manga = mangaResults.get(i);
                System.out.println((i + 1) + ". " + manga.text());
            }

            // Ask user to select manga
            System.out.print("Select a manga from the given list: ");
            int selectedMangaIndex = -1;
            if (scanner.hasNextInt()) {
                selectedMangaIndex = scanner.nextInt() - 1;
                scanner.nextLine(); // Consume newline
            }

            if (selectedMangaIndex >= 0 && selectedMangaIndex < mangaResults.size()) {
                Element selectedManga = mangaResults.get(selectedMangaIndex);
                System.out.println("You have selected: " + selectedManga.text());

                System.out.print("Would you like to add this manga to your library? Y/N: ");
                String answer = scanner.nextLine().trim();

                if ("Y".equalsIgnoreCase(answer)) {
                    data.put("href", selectedManga.absUrl("href"));
                    data.put("title", selectedManga.text());
                }
            } else {
                System.out.println("Invalid index, please choose a correct one.");
            }

        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt(); // Restore interrupt status
            System.err.println("Interrupted during manga search: " + ie.getMessage());
        } catch (Exception e) {
            System.err.println("Error searching manga: " + e.getMessage());
            e.printStackTrace();
        } finally {
            driver.quit();
        }

        return data;
    }

    @NotNull
    @Deprecated
    public static Map<Integer, String> chapterLinks(String rss) {
        Map<Integer, String> chapters = new LinkedHashMap<>();
        try {
            Document doc = Jsoup.connect(rss).get();
            Elements items = doc.select("item");

            Pattern pattern = Pattern.compile("Chapter\\s+(\\d+(?:\\.\\d+)?)", Pattern.CASE_INSENSITIVE);

            for (Element item : items) {
                String title = Objects.requireNonNull(item.selectFirst("title")).text();
                String link = Objects.requireNonNull(item.selectFirst("link")).text();

                Matcher matcher = pattern.matcher(title);
                if (matcher.find()) {
                    double chapterNumber = Double.parseDouble(matcher.group(1));
                    chapters.put((int) chapterNumber, link); // round down decimals if needed
                }
            }

            // Reverse the order of the map
            Map<Integer, String> reversed = new LinkedHashMap<>();
            List<Map.Entry<Integer, String>> entryList = new ArrayList<>(chapters.entrySet());
            Collections.reverse(entryList);
            for (Map.Entry<Integer, String> entry : entryList) {
                reversed.put(entry.getKey(), entry.getValue());
            }
            return reversed;

        } catch (Exception e) {
            System.err.println("Error fetching chapters: " + e.getMessage());
            e.printStackTrace();
            return chapters;
        }
    }
}
