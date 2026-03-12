package com.paxkun.raven.service.download;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.paxkun.raven.service.LoggerService;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class TitleScraperSoloLevelingInspectionTest {

    private static final String QUERY = "solo leveling";
    private static final Path OUTPUT_PATH = Path.of(
            "build",
            "test-results",
            "live-scrape",
            "solo-leveling-inspection.json"
    );
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT);

    @Test
    @Tag("live")
    void capturesSoloLevelingFieldsFromLivePages() throws Exception {
        TitleScraper scraper = new TitleScraper();
        ReflectionTestUtils.setField(scraper, "logger", mock(LoggerService.class));

        List<Map<String, String>> searchResults = scraper.searchManga(QUERY);
        assertThat(searchResults)
                .as("Expected live search results for query '%s'", QUERY)
                .isNotEmpty();

        Map<String, String> selectedResult = selectBestMatch(searchResults);
        assertThat(selectedResult)
                .withFailMessage("No Raven search result matched '%s'. Returned titles: %s", QUERY, extractTitles(searchResults))
                .isNotNull();

        String sourceUrl = selectedResult.get("href");
        assertThat(sourceUrl)
                .as("Expected Raven to capture a source URL for the selected Solo Leveling result")
                .isNotBlank();

        TitleDetails titleDetails = scraper.getTitleDetails(sourceUrl);
        assertThat(titleDetails)
                .as("Expected Raven to scrape title details from %s", sourceUrl)
                .isNotNull();

        List<Map<String, String>> chapters = scraper.getChapters(sourceUrl);
        assertThat(chapters)
                .as("Expected Raven to scrape at least one chapter for %s", sourceUrl)
                .isNotEmpty();

        Map<String, Object> report = new LinkedHashMap<>();
        report.put("query", QUERY);
        report.put("capturedAtUtc", Instant.now().toString());
        report.put("searchResultCount", searchResults.size());
        report.put("searchResults", searchResults);
        report.put("selectedResult", selectedResult);
        report.put("titleDetails", toTitleDetailsMap(titleDetails));
        report.put("chapterCount", chapters.size());
        report.put("chapters", chapters);

        Files.createDirectories(OUTPUT_PATH.getParent());
        OBJECT_MAPPER.writeValue(OUTPUT_PATH.toFile(), report);

        System.out.println("Solo Leveling scrape inspection report: " + OUTPUT_PATH.toAbsolutePath());
        System.out.println(OBJECT_MAPPER.writeValueAsString(report));
    }

    private Map<String, String> selectBestMatch(List<Map<String, String>> searchResults) {
        if (searchResults == null || searchResults.isEmpty()) {
            return null;
        }

        String normalizedQuery = normalize(QUERY);
        for (Map<String, String> result : searchResults) {
            if (normalizedQuery.equals(normalize(result.get("title")))) {
                return result;
            }
        }

        for (Map<String, String> result : searchResults) {
            String normalizedTitle = normalize(result.get("title"));
            if (normalizedTitle.contains(normalizedQuery) || normalizedQuery.contains(normalizedTitle)) {
                return result;
            }
        }

        return searchResults.getFirst();
    }

    private List<String> extractTitles(List<Map<String, String>> searchResults) {
        return searchResults.stream()
                .map(result -> result.getOrDefault("title", ""))
                .toList();
    }

    private String normalize(String value) {
        if (value == null) {
            return "";
        }
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private Map<String, Object> toTitleDetailsMap(TitleDetails details) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("sourceUrl", details.getSourceUrl());
        data.put("summary", details.getSummary());
        data.put("type", details.getType());
        data.put("adultContent", details.getAdultContent());
        data.put("associatedNames", details.getAssociatedNames());
        data.put("status", details.getStatus());
        data.put("released", details.getReleased());
        data.put("officialTranslation", details.getOfficialTranslation());
        data.put("animeAdaptation", details.getAnimeAdaptation());
        data.put("relatedSeries", details.getRelatedSeries());
        return data;
    }
}
