package com.paxkun.download;

import org.jetbrains.annotations.NotNull;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;

import java.io.IOException;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MangaScraper {

    public static void main(String[] args) {
        //searchManga();
    }

    @NotNull
    public static Map<String, String> searchManga() {

        ChromeOptions options = new ChromeOptions();
        options.addArguments("--headless=new"); // Use "--headless=new" for Chrome 109+
        options.addArguments("--disable-gpu"); // Optional but recommended on Windows
        options.addArguments("--no-sandbox");  // Useful for some Linux environments
        options.addArguments("--disable-dev-shm-usage"); // Avoids memory issues
        WebDriver driver = new ChromeDriver(options);

        Scanner scanner = new Scanner(System.in);
        System.out.print("Enter manga: ");
        String userManga = scanner.nextLine();
        String encodedManga = java.net.URLEncoder.encode(userManga, java.nio.charset.StandardCharsets.UTF_8);
        String searchUrl = "https://weebcentral.com/search/?text=" + encodedManga + "&sort=Best+Match&order=Ascending&official=Any&anime=Any&adult=Any&display_mode=Full+Display";

        driver.get(searchUrl);

        try {
            Thread.sleep(2000); // Wait for the page to load
        } catch (InterruptedException e) {
            e.printStackTrace();
        }

        Document doc = Jsoup.parse(Objects.requireNonNull(driver.getPageSource()));
        Elements mangaResults = doc.select("a.link.link-hover, a.line-clamp-1.link.link-hover");

        if (mangaResults.isEmpty()) {
            System.out.println("Manga not found, please try a different search.");
            return new HashMap<>();
        }

        // Display manga results
        for (int i = 0; i < mangaResults.size(); i++) {
            Element manga = mangaResults.get(i);
            System.out.println((i + 1) + ". " + manga.text());
        }

        // Ask user to select manga
        System.out.print("Select a manga from the given list: ");
        int selectedMangaIndex = scanner.nextInt() - 1;

        if (selectedMangaIndex >= 0 && selectedMangaIndex < mangaResults.size()) {
            Element selectedManga = mangaResults.get(selectedMangaIndex);
            System.out.println("You have selected: " + selectedManga.text());

            System.out.print("Would you like to add this manga to your library? Y/N: ");
            scanner.nextLine(); // Consume newline
            String answer = scanner.nextLine();

            if ("Y".equalsIgnoreCase(answer)) {
                Map<String, String> data = new HashMap<>();
                data.put("href", selectedManga.absUrl("href"));
                data.put("title", selectedManga.text());
                return data;
            }
        } else {
            System.out.println("Invalid index, please choose a correct one.");
        }
        return new HashMap<>();
    }

    @NotNull
    @Deprecated
    public static Map<Integer, String> chapterLinks(String rss) throws IOException {
        Document doc = Jsoup.connect(rss).get();

        Elements items = doc.select("item");
        Map<Integer, String> chapters = new LinkedHashMap<>();

        Pattern pattern = Pattern.compile("Chapter\\s+(\\d+(?:\\.\\d+)?)", Pattern.CASE_INSENSITIVE);

        for (Element item : items) {
            String title = Objects.requireNonNull(item.selectFirst("title")).text();
            String link = Objects.requireNonNull(item.selectFirst("link")).text();

            Matcher matcher = pattern.matcher(title);
            if (matcher.find()) {
                double chapterNumber = Double.parseDouble(matcher.group(1));
                chapters.put((int) chapterNumber, link); // if you want to round down decimals
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
    }
}

