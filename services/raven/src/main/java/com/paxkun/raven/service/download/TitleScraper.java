package com.paxkun.raven.service.download;

import com.paxkun.raven.service.LoggerService;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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

    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    public List<Map<String, String>> searchManga(String titleName) {
        List<Map<String, String>> results = new ArrayList<>();

        try {
            String encodedTitle = URLEncoder.encode(titleName, StandardCharsets.UTF_8);
            // WeebCentral's search UI loads results via htmx from /search/data; hit it directly to avoid JS timing.
            String searchUrl = "https://weebcentral.com/search/data?text=" + encodedTitle +
                    "&sort=Best+Match&order=Ascending&official=Any&anime=Any&adult=Any&display_mode=Full+Display";
            logger.debug("SCRAPER", "Fetching search results from: " + searchUrl);

            Document doc = Jsoup.connect(searchUrl)
                    .userAgent(USER_AGENT)
                    .timeout(15_000)
                    .get();
            Elements mangaResults = doc.select("a.line-clamp-1.link.link-hover");

            logger.info("SCRAPER", "Found " + mangaResults.size() + " manga search results for '" + titleName + "'");

            Set<String> seenHrefs = new HashSet<>();
            int index = 1;
            for (Element manga : mangaResults) {
                logger.debug("SCRAPER", "Processing search result iteration " + index + " of " + mangaResults.size());
                String href = manga.absUrl("href");
                if (href == null || href.isBlank() || !seenHrefs.add(href)) {
                    continue;
                }
                Map<String, String> data = new HashMap<>();
                data.put("index", String.valueOf(index));
                data.put("title", manga.text());
                data.put("href", href);
                results.add(data);

                logger.info("SCRAPER", "[" + index + "] " + manga.text() + " -> " + href);
                index++;
            }

            lastSearchResults = results;

        } catch (Exception e) {
            logger.error("SCRAPER", "❌ Error searching manga: " + e.getMessage(), e);
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
        List<Map<String, String>> rawChapters = new ArrayList<>();

        try {
            String listUrl = resolveFullChapterListUrl(titleUrl);
            if (listUrl == null || listUrl.isBlank()) {
                logger.warn("SCRAPER", "⚠️ Unable to resolve full chapter list URL for: " + titleUrl);
                return List.of();
            }

            logger.debug("SCRAPER", "Fetching full chapter list from: " + listUrl);
            Document doc = Jsoup.connect(listUrl)
                    .userAgent(USER_AGENT)
                    .timeout(15_000)
                    .get();

            Elements chapterLinks = doc.select("a[href^=https://weebcentral.com/chapters/]");
            logger.info("SCRAPER", "Found " + chapterLinks.size() + " chapter links for URL: " + titleUrl);

            for (int index = 0; index < chapterLinks.size(); index++) {
                Element chapter = chapterLinks.get(index);
                String chapterTitle = chapter.text();
                String href = chapter.absUrl("href");
                String chapterNumber = extractChapterNumberFull(chapterTitle);

                Map<String, String> data = new HashMap<>();
                data.put("chapter_number", chapterNumber.isEmpty() ? String.valueOf(index) : chapterNumber);
                data.put("chapter_title", chapterTitle);
                data.put("href", href);
                rawChapters.add(data);
            }

        } catch (Exception e) {
            logger.error("SCRAPER", "❌ Error scraping chapters: " + e.getMessage(), e);
        }

        List<Map<String, String>> chapters = preferWholeChapters(rawChapters);
        logger.debug("SCRAPER", "Completed chapter scrape for URL: " + titleUrl + ". Total chapters collected: " + chapters.size());
        return chapters;
    }

    private String resolveFullChapterListUrl(String titleUrl) {
        if (titleUrl == null || titleUrl.isBlank()) {
            return null;
        }

        try {
            URI uri = URI.create(titleUrl.trim());
            String[] parts = uri.getPath().split("/");
            String seriesId = null;
            for (int i = 0; i < parts.length; i++) {
                if ("series".equals(parts[i]) && i + 1 < parts.length) {
                    seriesId = parts[i + 1];
                    break;
                }
            }
            if (seriesId == null || seriesId.isBlank()) {
                return null;
            }

            String scheme = uri.getScheme() != null ? uri.getScheme() : "https";
            String host = uri.getHost() != null ? uri.getHost() : "weebcentral.com";
            return scheme + "://" + host + "/series/" + seriesId + "/full-chapter-list";
        } catch (Exception e) {
            return null;
        }
    }

    private List<Map<String, String>> preferWholeChapters(List<Map<String, String>> chapters) {
        if (chapters == null || chapters.isEmpty()) {
            return List.of();
        }

        // WeebCentral sometimes includes special fractional chapters (ex: 11.5). Prefer the whole-number chapter when both exist.
        Map<String, Map<String, String>> selectedByKey = new HashMap<>();
        List<String> keyOrder = new ArrayList<>();

        int fallback = 0;
        for (Map<String, String> chapter : chapters) {
            if (chapter == null) {
                continue;
            }

            String number = chapter.getOrDefault("chapter_number", "");
            String key = "";
            if (number != null && !number.isBlank()) {
                int dot = number.indexOf('.');
                key = dot >= 0 ? number.substring(0, dot) : number;
            }
            if (key == null || key.isBlank()) {
                key = "unknown-" + fallback;
                fallback++;
            }

            Map<String, String> existing = selectedByKey.get(key);
            if (existing == null) {
                selectedByKey.put(key, chapter);
                keyOrder.add(key);
                continue;
            }

            String existingNumber = existing.getOrDefault("chapter_number", "");
            boolean existingWhole = existingNumber != null && !existingNumber.contains(".");
            boolean nextWhole = number != null && !number.contains(".");
            if (!existingWhole && nextWhole) {
                selectedByKey.put(key, chapter);
            }
        }

        List<Map<String, String>> selected = new ArrayList<>(keyOrder.size());
        for (String key : keyOrder) {
            Map<String, String> chapter = selectedByKey.get(key);
            if (chapter != null) {
                selected.add(chapter);
            }
        }
        return selected;
    }

    private String extractChapterNumberFull(String text) {
        if (text == null || text.isBlank()) {
            return "";
        }

        Matcher m = Pattern.compile("Chapter\\s*(\\d+(\\.\\d+)?)", Pattern.CASE_INSENSITIVE).matcher(text);
        if (m.find()) {
            return m.group(1);
        }

        m = Pattern.compile("(\\d+(\\.\\d+)?)").matcher(text);
        if (m.find()) {
            return m.group(1);
        }

        return "";
    }
}
