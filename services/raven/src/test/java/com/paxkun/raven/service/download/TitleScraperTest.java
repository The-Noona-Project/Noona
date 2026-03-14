/**
 * Covers title scraper behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/LoggerService.java
 * - src/main/java/com/paxkun/raven/service/download/TitleScraper.java
 * Times this file has been edited: 2
 */
package com.paxkun.raven.service.download;

import com.paxkun.raven.service.LoggerService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;

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
}
