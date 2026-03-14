/**
 * Encapsulates Raven title scraper behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/LoggerService.java
 * - src/test/java/com/paxkun/raven/service/DownloadServiceTest.java
 * - src/test/java/com/paxkun/raven/service/download/TitleScraperTest.java
 * Times this file has been edited: 16
 */
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
 * from weebcentral.com using direct Jsoup HTTP requests.
 * All HTTP fetching in this class goes through Jsoup.connect().
 *
 * Author: Pax
 */
@Component
public class TitleScraper {

    // Selenium support was removed from TitleScraper; older "--headless=new" guidance is stale for this class.

    @Autowired
    private LoggerService logger;

    private List<Map<String, String>> lastSearchResults = new ArrayList<>();

    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

    /**
     * Searches manga.
     *
     * @param titleName The title name to search or resolve.
     * @return The resulting String>>.
     */

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

            Elements resultCards = doc.select("article.bg-base-300");
            if (resultCards.isEmpty()) {
                Elements mangaResults = doc.select("a.line-clamp-1.link.link-hover");
                for (Element manga : mangaResults) {
                    Element parent = manga.parent();
                    if (parent != null) {
                        resultCards.add(parent);
                    }
                }
            }

            logger.info("SCRAPER", "Found " + resultCards.size() + " manga search results for '" + titleName + "'");

            Set<String> seenHrefs = new HashSet<>();
            int index = 1;
            for (Element card : resultCards) {
                logger.debug("SCRAPER", "Processing search result iteration " + index + " of " + resultCards.size());

                Element link = card.selectFirst("a[href^=https://weebcentral.com/series/]");
                if (link == null) {
                    continue;
                }

                String href = link.absUrl("href");
                if (href == null || href.isBlank() || !seenHrefs.add(href)) {
                    continue;
                }

                String title = null;
                Element titleAnchor = card.selectFirst("a.line-clamp-1.link.link-hover");
                if (titleAnchor != null) {
                    title = titleAnchor.text();
                }
                if (title == null || title.isBlank()) {
                    Element mobileTitle = card.selectFirst("div.text-ellipsis");
                    if (mobileTitle != null) {
                        title = mobileTitle.text();
                    }
                }
                if (title == null || title.isBlank()) {
                    title = href;
                }

                String coverUrl = null;
                Element img = card.selectFirst("img[src]");
                if (img != null) {
                    coverUrl = img.absUrl("src");
                }

                String type = null;
                Element typeLabel = card.selectFirst("strong:matchesOwn((?i)^Type:?)");
                if (typeLabel != null) {
                    Element parent = typeLabel.parent();
                    if (parent != null) {
                        Element typeValue = parent.selectFirst("span");
                        if (typeValue != null) {
                            type = typeValue.text();
                        } else {
                            String raw = parent.text();
                            type = raw != null ? raw.replaceFirst("(?i)^Type:?\\s*", "") : null;
                        }
                    }
                }

                if (type == null || type.isBlank()) {
                    for (Element tooltip : card.select("span.tooltip[data-tip]")) {
                        String normalized = normalizeMediaType(tooltip.attr("data-tip"));
                        if (normalized != null) {
                            type = normalized;
                            break;
                        }
                    }
                }

                Map<String, String> data = new HashMap<>();
                data.put("index", String.valueOf(index));
                data.put("title", title);
                data.put("href", href);
                if (coverUrl != null && !coverUrl.isBlank()) {
                    data.put("coverUrl", coverUrl);
                }
                String normalizedType = normalizeMediaType(type);
                if (normalizedType != null) {
                    data.put("type", normalizedType);
                }
                results.add(data);

                logger.info("SCRAPER", "[" + index + "] " + title + " -> " + href);
                index++;
            }

            lastSearchResults = results;

        } catch (Exception e) {
            logger.error("SCRAPER", "❌ Error searching manga: " + e.getMessage(), e);
        }

        return results;
    }

    /**
     * Returns result by index.
     *
     * @param index The index.
     * @return The resulting String>.
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
     * Returns last search results.
     *
     * @return The resulting String>>.
     */

    public List<Map<String, String>> getLastSearchResults() {
        return Collections.unmodifiableList(lastSearchResults);
    }

    /**
     * Returns chapters.
     *
     * @param titleUrl The source title URL.
     * @return The resulting String>>.
     */

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

    /**
     * Returns summary.
     *
     * @param titleUrl The source title URL.
     * @return The resulting message or value.
     */

    public String getSummary(String titleUrl) {
        TitleDetails details = getTitleDetails(titleUrl);
        return details != null ? details.getSummary() : null;
    }

    /**
     * Returns title details.
     *
     * @param titleUrl The source title URL.
     * @return The resulting TitleDetails.
     */

    public TitleDetails getTitleDetails(String titleUrl) {
        if (titleUrl == null || titleUrl.isBlank()) {
            return null;
        }

        try {
            Document doc = Jsoup.connect(titleUrl.trim())
                    .userAgent(USER_AGENT)
                    .timeout(15_000)
                    .get();

            String summary = extractSummary(doc);
            String type = normalizeMediaType(extractLabeledValue(doc, "Type"));
            Boolean adultContent = parseBooleanFlag(extractLabeledValue(doc, "Adult Content"));
            List<String> associatedNames = extractLabeledList(doc, "Associated Name(s)");
            String status = cleanExtractedValue(extractLabeledValue(doc, "Status"));
            String released = cleanExtractedValue(extractLabeledValue(doc, "Released"));
            Boolean officialTranslation = parseBooleanFlag(extractLabeledValue(doc, "Official Translation"));
            Boolean animeAdaptation = parseBooleanFlag(extractLabeledValue(doc, "Anime Adaptation"));
            List<Map<String, String>> relatedSeries = extractRelatedSeries(doc);

            TitleDetails details = new TitleDetails();
            details.setSourceUrl(titleUrl.trim());
            details.setSummary(summary);
            details.setType(type);
            details.setAdultContent(adultContent);
            details.setAssociatedNames(associatedNames);
            details.setStatus(status);
            details.setReleased(released);
            details.setOfficialTranslation(officialTranslation);
            details.setAnimeAdaptation(animeAdaptation);
            details.setRelatedSeries(relatedSeries);
            return details;
        } catch (Exception e) {
            logger.warn("SCRAPER", "âš ï¸ Failed to fetch summary: " + e.getMessage());
            return null;
        }
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

    private String extractSummary(Document doc) {
        if (doc == null) {
            return null;
        }

        Element description = doc.selectFirst("strong:matchesOwn((?i)Description) + p");
        if (description == null) {
            return null;
        }

        String summary = description.text();
        if (summary == null) {
            return null;
        }

        String trimmed = summary.trim();
        return trimmed.isBlank() ? null : trimmed;
    }

    private String extractLabeledValue(Document doc, String label) {
        if (doc == null || label == null || label.isBlank()) {
            return null;
        }

        Element section = findLabeledSection(doc, label);
        if (section == null) {
            return null;
        }

        Element labelElement = section.selectFirst("strong");
        Element sibling = labelElement != null ? labelElement.nextElementSibling() : null;
        while (sibling != null) {
            String siblingText = sibling.text();
            if (siblingText != null && !siblingText.isBlank()) {
                return siblingText.trim();
            }
            sibling = sibling.nextElementSibling();
        }

        String sectionText = section.text();
        if (sectionText == null || sectionText.isBlank()) {
            return null;
        }

        String cleaned = sectionText
                .replaceFirst("(?i)^\\s*" + Pattern.quote(label) + "\\s*:?\\s*", "")
                .trim();
        if (!cleaned.isBlank()) {
            return cleaned;
        }

        return null;
    }

    private List<String> extractLabeledList(Document doc, String label) {
        Element section = findLabeledSection(doc, label);
        if (section == null) {
            return List.of();
        }

        Elements items = section.select("> ul > li");
        if (items.isEmpty()) {
            items = section.select("ul > li");
        }

        List<String> values = new ArrayList<>();
        for (Element item : items) {
            String text = cleanExtractedValue(item.text());
            if (text != null && !text.isBlank()) {
                values.add(text);
            }
        }
        return values.isEmpty() ? List.of() : List.copyOf(values);
    }

    private List<Map<String, String>> extractRelatedSeries(Document doc) {
        Element section = findLabeledSection(doc, "Related Series(s)");
        if (section == null) {
            return List.of();
        }

        Elements items = section.select("> ul > li");
        if (items.isEmpty()) {
            items = section.select("ul > li");
        }

        List<Map<String, String>> values = new ArrayList<>();
        for (Element item : items) {
            Element link = item.selectFirst("a[href]");
            String title = cleanExtractedValue(link != null ? link.text() : item.ownText());
            String sourceUrl = link != null ? cleanExtractedValue(link.absUrl("href")) : null;
            String relation = null;

            Element relationElement = item.selectFirst("span");
            if (relationElement != null) {
                relation = cleanRelationValue(relationElement.text());
            } else if (title != null && !title.isBlank()) {
                relation = cleanRelationValue(item.text().replaceFirst("^" + Pattern.quote(title) + "\\s*", ""));
            }

            Map<String, String> entry = new LinkedHashMap<>();
            if (title != null && !title.isBlank()) {
                entry.put("title", title);
            }
            if (sourceUrl != null && !sourceUrl.isBlank()) {
                entry.put("sourceUrl", sourceUrl);
            }
            if (relation != null && !relation.isBlank()) {
                entry.put("relation", relation);
            }
            if (!entry.isEmpty()) {
                values.add(entry);
            }
        }

        return values.isEmpty() ? List.of() : List.copyOf(values);
    }

    private Element findLabeledSection(Document doc, String label) {
        if (doc == null || label == null || label.isBlank()) {
            return null;
        }

        String normalizedTarget = normalizeLabelText(label);
        for (Element strong : doc.select("strong")) {
            String ownText = strong.ownText();
            if (ownText == null || ownText.isBlank()) {
                continue;
            }
            if (!normalizedTarget.equals(normalizeLabelText(ownText))) {
                continue;
            }

            Element parent = strong.parent();
            if (parent != null) {
                return parent;
            }
        }

        return null;
    }

    private String normalizeLabelText(String value) {
        if (value == null) {
            return "";
        }
        return value.replace(":", "").trim().toLowerCase(Locale.ROOT);
    }

    private String cleanExtractedValue(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isBlank() ? null : trimmed;
    }

    private String cleanRelationValue(String value) {
        String cleaned = cleanExtractedValue(value);
        if (cleaned == null) {
            return null;
        }
        return cleaned
                .replaceFirst("^[\\(\\[]\\s*", "")
                .replaceFirst("\\s*[\\)\\]]$", "")
                .trim();
    }

    private Boolean parseBooleanFlag(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }

        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "yes", "true", "1", "adult", "explicit", "nsfw" -> true;
            case "no", "false", "0", "safe", "clean" -> false;
            default -> null;
        };
    }

    private String normalizeMediaType(String raw) {
        if (raw == null) {
            return null;
        }

        String trimmed = raw.trim();
        if (trimmed.isBlank()) {
            return null;
        }

        String cleaned = trimmed.replaceFirst("(?i)^Type:?\\s*", "").replaceAll("\\s+", " ").trim();
        if (cleaned.isBlank()) {
            return null;
        }

        String lower = cleaned.toLowerCase(Locale.ROOT);
        return switch (lower) {
            case "manga" -> "Manga";
            case "manhwa" -> "Manhwa";
            case "manhua" -> "Manhua";
            default -> prettifyLabel(cleaned);
        };
    }

    private String prettifyLabel(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isBlank()) return null;

        boolean hasUpper = false;
        boolean hasLower = false;
        for (int i = 0; i < trimmed.length(); i++) {
            char ch = trimmed.charAt(i);
            if (!Character.isLetter(ch)) continue;
            if (Character.isUpperCase(ch)) hasUpper = true;
            if (Character.isLowerCase(ch)) hasLower = true;
        }

        // Preserve already mixed-case labels (ex: "Light Novel").
        if (hasUpper && hasLower) {
            return trimmed;
        }

        String[] parts = trimmed.toLowerCase(Locale.ROOT).split("\\s+");
        StringBuilder out = new StringBuilder();
        for (String part : parts) {
            if (part.isBlank()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(Character.toUpperCase(part.charAt(0)));
            if (part.length() > 1) {
                out.append(part.substring(1));
            }
        }

        String result = out.toString().trim();
        return result.isBlank() ? trimmed : result;
    }
}
