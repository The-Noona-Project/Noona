/**
 * Covers download service behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/download/DownloadProgress.java
 * - src/main/java/com/paxkun/raven/service/download/QueueDownloadResult.java
 * - src/main/java/com/paxkun/raven/service/download/SearchTitle.java
 * - src/main/java/com/paxkun/raven/service/download/SourceFinder.java
 * Times this file has been edited: 14
 */
package com.paxkun.raven.service;

import com.paxkun.raven.service.download.DownloadProgress;
import com.paxkun.raven.service.download.QueueDownloadResult;
import com.paxkun.raven.service.download.SearchTitle;
import com.paxkun.raven.service.download.SourceFinder;
import com.paxkun.raven.service.download.TitleScraper;
import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import com.paxkun.raven.service.settings.DownloadNamingSettings;
import com.paxkun.raven.service.settings.DownloadVpnSettings;
import com.paxkun.raven.service.settings.SettingsService;
import com.paxkun.raven.service.vpn.VpnRuntimeStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Covers download service behavior.
 */

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

    @Mock
    private SettingsService settingsService;

    @Mock
    private VaultService vaultService;

    @Mock
    private RavenRuntimeProperties runtimeProperties;

    @Mock
    private VPNServices vpnServices;

    @InjectMocks
    private TestableDownloadService downloadService;

    @TempDir
    Path downloadsRoot;

    @BeforeEach
    void setupDefaults() {
        DownloadNamingSettings naming = new DownloadNamingSettings(
                "downloads.naming",
                "{title}",
                "{title} c{chapter} (v{volume}) [Noona].cbz",
                "{page_padded}{ext}",
                3,
                3,
                2
        );
        DownloadVpnSettings vpnSettings = new DownloadVpnSettings(
                "downloads.vpn",
                "pia",
                false,
                false,
                true,
                30,
                "us_california",
                "",
                ""
        );
        lenient().when(settingsService.getDownloadNamingSettings()).thenReturn(naming);
        lenient().when(settingsService.getDownloadVpnSettings()).thenReturn(vpnSettings);
        lenient().when(runtimeProperties.isWorkerMode()).thenReturn(false);
        lenient().when(runtimeProperties.useProcessWorkers()).thenReturn(false);
        lenient().when(vpnServices.getStatus()).thenReturn(new VpnRuntimeStatus(
                false,
                true,
                false,
                false,
                "pia",
                "us_california",
                30,
                null,
                null,
                null,
                null,
                "idle"
        ));
    }

    @Test
    void queueDownloadAllChaptersReturnsErrorWhenSessionMissing() {
        String response = downloadService.queueDownloadAllChapters("missing", 1);

        assertThat(response).isEqualTo("Search session expired or not found. Please search again.");
    }

    @Test
    void queueDownloadAllChaptersAllowsMultipleSelectionsFromSameSession() throws InterruptedException {
        Map<String, String> soloLeveling = new HashMap<>();
        soloLeveling.put("title", "Solo Leveling");
        soloLeveling.put("href", "http://example.com/solo");

        Map<String, String> trigun = new HashMap<>();
        trigun.put("title", "Trigun");
        trigun.put("href", "http://example.com/trigun");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(soloLeveling, trigun)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1")));
        when(titleScraper.getChapters("http://example.com/trigun"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 1", "href", "http://example.com/trigun/1")));
        when(sourceFinder.findSource(anyString())).thenReturn(List.of("http://example.com/page1.jpg"));

        NewTitle soloStubTitle = new NewTitle();
        soloStubTitle.setTitleName("Solo Leveling");
        soloStubTitle.setUuid("solo-uuid");
        soloStubTitle.setSourceUrl("http://example.com/solo");
        soloStubTitle.setLastDownloaded("0");
        lenient().when(libraryService.resolveOrCreateTitle(eq("Solo Leveling"), eq("http://example.com/solo")))
                .thenReturn(soloStubTitle);

        NewTitle trigunStubTitle = new NewTitle();
        trigunStubTitle.setTitleName("Trigun");
        trigunStubTitle.setUuid("trigun-uuid");
        trigunStubTitle.setSourceUrl("http://example.com/trigun");
        trigunStubTitle.setLastDownloaded("0");
        lenient().when(libraryService.resolveOrCreateTitle(eq("Trigun"), eq("http://example.com/trigun")))
                .thenReturn(trigunStubTitle);

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        String searchId = searchTitle.getSearchId();

        String firstResponse = downloadService.queueDownloadAllChapters(searchId, 1);
        assertThat(firstResponse).isEqualTo("Download queued for: Solo Leveling");

        String secondResponse = downloadService.queueDownloadAllChapters(searchId, 2);
        assertThat(secondResponse).isEqualTo("Download queued for: Trigun");

        // Ensure async downloads complete before @TempDir cleanup runs.
        waitForStatus("Solo Leveling", "completed");
        waitForStatus("Trigun", "completed");
    }

    /**
     * Confirms expired session returns expected error message
     */
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

        assertThat(response).isEqualTo("Search session expired or not found. Please search again.");
    }

    @Test
    void queueDownloadAllChaptersResultMarksInvalidSelection() {
        Map<String, String> title = new HashMap<>();
        title.put("title", "Bleach");
        title.put("href", "http://example.com/bleach");

        when(titleScraper.searchManga("bleach"))
                .thenReturn(new ArrayList<>(List.of(title)));

        SearchTitle searchTitle = downloadService.searchTitle("bleach");

        QueueDownloadResult result = downloadService.queueDownloadAllChaptersResult(searchTitle.getSearchId(), 99);

        assertThat(result.getStatus()).isEqualTo(QueueDownloadResult.STATUS_INVALID_SELECTION);
        assertThat(result.getMessage()).isEqualTo("Invalid selection. Please choose a valid option.");
        assertThat(result.getQueuedCount()).isZero();
    }

    @Test
    void queueDownloadAllChaptersResultMarksAlreadyActiveTitle() throws InterruptedException {
        Map<String, String> soloLeveling = new HashMap<>();
        soloLeveling.put("title", "Solo Leveling");
        soloLeveling.put("href", "http://example.com/solo");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(soloLeveling)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1")));
        CountDownLatch sourceStarted = new CountDownLatch(1);
        CountDownLatch releaseSource = new CountDownLatch(1);
        when(sourceFinder.findSource(anyString())).thenAnswer(invocation -> {
            sourceStarted.countDown();
            releaseSource.await(2, TimeUnit.SECONDS);
            return List.of("http://example.com/page1.jpg");
        });

        NewTitle resolvedTitle = new NewTitle();
        resolvedTitle.setTitleName("Solo Leveling");
        resolvedTitle.setUuid("solo-uuid");
        resolvedTitle.setSourceUrl("http://example.com/solo");
        resolvedTitle.setLastDownloaded("0");
        when(libraryService.resolveOrCreateTitle("Solo Leveling", "http://example.com/solo"))
                .thenReturn(resolvedTitle);

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        QueueDownloadResult firstResult = downloadService.queueDownloadAllChaptersResult(searchTitle.getSearchId(), 1);
        assertThat(sourceStarted.await(2, TimeUnit.SECONDS)).isTrue();
        QueueDownloadResult secondResult = downloadService.queueDownloadAllChaptersResult(searchTitle.getSearchId(), 1);

        assertThat(firstResult.getStatus()).isEqualTo(QueueDownloadResult.STATUS_QUEUED);
        assertThat(secondResult.getStatus()).isEqualTo(QueueDownloadResult.STATUS_ALREADY_ACTIVE);
        assertThat(secondResult.getSkippedTitles()).containsExactly("Solo Leveling");

        releaseSource.countDown();
        waitForStatus("Solo Leveling", "completed");
    }

    @Test
    void queueDownloadAllChaptersResultMarksMaintenancePause() {
        AtomicBoolean maintenancePauseActive = (AtomicBoolean) ReflectionTestUtils.getField(downloadService, "maintenancePauseActive");
        assertThat(maintenancePauseActive).isNotNull();
        maintenancePauseActive.set(true);

        QueueDownloadResult result = downloadService.queueDownloadAllChaptersResult("missing", 1);

        assertThat(result.getStatus()).isEqualTo(QueueDownloadResult.STATUS_MAINTENANCE_PAUSED);
        assertThat(result.getMessage()).contains("temporarily pausing new downloads");
    }

    @Test
    void queueDownloadAllChaptersResultMarksPartialAllQueueWhenSomeTitlesAreActive() throws InterruptedException {
        Map<String, String> soloLeveling = new HashMap<>();
        soloLeveling.put("title", "Solo Leveling");
        soloLeveling.put("href", "http://example.com/solo");

        Map<String, String> trigun = new HashMap<>();
        trigun.put("title", "Trigun");
        trigun.put("href", "http://example.com/trigun");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(soloLeveling, trigun)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1")));
        when(titleScraper.getChapters("http://example.com/trigun"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 1", "href", "http://example.com/trigun/1")));
        CountDownLatch sourceStarted = new CountDownLatch(1);
        CountDownLatch releaseSource = new CountDownLatch(1);
        when(sourceFinder.findSource(anyString())).thenAnswer(invocation -> {
            sourceStarted.countDown();
            releaseSource.await(2, TimeUnit.SECONDS);
            return List.of("http://example.com/page1.jpg");
        });

        NewTitle soloStubTitle = new NewTitle();
        soloStubTitle.setTitleName("Solo Leveling");
        soloStubTitle.setUuid("solo-uuid");
        soloStubTitle.setSourceUrl("http://example.com/solo");
        soloStubTitle.setLastDownloaded("0");
        lenient().when(libraryService.resolveOrCreateTitle(eq("Solo Leveling"), eq("http://example.com/solo")))
                .thenReturn(soloStubTitle);

        NewTitle trigunStubTitle = new NewTitle();
        trigunStubTitle.setTitleName("Trigun");
        trigunStubTitle.setUuid("trigun-uuid");
        trigunStubTitle.setSourceUrl("http://example.com/trigun");
        trigunStubTitle.setLastDownloaded("0");
        lenient().when(libraryService.resolveOrCreateTitle(eq("Trigun"), eq("http://example.com/trigun")))
                .thenReturn(trigunStubTitle);

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        QueueDownloadResult firstResult = downloadService.queueDownloadAllChaptersResult(searchTitle.getSearchId(), 1);
        assertThat(sourceStarted.await(2, TimeUnit.SECONDS)).isTrue();
        QueueDownloadResult allResult = downloadService.queueDownloadAllChaptersResult(searchTitle.getSearchId(), 0);

        assertThat(firstResult.getStatus()).isEqualTo(QueueDownloadResult.STATUS_QUEUED);
        assertThat(allResult.getStatus()).isEqualTo(QueueDownloadResult.STATUS_PARTIAL);
        assertThat(allResult.getQueuedCount()).isEqualTo(1);
        assertThat(allResult.getQueuedTitles()).containsExactly("Trigun");
        assertThat(allResult.getSkippedTitles()).containsExactly("Solo Leveling");

        releaseSource.countDown();
        waitForStatus("Solo Leveling", "completed");
        waitForStatus("Trigun", "completed");
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
        NewTitle resolvedTitle = new NewTitle();
        resolvedTitle.setTitleName("Solo Leveling");
        resolvedTitle.setUuid("uuid");
        resolvedTitle.setSourceUrl("http://example.com/solo");
        resolvedTitle.setLastDownloaded("0");
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
        verify(libraryService, timeout(2000).times(4))
                .addOrUpdateTitle(titleCaptor.capture(), chapterCaptor.capture());
        assertThat(chapterCaptor.getAllValues())
                .extracting(NewChapter::getChapter)
                .contains("1", "2");
        assertThat(titleCaptor.getAllValues())
                .allSatisfy(capturedTitle -> assertThat(capturedTitle.getTitleName()).isEqualTo("Solo Leveling"));
        assertThat(resolvedTitle.getLastDownloaded()).isEqualTo("2");
    }

    @Test
    void completedDownloadsMoveFromDownloadingToDownloadedFolder() throws Exception {
        Map<String, String> title = new HashMap<>();
        title.put("title", "Solo Leveling");
        title.put("href", "http://example.com/solo");
        title.put("type", "Manhwa");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(title)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1")));
        when(sourceFinder.findSource(anyString())).thenReturn(List.of("http://example.com/solo/page1.jpg"));
        NewTitle resolvedTitle = new NewTitle();
        resolvedTitle.setTitleName("Solo Leveling");
        resolvedTitle.setUuid("uuid");
        resolvedTitle.setSourceUrl("http://example.com/solo");
        resolvedTitle.setLastDownloaded("0");
        resolvedTitle.setType("Manhwa");
        when(libraryService.resolveOrCreateTitle("Solo Leveling", "http://example.com/solo"))
                .thenReturn(resolvedTitle);

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        downloadService.queueDownloadAllChapters(searchTitle.getSearchId(), 1);

        waitForStatus("Solo Leveling", "completed");

        Path downloadedTitleFolder = downloadsRoot.resolve("downloaded").resolve("manhwa").resolve("Solo Leveling");
        Path downloadingTitleFolder = downloadsRoot.resolve("downloading").resolve("manhwa").resolve("Solo Leveling");

        assertThat(downloadedTitleFolder).isDirectory();
        try (var stream = Files.list(downloadedTitleFolder)) {
            assertThat(stream.toList())
                    .hasSize(1)
                    .allSatisfy(path -> assertThat(path.getFileName().toString())
                            .isEqualTo("Solo Leveling c001 (v01) [Noona].cbz"));
        }
        assertThat(Files.exists(downloadingTitleFolder)).isFalse();
        assertThat(resolvedTitle.getDownloadPath()).isEqualTo(downloadedTitleFolder.toString());
        verify(libraryService).scanKavitaLibraryForType("Manhwa");
    }

    @Test
    void completedDownloadsUseConfiguredVolumeMapWhenPresent() throws Exception {
        Map<String, String> title = new HashMap<>();
        title.put("title", "Solo Leveling");
        title.put("href", "http://example.com/solo");
        title.put("type", "Manhwa");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(title)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1")));
        when(sourceFinder.findSource(anyString())).thenReturn(List.of("http://example.com/solo/page1.jpg"));
        NewTitle resolvedTitle = new NewTitle();
        resolvedTitle.setTitleName("Solo Leveling");
        resolvedTitle.setUuid("uuid");
        resolvedTitle.setSourceUrl("http://example.com/solo");
        resolvedTitle.setLastDownloaded("0");
        resolvedTitle.setType("Manhwa");
        resolvedTitle.setChapterVolumeMap(Map.of("1", 7));
        when(libraryService.resolveOrCreateTitle("Solo Leveling", "http://example.com/solo"))
                .thenReturn(resolvedTitle);

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        downloadService.queueDownloadAllChapters(searchTitle.getSearchId(), 1);

        waitForStatus("Solo Leveling", "completed");

        Path downloadedTitleFolder = downloadsRoot.resolve("downloaded").resolve("manhwa").resolve("Solo Leveling");
        try (var stream = Files.list(downloadedTitleFolder)) {
            assertThat(stream.toList())
                    .hasSize(1)
                    .allSatisfy(path -> assertThat(path.getFileName().toString())
                            .isEqualTo("Solo Leveling c001 (v07) [Noona].cbz"));
        }
    }

    @Test
    void completedDownloadsRecordChapterToFileMappings() throws Exception {
        Map<String, String> title = new HashMap<>();
        title.put("title", "Solo Leveling");
        title.put("href", "http://example.com/solo");
        title.put("type", "Manhwa");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(title)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1")));
        when(sourceFinder.findSource(anyString())).thenReturn(List.of("http://example.com/solo/page1.jpg"));
        NewTitle resolvedTitle = new NewTitle();
        resolvedTitle.setTitleName("Solo Leveling");
        resolvedTitle.setUuid("uuid");
        resolvedTitle.setSourceUrl("http://example.com/solo");
        resolvedTitle.setLastDownloaded("0");
        resolvedTitle.setType("Manhwa");
        when(libraryService.resolveOrCreateTitle("Solo Leveling", "http://example.com/solo"))
                .thenReturn(resolvedTitle);

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        downloadService.queueDownloadAllChapters(searchTitle.getSearchId(), 1);

        waitForStatus("Solo Leveling", "completed");

        assertThat(resolvedTitle.getDownloadedChapterFiles())
                .containsEntry("1", "Solo Leveling c001 (v01) [Noona].cbz");
    }

    @Test
    void singleChapterDownloadsPromoteIntoDownloadedFolder() throws Exception {
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 2", "href", "http://example.com/solo/2")));
        when(sourceFinder.findSource("http://example.com/solo/2"))
                .thenReturn(List.of("http://example.com/solo/page1.jpg"));

        NewTitle title = new NewTitle();
        title.setTitleName("Solo Leveling");
        title.setSourceUrl("http://example.com/solo");
        title.setType("Manhwa");

        boolean downloaded = downloadService.downloadSingleChapter(title, "2");

        Path downloadedTitleFolder = downloadsRoot.resolve("downloaded").resolve("manhwa").resolve("Solo Leveling");
        Path downloadingTitleFolder = downloadsRoot.resolve("downloading").resolve("manhwa").resolve("Solo Leveling");

        assertThat(downloaded).isTrue();
        assertThat(downloadedTitleFolder).isDirectory();
        try (var stream = Files.list(downloadedTitleFolder)) {
            assertThat(stream.toList())
                    .hasSize(1)
                    .allSatisfy(path -> assertThat(path.getFileName().toString()).endsWith(".cbz"));
        }
        assertThat(Files.exists(downloadingTitleFolder)).isFalse();
        assertThat(title.getDownloadPath()).isEqualTo(downloadedTitleFolder.toString());
    }

    @Test
    void pauseRequestFinishesCurrentChapterThenPersistsTaskForLater() throws Exception {
        Map<String, String> title = new HashMap<>();
        title.put("title", "Solo Leveling");
        title.put("href", "http://example.com/solo");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(title)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(
                        Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1"),
                        Map.of("chapter_title", "Chapter 2", "href", "http://example.com/solo/2")
                ));
        when(sourceFinder.findSource(anyString())).thenReturn(List.of("http://example.com/solo/page1.jpg"));
        NewTitle resolvedTitle = new NewTitle();
        resolvedTitle.setTitleName("Solo Leveling");
        resolvedTitle.setUuid("uuid");
        resolvedTitle.setSourceUrl("http://example.com/solo");
        resolvedTitle.setLastDownloaded("0");
        when(libraryService.resolveOrCreateTitle("Solo Leveling", "http://example.com/solo"))
                .thenReturn(resolvedTitle);

        CountDownLatch chapterDownloadStarted = new CountDownLatch(1);
        AtomicBoolean firstChapterSignalSent = new AtomicBoolean(false);
        downloadService.setBeforeSaveImagesHook(() -> {
            if (firstChapterSignalSent.compareAndSet(false, true)) {
                chapterDownloadStarted.countDown();
            }
        });
        downloadService.setPerImageDelayMs(300);

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        downloadService.queueDownloadAllChapters(searchTitle.getSearchId(), 1);

        assertThat(chapterDownloadStarted.await(2, TimeUnit.SECONDS)).isTrue();
        DownloadService.PauseRequestResult pauseResult = downloadService.requestPauseActiveDownloads();
        assertThat(pauseResult.getAffectedTasks()).isEqualTo(1);

        waitForStatus("Solo Leveling", "paused");

        DownloadProgress paused = downloadService.getDownloadStatuses().stream()
                .filter(progress -> "Solo Leveling".equals(progress.getTitle()) && "paused".equals(progress.getStatus()))
                .findFirst()
                .orElseThrow();
        assertThat(paused.getCompletedChapterNumbers()).contains("1");
        assertThat(paused.getRemainingChapterNumbers()).contains("2");
        assertThat(paused.getMessage()).contains("Pause requested");
    }

    @Test
    void queuedDownloadsWaitForVpnConnectionWhenRequired() throws Exception {
        AtomicBoolean vpnConnected = new AtomicBoolean(false);
        when(settingsService.getDownloadVpnSettings()).thenReturn(new DownloadVpnSettings(
                "downloads.vpn",
                "pia",
                true,
                true,
                true,
                30,
                "us_california",
                "pia-user",
                "pia-secret"
        ));
        when(vpnServices.getStatus()).thenAnswer(invocation -> new VpnRuntimeStatus(
                true,
                true,
                false,
                vpnConnected.get(),
                "pia",
                "us_california",
                30,
                vpnConnected.get() ? "198.51.100.12" : null,
                null,
                null,
                null,
                vpnConnected.get() ? "connected" : "idle"
        ));

        Map<String, String> title = new HashMap<>();
        title.put("title", "Solo Leveling");
        title.put("href", "http://example.com/solo");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(title)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1")));
        when(sourceFinder.findSource(anyString())).thenReturn(List.of("http://example.com/solo/page1.jpg"));
        NewTitle resolvedTitle = new NewTitle();
        resolvedTitle.setTitleName("Solo Leveling");
        resolvedTitle.setUuid("uuid");
        resolvedTitle.setSourceUrl("http://example.com/solo");
        resolvedTitle.setLastDownloaded("0");
        when(libraryService.resolveOrCreateTitle("Solo Leveling", "http://example.com/solo"))
                .thenReturn(resolvedTitle);

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        downloadService.queueDownloadAllChapters(searchTitle.getSearchId(), 1);

        waitForMessage("Solo Leveling", "Waiting for Raven VPN connection before download starts.");

        DownloadProgress waiting = downloadService.getDownloadStatuses().stream()
                .filter(progress -> "Solo Leveling".equals(progress.getTitle()))
                .findFirst()
                .orElseThrow();
        assertThat(waiting.getStatus()).isEqualTo("queued");

        vpnConnected.set(true);
        waitForStatus("Solo Leveling", "completed");
    }

    @Test
    void pauseRequestCanStopQueuedDownloadWhileWaitingForVpn() throws Exception {
        AtomicBoolean vpnConnected = new AtomicBoolean(false);
        when(settingsService.getDownloadVpnSettings()).thenReturn(new DownloadVpnSettings(
                "downloads.vpn",
                "pia",
                true,
                true,
                true,
                30,
                "us_california",
                "pia-user",
                "pia-secret"
        ));
        when(vpnServices.getStatus()).thenAnswer(invocation -> new VpnRuntimeStatus(
                true,
                true,
                false,
                vpnConnected.get(),
                "pia",
                "us_california",
                30,
                null,
                null,
                null,
                null,
                vpnConnected.get() ? "connected" : "idle"
        ));

        Map<String, String> title = new HashMap<>();
        title.put("title", "Solo Leveling");
        title.put("href", "http://example.com/solo");

        when(titleScraper.searchManga("solo"))
                .thenReturn(new ArrayList<>(List.of(title)));
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);

        SearchTitle searchTitle = downloadService.searchTitle("solo");
        downloadService.queueDownloadAllChapters(searchTitle.getSearchId(), 1);

        waitForMessage("Solo Leveling", "Waiting for Raven VPN connection before download starts.");

        DownloadService.PauseRequestResult pauseResult = downloadService.requestPauseActiveDownloads();
        assertThat(pauseResult.getAffectedTasks()).isEqualTo(1);

        waitForStatus("Solo Leveling", "paused");
    }

    @Test
    void workerModeSkipsExecutorAndRestoreBootstrapping() {
        when(runtimeProperties.isWorkerMode()).thenReturn(true);

        downloadService.initExecutor();

        assertThat(ReflectionTestUtils.getField(downloadService, "executor")).isNull();
        verify(vaultService, never()).findMany(anyString(), anyMap());
    }

    @Test
    void persistedSnapshotsIncludeWorkerMetadataAndPauseFlag() {
        DownloadProgress progress = new DownloadProgress("Solo Leveling");
        progress.ensureTaskId("task-1");
        progress.attachTaskContext(
                "task-1",
                "library-download",
                "uuid-1",
                "http://example.com/solo",
                "manhwa",
                "http://example.com/cover.jpg",
                "Summary"
        );
        progress.assignWorker(1, 6, 43210L, "process");
        progress.setPauseRequested(true);

        downloadService.updateTrackedTask(progress);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> updateCaptor = ArgumentCaptor.forClass(Map.class);
        verify(vaultService).update(eq("raven_download_tasks"), eq(Map.of("taskId", "task-1")), updateCaptor.capture(), eq(true));

        @SuppressWarnings("unchecked")
        Map<String, Object> document = (Map<String, Object>) updateCaptor.getValue().get("$set");
        assertThat(document)
                .containsEntry("workerIndex", 1)
                .containsEntry("cpuCoreId", 6)
                .containsEntry("workerPid", 43210L)
                .containsEntry("executionMode", "process")
                .containsEntry("pauseRequested", true);
    }

    @Test
    void workerModeHonorsPauseRequestBeforeStartingDownload() {
        when(runtimeProperties.isWorkerMode()).thenReturn(true);

        AtomicBoolean pauseRequested = new AtomicBoolean(true);
        mockPersistedWorkerTaskReads("task-1", pauseRequested, "http://example.com/solo");

        downloadService.runPersistedTaskInWorker("task-1", 0, 4, "process");

        verifyNoInteractions(libraryService);
        assertThat(downloadService.getDownloadStatuses())
                .anySatisfy(progress -> {
                    assertThat(progress.getTaskId()).isEqualTo("task-1");
                    assertThat(progress.getStatus()).isEqualTo("paused");
                    assertThat(progress.isPauseRequested()).isTrue();
                    assertThat(progress.getCpuCoreId()).isEqualTo(4);
                });
    }

    @Test
    void workerModePausesAtChapterBoundaryWhenPauseFlagAppears() {
        when(runtimeProperties.isWorkerMode()).thenReturn(true);
        when(loggerService.getDownloadsRoot()).thenReturn(downloadsRoot);
        when(titleScraper.getChapters("http://example.com/solo"))
                .thenReturn(List.of(
                        Map.of("chapter_title", "Chapter 1", "href", "http://example.com/solo/1"),
                        Map.of("chapter_title", "Chapter 2", "href", "http://example.com/solo/2")
                ));
        when(sourceFinder.findSource(anyString())).thenReturn(List.of("http://example.com/solo/page1.jpg"));

        NewTitle resolvedTitle = new NewTitle();
        resolvedTitle.setTitleName("Solo Leveling");
        resolvedTitle.setUuid("uuid");
        resolvedTitle.setSourceUrl("http://example.com/solo");
        resolvedTitle.setLastDownloaded("0");
        when(libraryService.resolveOrCreateTitle("Solo Leveling", "http://example.com/solo"))
                .thenReturn(resolvedTitle);

        AtomicBoolean pauseRequested = new AtomicBoolean(false);
        mockPersistedWorkerTaskReads("task-1", pauseRequested, "http://example.com/solo");
        AtomicBoolean firstChapter = new AtomicBoolean(false);
        downloadService.setBeforeSaveImagesHook(() -> {
            if (firstChapter.compareAndSet(false, true)) {
                pauseRequested.set(true);
            }
        });

        downloadService.runPersistedTaskInWorker("task-1", 1, 7, "process");

        assertThat(downloadService.getDownloadStatuses())
                .anySatisfy(progress -> {
                    assertThat(progress.getTaskId()).isEqualTo("task-1");
                    assertThat(progress.getStatus()).isEqualTo("paused");
                    assertThat(progress.getCompletedChapterNumbers()).contains("1");
                    assertThat(progress.getRemainingChapterNumbers()).contains("2");
                    assertThat(progress.isPauseRequested()).isTrue();
                    assertThat(progress.getWorkerIndex()).isEqualTo(1);
                    assertThat(progress.getCpuCoreId()).isEqualTo(7);
                    assertThat(progress.getExecutionMode()).isEqualTo("process");
                });
    }

    private void mockPersistedWorkerTaskReads(String taskId, AtomicBoolean pauseRequested, String sourceUrl) {
        lenient().when(vaultService.findOne("raven_download_tasks", Map.of("taskId", taskId)))
                .thenAnswer(invocation -> Map.of("taskId", taskId, "pauseRequested", pauseRequested.get()));
        lenient().when(vaultService.parseJson(any(Map.class), eq(DownloadProgress.class)))
                .thenAnswer(invocation -> {
                    DownloadProgress progress = new DownloadProgress("Solo Leveling");
                    progress.ensureTaskId(taskId);
                    progress.attachTaskContext(
                            taskId,
                            "library-download",
                            "uuid",
                            sourceUrl,
                            "manhwa",
                            "http://example.com/cover.jpg",
                            "Summary"
                    );
                    progress.applyChapterPlan(List.of("1", "2"), List.of("1", "2"), List.of(), "2", 2, "Queued in Raven.");
                    if (pauseRequested.get()) {
                        progress.setPauseRequested(true);
                    }
                    return progress;
                });
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

    private void waitForMessage(String titleName, String expectedMessage) throws InterruptedException {
        for (int attempt = 0; attempt < 50; attempt++) {
            List<DownloadProgress> statuses = downloadService.getDownloadStatuses();
            boolean match = statuses.stream()
                    .anyMatch(progress -> titleName.equals(progress.getTitle())
                            && expectedMessage.equals(progress.getMessage()));
            if (match) {
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Timed out waiting for message=" + expectedMessage + " for title=" + titleName);
    }

    static class TestableDownloadService extends DownloadService {
        private Runnable beforeSaveImagesHook = () -> {
        };
        private int perImageDelayMs;

        void setBeforeSaveImagesHook(Runnable beforeSaveImagesHook) {
            this.beforeSaveImagesHook = beforeSaveImagesHook == null ? () -> {
            } : beforeSaveImagesHook;
        }

        void setPerImageDelayMs(int perImageDelayMs) {
            this.perImageDelayMs = Math.max(0, perImageDelayMs);
        }

        @Override
        protected int saveImagesToFolder(List<String> urls, Path folder, DownloadNamingSettings naming, NewTitle titleRecord, String chapterNumber) {
            beforeSaveImagesHook.run();
            if (perImageDelayMs > 0) {
                try {
                    Thread.sleep(perImageDelayMs);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }
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
            try (var stream = Files.walk(folderPath)) {
                stream.sorted(Comparator.reverseOrder()).forEach(path -> {
                    try {
                        Files.deleteIfExists(path);
                    } catch (IOException ignored) {
                    }
                });
            } catch (IOException ignored) {
            }
        }
    }
}
