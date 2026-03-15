/**
 * Encapsulates Raven title scraper behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/LoggerService.java
 * - src/test/java/com/paxkun/raven/service/DownloadServiceTest.java
 * - src/test/java/com/paxkun/raven/service/download/TitleScraperTest.java
 * Times this file has been edited: 17
 */
package com.paxkun.raven.service.download;

import com.paxkun.raven.service.LoggerService;
import org.jsoup.Connection;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.net.URI;
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
    private static final String DEFAULT_SOURCE_BASE_URL = "https://weebcentral.com";
    private static final int ADVANCED_SEARCH_PAGE_LIMIT = 32;

    // Selenium support was removed from TitleScraper; older "--headless=new" guidance is stale for this class.

    @Autowired
    private LoggerService logger;

    private List<Map<String, String>> lastSearchResults = new ArrayList<>();
    private String sourceBaseUrl = DEFAULT_SOURCE_BASE_URL;

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
            logger.debug("SCRAPER", "Fetching search results for: " + titleName);
            Document doc = fetchSearchData(Map.of(
                    "text", titleName,
                    "sort", "Best Match",
                    "order", "Ascending",
                    "official", "Any",
                    "anime", "Any",
                    "adult", "Any",
                    "display_mode", "Full Display"
            ));
            List<Map<String, String>> parsedResults = parseSearchResults(doc);
            logger.info("SCRAPER", "Found " + parsedResults.size() + " manga search results for '" + titleName + "'");

            Set<String> seenHrefs = new HashSet<>();
            int index = 1;
            for (Map<String, String> parsed : parsedResults) {
                logger.debug("SCRAPER", "Processing search result iteration " + index + " of " + parsedResults.size());
                String href = parsed.get("href");
                if (href == null || href.isBlank() || !seenHrefs.add(href)) {
                    continue;
                }

                Map<String, String> data = new HashMap<>(parsed);
                data.put("index", String.valueOf(index));
                results.add(data);
                logger.info("SCRAPER", "[" + index + "] " + data.get("title") + " -> " + href);
                index++;
            }

            lastSearchResults = results;

        } catch (Exception e) {
            logger.error("SCRAPER", "❌ Error searching manga: " + e.getMessage(), e);
        }

        return results;
    }

    /**
     * Browses alphabetized titles directly from WeebCentral's advanced-search data endpoint.
     *
     * @param type         The exact included content type.
     * @param adultContent The adult-only browse flag.
     * @return The collected browse result payload.
     */
    public BrowseResult browseTitlesAlphabetically(String type, boolean adultContent) {
        String normalizedType = normalizeMediaType(type);
        if (normalizedType == null) {
            return new BrowseResult(List.of(), 0);
        }

        List<Map<String, String>> collected = new ArrayList<>();
        Set<String> seenHrefs = new HashSet<>();
        int pagesScanned = 0;
        int offset = 0;
        boolean hasMore;

        try {
            do {
                Document doc = fetchSearchData(Map.of(
                        "text", "",
                        "sort", "Alphabet",
                        "order", "Ascending",
                        "official", "Any",
                        "anime", "Any",
                        "adult", adultContent ? "True" : "False",
                        "included_type", normalizedType,
                        "display_mode", "Full Display",
                        "limit", String.valueOf(ADVANCED_SEARCH_PAGE_LIMIT),
                        "offset", String.valueOf(offset)
                ));
                pagesScanned++;

                for (Map<String, String> parsed : parseSearchResults(doc)) {
                    String href = parsed.get("href");
                    if (href == null || href.isBlank() || !seenHrefs.add(href)) {
                        continue;
                    }
                    collected.add(new HashMap<>(parsed));
                }

                hasMore = hasMoreResults(doc);
                offset += ADVANCED_SEARCH_PAGE_LIMIT;
            } while (hasMore);
        } catch (Exception e) {
            logger.error("SCRAPER", "Error browsing titles: " + e.getMessage(), e);
        }

        return new BrowseResult(collected.isEmpty() ? List.of() : List.copyOf(collected), pagesScanned);
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
                String chapterNumber = normalizeChapterNumber(extractChapterNumberFull(chapterTitle));

                Map<String, String> data = new HashMap<>();
                data.put("chapter_number", chapterNumber.isEmpty() ? String.valueOf(index) : chapterNumber);
                data.put("chapter_title", chapterTitle);
                data.put("href", href);
                rawChapters.add(data);
            }

        } catch (Exception e) {
            logger.error("SCRAPER", "❌ Error scraping chapters: " + e.getMessage(), e);
        }

        List<Map<String, String>> chapters = dedupeExactChapters(rawChapters);
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

    private List<Map<String, String>> dedupeExactChapters(List<Map<String, String>> chapters) {
        if (chapters == null || chapters.isEmpty()) {
            return List.of();
        }

        Set<String> seenHrefs = new HashSet<>();
        Set<String> seenFallbacks = new HashSet<>();
        List<Map<String, String>> selected = new ArrayList<>();
        for (Map<String, String> chapter : chapters) {
            if (chapter == null) {
                continue;
            }

            String href = normalizeOptionalString(chapter.get("href"));
            if (href != null) {
                if (!seenHrefs.add(href)) {
                    continue;
                }
                selected.add(chapter);
                continue;
            }

            String chapterNumber = normalizeChapterNumber(chapter.get("chapter_number"));
            String chapterTitle = normalizeOptionalString(chapter.get("chapter_title"));
            String fallbackKey = (chapterNumber == null ? "" : chapterNumber) + "::" + (chapterTitle == null ? "" : chapterTitle);
            if (!seenFallbacks.add(fallbackKey)) {
                continue;
            }
            selected.add(chapter);
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

    private Document fetchSearchData(Map<String, String> queryParameters) throws Exception {
        Connection connection = Jsoup.connect(resolveSearchDataUrl())
                .userAgent(USER_AGENT)
                .timeout(15_000);

        for (Map.Entry<String, String> entry : queryParameters.entrySet()) {
            connection.data(entry.getKey(), entry.getValue());
        }

        return connection.get();
    }

    private String resolveSearchDataUrl() {
        return normalizeBaseUrl(sourceBaseUrl) + "/search/data";
    }

    private String normalizeBaseUrl(String candidate) {
        if (candidate == null || candidate.isBlank()) {
            return DEFAULT_SOURCE_BASE_URL;
        }

        try {
            URI uri = URI.create(candidate.trim());
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null) {
                return DEFAULT_SOURCE_BASE_URL;
            }

            int port = uri.getPort();
            String authority = port > 0 ? host + ":" + port : host;
            return scheme + "://" + authority;
        } catch (Exception ignored) {
            return DEFAULT_SOURCE_BASE_URL;
        }
    }

    private List<Map<String, String>> parseSearchResults(Document doc) {
        if (doc == null) {
            return List.of();
        }

        Elements resultCards = doc.select("article.bg-base-300");
        if (resultCards.isEmpty()) {
            Elements titleAnchors = doc.select("a.line-clamp-1.link.link-hover");
            for (Element anchor : titleAnchors) {
                Element parent = anchor.parent();
                if (parent != null) {
                    resultCards.add(parent);
                }
            }
        }

        List<Map<String, String>> results = new ArrayList<>();
        for (Element card : resultCards) {
            Map<String, String> parsed = parseSearchResultCard(card);
            if (parsed != null && !parsed.isEmpty()) {
                results.add(parsed);
            }
        }

        return results.isEmpty() ? List.of() : List.copyOf(results);
    }

    private Map<String, String> parseSearchResultCard(Element card) {
        if (card == null) {
            return null;
        }

        Element link = card.selectFirst("a[href*=/series/], a[href^=https://weebcentral.com/series/]");
        if (link == null) {
            return null;
        }

        String href = link.absUrl("href");
        if (href == null || href.isBlank()) {
            return null;
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

        Map<String, String> data = new HashMap<>();
        data.put("title", title);
        data.put("href", href);

        Element image = card.selectFirst("img[src]");
        if (image != null) {
            String coverUrl = image.absUrl("src");
            if (coverUrl != null && !coverUrl.isBlank()) {
                data.put("coverUrl", coverUrl);
            }
        }

        String normalizedType = normalizeMediaType(extractMediaTypeFromCard(card));
        if (normalizedType != null) {
            data.put("type", normalizedType);
        }

        return data;
    }

    private String extractMediaTypeFromCard(Element card) {
        Element typeLabel = card.selectFirst("strong:matchesOwn((?i)^Type:?)");
        if (typeLabel != null) {
            Element parent = typeLabel.parent();
            if (parent != null) {
                Element typeValue = parent.selectFirst("span");
                if (typeValue != null) {
                    return typeValue.text();
                }

                String raw = parent.text();
                if (raw != null && !raw.isBlank()) {
                    return raw.replaceFirst("(?i)^Type:?\\s*", "");
                }
            }
        }

        for (Element tooltip : card.select("span.tooltip[data-tip]")) {
            String normalized = normalizeMediaType(tooltip.attr("data-tip"));
            if (normalized != null) {
                return normalized;
            }
        }

        return null;
    }

    private boolean hasMoreResults(Document doc) {
        if (doc == null) {
            return false;
        }

        return doc.selectFirst("button[hx-get*=\"/search/data\"][hx-get*=\"offset=\"]") != null;
    }

    private String normalizeOptionalString(String value) {
        if (value == null) {
            return null;
        }

        String trimmed = value.trim();
        return trimmed.isBlank() ? null : trimmed;
    }

    private String normalizeChapterNumber(String chapterNumber) {
        String normalized = normalizeOptionalString(chapterNumber);
        if (normalized == null) {
            return "";
        }

        try {
            return new BigDecimal(normalized).stripTrailingZeros().toPlainString();
        } catch (NumberFormatException ignored) {
            return normalized;
        }
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
            case "manga", "managa" -> "Manga";
            case "manhwa" -> "Manhwa";
            case "manhua" -> "Manhua";
            case "oel" -> "OEL";
            default -> prettifyLabel(cleaned);
        };
    }

    /**
     * Stores a paginated browse result from WeebCentral's advanced search endpoint.
     *
     * @param titles       The collected titles.
     * @param pagesScanned The number of fetched pages.
     */
    public record BrowseResult(List<Map<String, String>> titles, int pagesScanned) {
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
