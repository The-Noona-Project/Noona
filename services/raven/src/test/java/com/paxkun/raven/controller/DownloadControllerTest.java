package com.paxkun.raven.controller;

import com.paxkun.raven.service.DownloadService;
import com.paxkun.raven.service.LibraryService;
import com.paxkun.raven.service.LoggerService;
import com.paxkun.raven.service.download.DownloadProgress;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
    void summaryEndpointPrefersActiveDownloadState() throws Exception {
        DownloadProgress progress = new DownloadProgress("Solo Leveling");
        progress.markStarted(22);
        progress.chapterStarted("Chapter 21");
        progress.chapterCompleted();

        when(downloadService.getPrimaryActiveDownloadStatus()).thenReturn(progress);
        when(downloadService.getActiveDownloadCount()).thenReturn(1);
        when(downloadService.getConfiguredDownloadThreads()).thenReturn(3);
        when(downloadService.getThreadRateLimitsKbps()).thenReturn(List.of(0, 256, 0));
        when(libraryService.getCurrentCheckActivity()).thenReturn(null);

        mockMvc.perform(get("/v1/download/status/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("downloading"))
                .andExpect(jsonPath("$.statusText").value("Downloading Solo Leveling"))
                .andExpect(jsonPath("$.activeDownloads").value(1))
                .andExpect(jsonPath("$.threadRateLimitsKbps[1]").value(256))
                .andExpect(jsonPath("$.currentDownload.title").value("Solo Leveling"))
                .andExpect(jsonPath("$.currentDownload.currentChapter").value("Chapter 21"));
    }

    @Test
    void summaryEndpointReportsCheckStateWhenNoDownloadsAreActive() throws Exception {
        when(downloadService.getPrimaryActiveDownloadStatus()).thenReturn(null);
        when(downloadService.getActiveDownloadCount()).thenReturn(0);
        when(downloadService.getConfiguredDownloadThreads()).thenReturn(2);
        when(downloadService.getThreadRateLimitsKbps()).thenReturn(List.of(0, 0));
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
}
