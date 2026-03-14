/**
 * Covers library controller behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/LibraryService.java
 * - src/main/java/com/paxkun/raven/service/library/NewTitle.java
 * - src/main/java/com/paxkun/raven/controller/LibraryController.java
 * Times this file has been edited: 2
 */
package com.paxkun.raven.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.paxkun.raven.service.LibraryService;
import com.paxkun.raven.service.library.NewTitle;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.Map;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Covers library controller behavior.
 */

@ExtendWith(MockitoExtension.class)
class LibraryControllerTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    @Mock
    private LibraryService libraryService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new LibraryController(libraryService)).build();
    }

    @Test
    void volumeMapEndpointAppliesVolumeMapAndReturnsRenameSummary() throws Exception {
        NewTitle title = new NewTitle();
        title.setUuid("uuid-volume-1");
        title.setTitleName("Solo Leveling");
        title.setMetadataProvider("mangaUpdates");
        title.setMetadataProviderSeriesId("series-123");
        title.setChapterVolumeMap(Map.of("1", 2));

        when(libraryService.applyTitleVolumeMap(
                eq("uuid-volume-1"),
                eq("mangaUpdates"),
                eq("series-123"),
                eq(Map.of("1", 2)),
                eq(true)
        )).thenReturn(new LibraryService.VolumeMapApplyResult(
                title,
                new LibraryService.RenameSummary(true, 1, 1, 0, 0, 0, "Renamed 1 file.")
        ));

        mockMvc.perform(post("/v1/library/title/{uuid}/volume-map", "uuid-volume-1")
                        .contentType("application/json")
                        .content(objectMapper.writeValueAsString(Map.of(
                                "provider", "mangaUpdates",
                                "providerSeriesId", "series-123",
                                "chapterVolumeMap", Map.of("1", 2),
                                "autoRename", true
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title.uuid").value("uuid-volume-1"))
                .andExpect(jsonPath("$.title.chapterVolumeMap.1").value(2))
                .andExpect(jsonPath("$.renameSummary.renamed").value(1));

        verify(libraryService).applyTitleVolumeMap("uuid-volume-1", "mangaUpdates", "series-123", Map.of("1", 2), true);
    }

    @Test
    void volumeMapEndpointRejectsMissingProviderIdentifiers() throws Exception {
        mockMvc.perform(post("/v1/library/title/{uuid}/volume-map", "uuid-volume-1")
                        .contentType("application/json")
                        .content("""
                                {
                                  "chapterVolumeMap": {
                                    "1": 2
                                  }
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("provider and providerSeriesId are required."));
    }
}
