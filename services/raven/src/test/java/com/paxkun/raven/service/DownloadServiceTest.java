package com.paxkun.raven.service;

import com.paxkun.raven.service.download.SearchTitle;
import com.paxkun.raven.service.download.SourceFinder;
import com.paxkun.raven.service.download.TitleScraper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DownloadServiceTest {

    @Mock
    private TitleScraper titleScraper;

    @Mock
    private SourceFinder sourceFinder;

    @Mock
    private LoggerService loggerService;

    @InjectMocks
    private DownloadService downloadService;

    @TempDir
    Path downloadsRoot;

    @Test
    void queueDownloadAllChaptersReturnsErrorWhenSessionMissing() {
        String response = downloadService.queueDownloadAllChapters("missing", 1);

        assertThat(response).isEqualTo("⚠️ Search session expired or not found. Please search again.");
    }

    @Test
    void queueDownloadAllChaptersClearsSessionAfterUse() {
        Map<String, String> title = new HashMap<>();
        title.put("title", "Solo Leveling");
        title.put("href", "http://example.com/solo");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(title)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1")));
        when(sourceFinder.findSource(anyString())).thenReturn(Collections.emptyList());

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        String searchId = searchTitle.getSearchId();

        String response = downloadService.queueDownloadAllChapters(searchId, 1);
        assertThat(response).isEqualTo("✅ Download queued for: Solo Leveling");

        String secondResponse = downloadService.queueDownloadAllChapters(searchId, 1);
        assertThat(secondResponse).isEqualTo("⚠️ Search session expired or not found. Please search again.");
    }

    @Test
    void queueDownloadAllChaptersReturnsErrorWhenSessionExpired() {
        AtomicLong clock = new AtomicLong(0L);
        downloadService.setCurrentTimeSupplier(clock::get);

        Map<String, String> title = new HashMap<>();
        title.put("title", "Bleach");
        title.put("href", "http://example.com/bleach");

        when(titleScraper.searchManga("bleach"))
                .thenReturn(new ArrayList<>(List.of(title)));

        SearchTitle searchTitle = downloadService.searchTitle("bleach");
        String searchId = searchTitle.getSearchId();

        clock.set(TimeUnit.MINUTES.toMillis(10) + 1);

        String response = downloadService.queueDownloadAllChapters(searchId, 1);

        assertThat(response).isEqualTo("⚠️ Search session expired or not found. Please search again.");
    }
}
