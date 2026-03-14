/**
 * Covers download controller behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/DownloadService.java
 * - src/main/java/com/paxkun/raven/service/LibraryService.java
 * - src/main/java/com/paxkun/raven/service/LoggerService.java
 * - src/main/java/com/paxkun/raven/service/download/DownloadProgress.java
 * Times this file has been edited: 7
 */
package com.paxkun.raven.controller;

import com.paxkun.raven.service.DownloadService;
import com.paxkun.raven.service.LibraryService;
import com.paxkun.raven.service.LoggerService;
import com.paxkun.raven.service.download.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Covers download controller behavior.
 */

@ExtendWith(MockitoExtension.class)
class DownloadControllerTest {

    @Mock
    private DownloadService downloadService;

    @Mock
    private LoggerService loggerService;

    @Mock
    private LibraryService libraryService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new DownloadController(downloadService, libraryService, loggerService)).build();
    }

    @Test
    void statusEndpointReturnsProgress() throws Exception {
        DownloadProgress progress = new DownloadProgress("Solo Leveling");
        progress.markStarted(2);
        progress.chapterStarted("Chapter 1");
        progress.chapterCompleted();
        progress.markCompleted();
        when(downloadService.getDownloadStatuses()).thenReturn(List.of(progress));

        mockMvc.perform(get("/v1/download/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].title").value("Solo Leveling"))
                .andExpect(jsonPath("$[0].status").value("completed"))
                .andExpect(jsonPath("$[0].totalChapters").value(2));

        verify(downloadService).getDownloadStatuses();
    }

    @Test
    void deleteEndpointClearsEntry() throws Exception {
        mockMvc.perform(delete("/v1/download/status/{title}", "Solo Leveling"))
                .andExpect(status().isNoContent());

        verify(downloadService).clearDownloadStatus("Solo Leveling");
    }

    @Test
    void postSearchEndpointAcceptsSpecialCharacters() throws Exception {
        SearchTitle payload = new SearchTitle("search-1", List.of(java.util.Map.of(
                "title", "D.Gray-man",
                "href", "https://source.example/d-gray-man"
        )));
        String query = "D.Gray-man & JoJo's: Part 7/Steel Ball Run? #1%+()";

        when(downloadService.searchTitle(eq(query))).thenReturn(payload);

        mockMvc.perform(post("/v1/download/search")
                        .contentType("application/json")
                        .content("{\"query\":\"D.Gray-man & JoJo's: Part 7/Steel Ball Run? #1%+()\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.searchId").value("search-1"))
                .andExpect(jsonPath("$.options[0].title").value("D.Gray-man"));
    }

    @Test
    void legacyGetSearchEndpointRemainsCompatible() throws Exception {
        SearchTitle payload = new SearchTitle("search-legacy", List.of());
        when(downloadService.searchTitle("naruto")).thenReturn(payload);

        mockMvc.perform(get("/v1/download/search/{titleName}", "naruto"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.searchId").value("search-legacy"));
    }

    @Test
    void titleDetailsEndpointReturnsAdultContent() throws Exception {
        TitleDetails details = new TitleDetails();
        details.setSourceUrl("https://source.example/solo-leveling");
        details.setSummary("A hunter rises.");
        details.setType("Manhwa");
        details.setAdultContent(true);
        details.setAssociatedNames(List.of("Only I level up"));
        details.setStatus("Complete");
        details.setReleased("2018");
        details.setOfficialTranslation(true);
        details.setAnimeAdaptation(true);
        details.setRelatedSeries(List.of(java.util.Map.of(
                "title", "Solo Leveling: Ragnarok",
                "sourceUrl", "https://source.example/solo-leveling-ragnarok",
                "relation", "Sequel"
        )));

        when(downloadService.getTitleDetails("https://source.example/solo-leveling"))
                .thenReturn(details);

        mockMvc.perform(get("/v1/download/title-details").param("url", "https://source.example/solo-leveling"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceUrl").value("https://source.example/solo-leveling"))
                .andExpect(jsonPath("$.type").value("Manhwa"))
                .andExpect(jsonPath("$.adultContent").value(true))
                .andExpect(jsonPath("$.associatedNames[0]").value("Only I level up"))
                .andExpect(jsonPath("$.status").value("Complete"))
                .andExpect(jsonPath("$.released").value("2018"))
                .andExpect(jsonPath("$.officialTranslation").value(true))
                .andExpect(jsonPath("$.animeAdaptation").value(true))
                .andExpect(jsonPath("$.relatedSeries[0].title").value("Solo Leveling: Ragnarok"));
    }

    @Test
    void legacyGetQueueEndpointRemainsCompatible() throws Exception {
        when(downloadService.queueDownloadAllChapters("search-legacy", 1))
                .thenReturn("Download queued for: Naruto");

        mockMvc.perform(get("/v1/download/select/{searchId}/{optionIndex}", "search-legacy", 1))
                .andExpect(status().isOk())
                .andExpect(content().string("Download queued for: Naruto"));
    }

    @Test
    void postQueueEndpointReturnsAcceptedForQueuedResults() throws Exception {
        when(downloadService.queueDownloadAllChaptersResult("search-123", 2))
                .thenReturn(new QueueDownloadResult(
                        QueueDownloadResult.STATUS_QUEUED,
                        "Download queued for: Solo Leveling",
                        1,
                        List.of("Solo Leveling"),
                        List.of()
                ));

        mockMvc.perform(post("/v1/download/select")
                        .contentType("application/json")
                        .content("{\"searchId\":\"search-123\",\"optionIndex\":2}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value(QueueDownloadResult.STATUS_QUEUED))
                .andExpect(jsonPath("$.queuedCount").value(1));
    }

    @Test
    void postQueueEndpointReturnsGoneForExpiredSessions() throws Exception {
        when(downloadService.queueDownloadAllChaptersResult("search-123", 2))
                .thenReturn(new QueueDownloadResult(
                        QueueDownloadResult.STATUS_SEARCH_EXPIRED,
                        "Search session expired or not found. Please search again.",
                        0,
                        List.of(),
                        List.of()
                ));

        mockMvc.perform(post("/v1/download/select")
                        .contentType("application/json")
                        .content("{\"searchId\":\"search-123\",\"optionIndex\":2}"))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.status").value(QueueDownloadResult.STATUS_SEARCH_EXPIRED));
    }

    @Test
    void postQueueEndpointReturnsConflictForAlreadyActiveTitles() throws Exception {
        when(downloadService.queueDownloadAllChaptersResult("search-123", 2))
                .thenReturn(new QueueDownloadResult(
                        QueueDownloadResult.STATUS_ALREADY_ACTIVE,
                        "Download already in progress for: Solo Leveling",
                        0,
                        List.of(),
                        List.of("Solo Leveling")
                ));

        mockMvc.perform(post("/v1/download/select")
                        .contentType("application/json")
                        .content("{\"searchId\":\"search-123\",\"optionIndex\":2}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(QueueDownloadResult.STATUS_ALREADY_ACTIVE))
                .andExpect(jsonPath("$.skippedTitles[0]").value("Solo Leveling"));
    }

    @Test
    void postQueueEndpointReturnsBadRequestForInvalidSelection() throws Exception {
        when(downloadService.queueDownloadAllChaptersResult("search-123", 99))
                .thenReturn(new QueueDownloadResult(
                        QueueDownloadResult.STATUS_INVALID_SELECTION,
                        "Invalid selection. Please choose a valid option.",
                        0,
                        List.of(),
                        List.of()
                ));

        mockMvc.perform(post("/v1/download/select")
                        .contentType("application/json")
                        .content("{\"searchId\":\"search-123\",\"optionIndex\":99}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(QueueDownloadResult.STATUS_INVALID_SELECTION));
    }

    @Test
    void postQueueEndpointValidatesMissingPayloadFields() throws Exception {
        mockMvc.perform(post("/v1/download/select")
                        .contentType("application/json")
                        .content("{\"searchId\":\" \",\"optionIndex\":null}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(QueueDownloadResult.STATUS_INVALID_SELECTION))
                .andExpect(jsonPath("$.message").value("searchId and optionIndex are required."));
    }

    @Test
    void postBulkQueueEndpointReturnsAcceptedResultPayload() throws Exception {
        when(downloadService.queueBulkDownload("Manga", false, "a"))
                .thenReturn(new BulkQueueDownloadResult(
                        BulkQueueDownloadResult.STATUS_PARTIAL,
                        "Queued 1 title(s). Skipped 1 already-active title(s). Failed 0 title(s).",
                        new BulkQueueDownloadResult.Filters("Manga", false, "a"),
                        2,
                        2,
                        1,
                        1,
                        0,
                        List.of("Ano and the Signal"),
                        List.of("Another Dawn"),
                        List.of()
                ));

        mockMvc.perform(post("/v1/download/bulk-queue")
                        .contentType("application/json")
                        .content("{\"type\":\"Manga\",\"nsfw\":false,\"titlePrefix\":\"a\"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value(BulkQueueDownloadResult.STATUS_PARTIAL))
                .andExpect(jsonPath("$.filters.type").value("Manga"))
                .andExpect(jsonPath("$.filters.nsfw").value(false))
                .andExpect(jsonPath("$.pagesScanned").value(2))
                .andExpect(jsonPath("$.matchedCount").value(2))
                .andExpect(jsonPath("$.queuedTitles[0]").value("Ano and the Signal"))
                .andExpect(jsonPath("$.skippedActiveTitles[0]").value("Another Dawn"));
    }

    @Test
    void postBulkQueueEndpointValidatesMissingFields() throws Exception {
        mockMvc.perform(post("/v1/download/bulk-queue")
                        .contentType("application/json")
                        .content("{\"type\":\" \",\"nsfw\":null,\"titlePrefix\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(BulkQueueDownloadResult.STATUS_INVALID_REQUEST))
                .andExpect(jsonPath("$.message").value("type, nsfw, and titlePrefix are required."));
    }

    @Test
    void summaryEndpointPrefersActiveDownloadState() throws Exception {
        DownloadProgress progress = new DownloadProgress("Solo Leveling");
        progress.markStarted(22);
        progress.chapterStarted("Chapter 21");
        progress.chapterCompleted();
        progress.assignWorker(1, 6, 3210L, "process");
        progress.setPauseRequested(true);

        when(downloadService.getPrimaryActiveDownloadStatus()).thenReturn(progress);
        when(downloadService.getActiveDownloadCount()).thenReturn(1);
        when(downloadService.getConfiguredDownloadThreads()).thenReturn(3);
        when(downloadService.getThreadRateLimitsKbps()).thenReturn(List.of(0, 256, 0));
        when(downloadService.getWorkerExecutionMode()).thenReturn("process");
        when(downloadService.getWorkerCpuCoreIds()).thenReturn(List.of(4, 6, -1));
        when(downloadService.getAvailableCpuIds()).thenReturn(List.of(4, 5, 6, 7));
        when(downloadService.getActiveWorkers()).thenReturn(List.of(java.util.Map.of(
                "taskId", "task-1",
                "workerIndex", 1,
                "cpuCoreId", 6,
                "workerPid", 3210L,
                "executionMode", "process"
        )));
        when(libraryService.getCurrentCheckActivity()).thenReturn(null);

        mockMvc.perform(get("/v1/download/status/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("downloading"))
                .andExpect(jsonPath("$.statusText").value("Downloading Solo Leveling"))
                .andExpect(jsonPath("$.activeDownloads").value(1))
                .andExpect(jsonPath("$.threadRateLimitsKbps[1]").value(256))
                .andExpect(jsonPath("$.workerExecutionMode").value("process"))
                .andExpect(jsonPath("$.workerCpuCoreIds[1]").value(6))
                .andExpect(jsonPath("$.availableCpuIds[0]").value(4))
                .andExpect(jsonPath("$.activeWorkers[0].workerPid").value(3210))
                .andExpect(jsonPath("$.currentDownload.title").value("Solo Leveling"))
                .andExpect(jsonPath("$.currentDownload.currentChapter").value("Chapter 21"))
                .andExpect(jsonPath("$.currentDownload.workerIndex").value(1))
                .andExpect(jsonPath("$.currentDownload.pauseRequested").value(true));
    }

    @Test
    void summaryEndpointReportsCheckStateWhenNoDownloadsAreActive() throws Exception {
        when(downloadService.getPrimaryActiveDownloadStatus()).thenReturn(null);
        when(downloadService.getActiveDownloadCount()).thenReturn(0);
        when(downloadService.getConfiguredDownloadThreads()).thenReturn(2);
        when(downloadService.getThreadRateLimitsKbps()).thenReturn(List.of(0, 0));
        when(downloadService.getWorkerExecutionMode()).thenReturn("thread");
        when(downloadService.getWorkerCpuCoreIds()).thenReturn(List.of(-1, -1));
        when(downloadService.getAvailableCpuIds()).thenReturn(List.of());
        when(downloadService.getActiveWorkers()).thenReturn(List.of());
        when(libraryService.getCurrentCheckActivity())
                .thenReturn(new LibraryService.CheckActivity("library", "Omniscient Reader", 2, 14, 123L));

        mockMvc.perform(get("/v1/download/status/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("checking"))
                .andExpect(jsonPath("$.statusText").value("Checking Omniscient Reader"))
                .andExpect(jsonPath("$.currentCheck.mode").value("library"))
                .andExpect(jsonPath("$.currentCheck.title").value("Omniscient Reader"))
                .andExpect(jsonPath("$.currentCheck.checkedTitles").value(2))
                .andExpect(jsonPath("$.currentCheck.totalTitles").value(14));
    }

    @Test
    void pauseEndpointQueuesGracefulPause() throws Exception {
        when(downloadService.requestPauseActiveDownloads())
                .thenReturn(new DownloadService.PauseRequestResult(
                        List.of("Queued Title"),
                        List.of("Solo Leveling")
                ));

        mockMvc.perform(post("/v1/download/pause"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.affectedTasks").value(2))
                .andExpect(jsonPath("$.pausedImmediately[0]").value("Queued Title"))
                .andExpect(jsonPath("$.pausingAfterCurrentChapter[0]").value("Solo Leveling"));

        verify(downloadService).requestPauseActiveDownloads();
    }
}
