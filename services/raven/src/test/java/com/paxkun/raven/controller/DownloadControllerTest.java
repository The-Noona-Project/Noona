package com.paxkun.raven.controller;

import com.paxkun.raven.service.DownloadService;
import com.paxkun.raven.service.LibraryService;
import com.paxkun.raven.service.LoggerService;
import com.paxkun.raven.service.download.DownloadProgress;
import com.paxkun.raven.service.download.TitleDetails;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
