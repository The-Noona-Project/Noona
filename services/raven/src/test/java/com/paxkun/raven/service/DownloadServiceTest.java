package com.paxkun.raven.service;

import com.paxkun.raven.service.download.DownloadProgress;
import com.paxkun.raven.service.download.SearchTitle;
import com.paxkun.raven.service.download.SourceFinder;
import com.paxkun.raven.service.download.TitleScraper;
import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DownloadServiceTest {

    @Mock
    private TitleScraper titleScraper;

    @Mock
    private SourceFinder sourceFinder;

    @Mock
    private LoggerService loggerService;

    @Mock
    private LibraryService libraryService;

    @InjectMocks
    private TestableDownloadService downloadService;

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
        lenient().when(libraryService.resolveOrCreateTitle(eq("Solo Leveling"), eq("http://example.com/solo")))
                .thenReturn(new NewTitle("Solo Leveling", "uuid", "http://example.com/solo", "0"));

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

    @Test
    void downloadProgressIsTrackedAndLibraryUpdated() throws Exception {
        Map<String, String> title = new HashMap<>();
        title.put("title", "Solo Leveling");
        title.put("href", "http://example.com/solo");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(title)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        List<Map<String, String>> chapters = List.of(
                Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1"),
                Map.of("chapter_title", "Chapter 2", "href", "http://example.com/solo/2")
        );
        when(titleScraper.getChapters("http://example.com/solo")).thenReturn(chapters);
        when(sourceFinder.findSource(anyString())).thenReturn(List.of("http://example.com/solo/page1.jpg"));
        NewTitle resolvedTitle = new NewTitle("Solo Leveling", "uuid", "http://example.com/solo", "0");
        when(libraryService.resolveOrCreateTitle("Solo Leveling", "http://example.com/solo"))
                .thenReturn(resolvedTitle);

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        downloadService.queueDownloadAllChapters(searchTitle.getSearchId(), 1);

        waitForStatus("Solo Leveling", "completed");

        List<DownloadProgress> statuses = downloadService.getDownloadStatuses();
        assertThat(statuses)
                .anySatisfy(progress -> {
                    assertThat(progress.getTitle()).isEqualTo("Solo Leveling");
                    assertThat(progress.getTotalChapters()).isEqualTo(2);
                    assertThat(progress.getCompletedChapters()).isEqualTo(2);
                    assertThat(progress.getStatus()).isEqualTo("completed");
                });

        ArgumentCaptor<NewTitle> titleCaptor = ArgumentCaptor.forClass(NewTitle.class);
        ArgumentCaptor<NewChapter> chapterCaptor = ArgumentCaptor.forClass(NewChapter.class);
        verify(libraryService, timeout(2000).times(2))
                .addOrUpdateTitle(titleCaptor.capture(), chapterCaptor.capture());
        assertThat(chapterCaptor.getAllValues())
                .extracting(NewChapter::getChapter)
                .containsExactlyInAnyOrder("1", "2");
        assertThat(titleCaptor.getAllValues())
                .allSatisfy(capturedTitle -> assertThat(capturedTitle.getTitleName()).isEqualTo("Solo Leveling"));
        assertThat(resolvedTitle.getLastDownloaded()).isEqualTo("2");
    }

    private void waitForStatus(String titleName, String expectedStatus) throws InterruptedException {
        for (int attempt = 0; attempt < 50; attempt++) {
            List<DownloadProgress> statuses = downloadService.getDownloadStatuses();
            boolean match = statuses.stream()
                    .anyMatch(progress -> titleName.equals(progress.getTitle())
                            && expectedStatus.equals(progress.getStatus()));
            if (match) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Timed out waiting for status=" + expectedStatus + " for title=" + titleName);
    }

    static class TestableDownloadService extends DownloadService {
        @Override
        protected int saveImagesToFolder(List<String> urls, Path folder) {
            try {
                Files.createDirectories(folder);
            } catch (IOException ignored) {
            }
            return urls.size();
        }

        @Override
        protected void zipFolderAsCbz(Path folder, Path cbzPath) {
            try {
                Path parent = cbzPath.getParent();
                if (parent != null) {
                    Files.createDirectories(parent);
                }
                Files.deleteIfExists(cbzPath);
                Files.createFile(cbzPath);
            } catch (IOException ignored) {
            }
        }

        @Override
        protected void deleteFolder(Path folderPath) {
            // Skip deletion to simplify testing
        }
    }
}
