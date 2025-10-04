package com.paxkun.raven.service;

import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.lang.reflect.Type;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class LibraryServiceTest {

    @Mock
    private VaultService vaultService;

    @Mock
    private DownloadService downloadService;

    @Mock
    private LoggerService loggerService;

    @InjectMocks
    private LibraryService libraryService;

    @Captor
    private ArgumentCaptor<Map<String, Object>> mapCaptor;

    @Test
    void addOrUpdateTitlePersistsToVaultAndLogs() {
        NewTitle title = new NewTitle("Solo Leveling", "uuid-123", "http://source", "99");
        NewChapter chapter = new NewChapter("100");

        libraryService.addOrUpdateTitle(title, chapter);

        Map<String, Object> expectedQuery = Map.of("uuid", title.getUuid());
        Map<String, Object> expectedSet = Map.of(
                "uuid", title.getUuid(),
                "title", title.getTitleName(),
                "sourceUrl", title.getSourceUrl(),
                "lastDownloaded", chapter.getChapter()
        );
        Map<String, Object> expectedUpdate = Map.of("$set", expectedSet);

        verify(vaultService).update("manga_library", expectedQuery, expectedUpdate, true);
        verify(loggerService).info("LIBRARY", "📚 Updated title [" + title.getTitleName() + "] to chapter " + chapter.getChapter());
    }

    @Test
    void checkForNewChaptersReturnsWarningWhenNoTitles() {
        when(vaultService.findAll("manga_library")).thenReturn(List.of());
        when(vaultService.parseDocuments(anyList(), any(Type.class))).thenReturn(Collections.emptyList());

        String result = libraryService.checkForNewChapters();

        assertEquals("No titles in Vault.", result);
        verify(loggerService).warn("LIBRARY", "⚠️ No titles in Vault to check.");
        verifyNoInteractions(downloadService);
    }

    @Test
    void checkForNewChaptersDownloadsAndUpdatesWhenNewChaptersFound() {
        NewTitle title = new NewTitle("Omniscient Reader", "uuid-456", "http://omniscient", "1");
        when(vaultService.findAll("manga_library")).thenReturn(List.of(Map.of("title", title.getTitleName())));
        when(vaultService.parseDocuments(anyList(), any(Type.class))).thenReturn(List.of(title));
        when(vaultService.fetchLatestChapterFromSource(title.getSourceUrl())).thenReturn("2");

        String result = libraryService.checkForNewChapters();

        assertEquals("⬇️ Downloaded 1 new chapters.", result);
        verify(downloadService).downloadSingleChapter(title, "2");

        verify(vaultService).update(eq("manga_library"), eq(Map.of("uuid", title.getUuid())), mapCaptor.capture(), eq(true));
        Map<String, Object> update = mapCaptor.getValue();
        assertThat(update).containsKey("$set");
        @SuppressWarnings("unchecked")
        Map<String, Object> set = (Map<String, Object>) update.get("$set");
        assertThat(set).containsEntry("lastDownloaded", "2");
        assertEquals("2", title.getLastDownloaded());
    }

    @Test
    void checkForNewChaptersSkipsWhenAlreadyUpToDate() {
        NewTitle title = new NewTitle("Tower of God", "uuid-789", "http://tower", "105");
        when(vaultService.findAll("manga_library")).thenReturn(List.of(Map.of("title", title.getTitleName())));
        when(vaultService.parseDocuments(anyList(), any(Type.class))).thenReturn(List.of(title));
        when(vaultService.fetchLatestChapterFromSource(title.getSourceUrl())).thenReturn("105");

        String result = libraryService.checkForNewChapters();

        assertEquals("✅ All titles up-to-date.", result);
        verify(downloadService, never()).downloadSingleChapter(any(), anyString());
        verify(vaultService, never()).update(anyString(), anyMap(), anyMap(), anyBoolean());
    }

    @Test
    void getAllTitleObjectsPopulatesTitleNameAndCheckForNewChaptersUsesIt() {
        Map<String, Object> vaultDoc = Map.of(
                "title", "The Beginning After The End",
                "uuid", "uuid-111",
                "sourceUrl", "http://tbate",
                "lastDownloaded", "23"
        );

        when(vaultService.findAll("manga_library")).thenReturn(List.of(vaultDoc));
        when(vaultService.parseDocuments(anyList(), any(Type.class))).thenAnswer(invocation -> {
            List<Map<String, Object>> docs = invocation.getArgument(0);
            Type type = invocation.getArgument(1);
            com.google.gson.Gson gson = new com.google.gson.Gson();
            return gson.fromJson(gson.toJson(docs), type);
        });
        when(vaultService.fetchLatestChapterFromSource("http://tbate")).thenReturn("24");

        List<NewTitle> titles = libraryService.getAllTitleObjects();
        assertThat(titles).hasSize(1);
        NewTitle title = titles.get(0);
        assertThat(title.getTitleName()).isEqualTo("The Beginning After The End");

        String result = assertDoesNotThrow(() -> libraryService.checkForNewChapters());
        assertEquals("⬇️ Downloaded 1 new chapters.", result);

        verify(downloadService).downloadSingleChapter(argThat(t -> "The Beginning After The End".equals(t.getTitleName())), eq("24"));
    }
}
