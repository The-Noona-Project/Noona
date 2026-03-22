/**
 * Covers title scraper behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/LoggerService.java
 * - src/main/java/com/paxkun/raven/service/download/TitleScraper.java
 * Times this file has been edited: 3
 */
package com.paxkun.raven.service.download;

import com.paxkun.raven.service.LoggerService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * Covers title scraper behavior.
 */

class TitleScraperTest {

    private HttpServer server;

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
    }

    @Test
    void getTitleDetailsReadsAdultContentFromSourceTitlePage() throws Exception {
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/series/test-title", exchange -> {
            byte[] payload = """
                    <html>
                    <body>
                      <div>
                        <strong>Description</strong>
                        <p>Zalem is an adventurer who decided to throw in the towel.</p>
                      </div>
                      <div>
                        <strong>Associated Name(s)</strong>
                        <ul>
                          <li>Only I level up</li>
                          <li>Na Honjaman Lebel-eob</li>
                        </ul>
                      </div>
                      <div><strong>Status:</strong> <span>Complete</span></div>
                      <div><strong>Released:</strong> <span>2018</span></div>
                      <div><strong>Official Translation:</strong> <a href="/search?official=True">Yes</a></div>
                      <div><strong>Anime Adaptation:</strong> <a href="/search?anime=True">Yes</a></div>
                      <div><strong>Type:</strong> <span>Manga</span></div>
                      <div><strong>Adult Content:</strong> <a href="/tags/adult-content">Yes</a></div>
                      <div>
                        <strong>Related Series(s)</strong>
                        <ul>
                          <li>
                            <a href="/series/volume-version">Solo Leveling (Volume)</a>
                            <span>(Alternate Story)</span>
                          </li>
                          <li>
                            <a href="https://related.example/ragnarok">Solo Leveling: Ragnarok</a>
                            <span>(Sequel)</span>
                          </li>
                        </ul>
                      </div>
                    </body>
                    </html>
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/html; charset=utf-8");
            exchange.sendResponseHeaders(200, payload.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(payload);
            }
        });
        server.start();

        TitleScraper scraper = new TitleScraper();
        ReflectionTestUtils.setField(scraper, "logger", mock(LoggerService.class));

        TitleDetails details = scraper.getTitleDetails("http://127.0.0.1:" + server.getAddress().getPort() + "/series/test-title");

        assertThat(details).isNotNull();
        assertThat(details.getSummary()).isEqualTo("Zalem is an adventurer who decided to throw in the towel.");
        assertThat(details.getType()).isEqualTo("Manga");
        assertThat(details.getAdultContent()).isTrue();
        assertThat(details.getAssociatedNames()).containsExactly("Only I level up", "Na Honjaman Lebel-eob");
        assertThat(details.getStatus()).isEqualTo("Complete");
        assertThat(details.getReleased()).isEqualTo("2018");
        assertThat(details.getOfficialTranslation()).isTrue();
        assertThat(details.getAnimeAdaptation()).isTrue();
        assertThat(details.getRelatedSeries())
                .containsExactly(
                        Map.of(
                                "title", "Solo Leveling (Volume)",
                                "sourceUrl", "http://127.0.0.1:" + server.getAddress().getPort() + "/series/volume-version",
                                "relation", "Alternate Story"
                        ),
                        Map.of(
                                "title", "Solo Leveling: Ragnarok",
                                "sourceUrl", "https://related.example/ragnarok",
                                "relation", "Sequel"
                        )
                );
    }

    @Test
    void getTitleDetailsReturnsFalseWhenAdultContentIsNo() throws Exception {
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/series/safe-title", exchange -> {
            byte[] payload = """
                    <html>
                    <body>
                      <div><strong>Adult Content:</strong> <span>No</span></div>
                    </body>
                    </html>
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/html; charset=utf-8");
            exchange.sendResponseHeaders(200, payload.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(payload);
            }
        });
        server.start();

        TitleScraper scraper = new TitleScraper();
        ReflectionTestUtils.setField(scraper, "logger", mock(LoggerService.class));

        TitleDetails details = scraper.getTitleDetails("http://127.0.0.1:" + server.getAddress().getPort() + "/series/safe-title");

        assertThat(details).isNotNull();
        assertThat(details.getAdultContent()).isFalse();
    }

    @Test
    void browseTitlesAlphabeticallyForwardsFiltersAndFollowsPagination() throws Exception {
        AtomicInteger requestCount = new AtomicInteger();
        List<String> queries = new CopyOnWriteArrayList<>();
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/search/data", exchange -> {
            String query = exchange.getRequestURI().getRawQuery();
            queries.add(query == null ? "" : query);
            int requestIndex = requestCount.incrementAndGet();
            String payload = requestIndex == 1
                    ? """
                    <html>
                    <body>
                      <article class="bg-base-300">
                        <a class="line-clamp-1 link link-hover" href="/series/ano">"Ano and the Signal"</a>
                        <img src="/covers/ano.jpg"/>
                        <div><strong>Type:</strong> <span>Manga</span></div>
                      </article>
                      <article class="bg-base-300">
                        <a class="line-clamp-1 link link-hover" href="/series/beta">Beta Squad</a>
                        <div><strong>Type:</strong> <span>Manga</span></div>
                      </article>
                      <button hx-get="/search/data?offset=32">View More Results...</button>
                    </body>
                    </html>
                    """
                    : """
                    <html>
                    <body>
                      <article class="bg-base-300">
                        <a class="line-clamp-1 link link-hover" href="/series/another">Another Dawn</a>
                        <div><strong>Type:</strong> <span>Manga</span></div>
                      </article>
                    </body>
                    </html>
                    """;
            byte[] body = payload.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/html; charset=utf-8");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        server.start();

        TitleScraper scraper = new TitleScraper();
        ReflectionTestUtils.setField(scraper, "logger", mock(LoggerService.class));
        ReflectionTestUtils.setField(scraper, "sourceBaseUrl", "http://127.0.0.1:" + server.getAddress().getPort());

        TitleScraper.BrowseResult result = scraper.browseTitlesAlphabetically("Manga", false, null);

        assertThat(result.pagesScanned()).isEqualTo(2);
        assertThat(result.titles()).hasSize(3);
        assertThat(result.titles().getFirst())
                .containsEntry("title", "\"Ano and the Signal\"")
                .containsEntry("type", "Manga")
                .containsEntry("href", "http://127.0.0.1:" + server.getAddress().getPort() + "/series/ano");
        assertThat(queryParam(queries.get(0), "sort")).isEqualTo("Alphabet");
        assertThat(queryParam(queries.get(0), "adult")).isEqualTo("False");
        assertThat(queryParam(queries.get(0), "included_type")).isEqualTo("Manga");
        assertThat(queryParam(queries.get(0), "limit")).isEqualTo("32");
        assertThat(queryParam(queries.get(0), "offset")).isEqualTo("0");
        assertThat(queryParam(queries.get(1), "offset")).isEqualTo("32");
    }

    @Test
    @SuppressWarnings("unchecked")
    void dedupeExactChaptersKeepsFractionalChaptersDistinctAndNormalizesTrivialDecimals() {
        TitleScraper scraper = new TitleScraper();
        ReflectionTestUtils.setField(scraper, "logger", mock(LoggerService.class));

        List<Map<String, String>> chapters = List.of(
                Map.of(
                        "chapter_number", "101",
                        "chapter_title", "Chapter 101",
                        "href", "https://weebcentral.com/chapters/101"
                ),
                Map.of(
                        "chapter_number", "101.1",
                        "chapter_title", "Chapter 101.1",
                        "href", "https://weebcentral.com/chapters/101-1"
                ),
                Map.of(
                        "chapter_number", "101.1",
                        "chapter_title", "Chapter 101.1",
                        "href", "https://weebcentral.com/chapters/101-1"
                ),
                Map.of(
                        "chapter_number", "101.5",
                        "chapter_title", "Chapter 101.5 Special"
                ),
                Map.of(
                        "chapter_number", "101.5",
                        "chapter_title", "Chapter 101.5 Special"
                )
        );

        List<Map<String, String>> deduped = ReflectionTestUtils.invokeMethod(scraper, "dedupeExactChapters", chapters);
        String normalizedWhole = ReflectionTestUtils.invokeMethod(scraper, "normalizeChapterNumber", "101.0");

        assertThat(normalizedWhole).isEqualTo("101");
        assertThat(deduped)
                .extracting(entry -> entry.get("chapter_number"))
                .containsExactly("101", "101.1", "101.5");
    }

    private String queryParam(String rawQuery, String key) {
        if (rawQuery == null || rawQuery.isBlank()) {
            return null;
        }

        for (String entry : rawQuery.split("&")) {
            int separator = entry.indexOf('=');
            String rawKey = separator >= 0 ? entry.substring(0, separator) : entry;
            String rawValue = separator >= 0 ? entry.substring(separator + 1) : "";
            String decodedKey = URLDecoder.decode(rawKey, StandardCharsets.UTF_8);
            if (!key.equals(decodedKey)) {
                continue;
            }
            return URLDecoder.decode(rawValue, StandardCharsets.UTF_8);
        }

        return null;
    }
}
