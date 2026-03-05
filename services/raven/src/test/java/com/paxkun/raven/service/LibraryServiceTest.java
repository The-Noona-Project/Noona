package com.paxkun.raven.service;

import com.paxkun.raven.service.download.DownloadProgress;
import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.lang.reflect.Type;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.HashMap;
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

    @Mock
    private KavitaSyncService kavitaSyncService;

    @InjectMocks
    private LibraryService libraryService;

    @TempDir
    Path tempDir;

    @Captor
    private ArgumentCaptor<Map<String, Object>> mapCaptor;

    @Test
    void addOrUpdateTitlePersistsToVaultAndLogs() {
        NewTitle title = new NewTitle();
        title.setTitleName("Solo Leveling");
        title.setUuid("uuid-123");
        title.setSourceUrl("http://source");
        title.setLastDownloaded("99");
        NewChapter chapter = new NewChapter("100");

        libraryService.addOrUpdateTitle(title, chapter);

        Map<String, Object> expectedQuery = Map.of("uuid", title.getUuid());
        verify(vaultService).update(eq("manga_library"), eq(expectedQuery), mapCaptor.capture(), eq(true));

        Map<String, Object> update = mapCaptor.getValue();
        assertThat(update).containsKey("$set");
        @SuppressWarnings("unchecked")
        Map<String, Object> set = (Map<String, Object>) update.get("$set");
        assertThat(set)
                .containsEntry("uuid", title.getUuid())
                .containsEntry("title", title.getTitleName())
                .containsEntry("sourceUrl", title.getSourceUrl())
                .containsEntry("lastDownloaded", chapter.getChapter())
                .containsKey("lastDownloadedAt");
        verify(loggerService).info(eq("LIBRARY"), argThat(message -> message.contains("Updated title [" + title.getTitleName() + "]") && message.contains("chapter " + chapter.getChapter())));
        verifyNoInteractions(kavitaSyncService);
    }

    @Test
    void addOrUpdateTitleStoresDownloadedFolderPathAndEnsuresKavitaLibrary() {
        NewTitle title = new NewTitle();
        title.setTitleName("Solo Leveling");
        title.setUuid("uuid-123");
        title.setSourceUrl("http://source");
        title.setType("Manhwa");
        when(loggerService.getDownloadsRoot()).thenReturn(Path.of("/downloads"));

        libraryService.addOrUpdateTitle(title, new NewChapter("100"));

        verify(vaultService).update(eq("manga_library"), eq(Map.of("uuid", title.getUuid())), mapCaptor.capture(), eq(true));
        @SuppressWarnings("unchecked")
        Map<String, Object> set = (Map<String, Object>) mapCaptor.getValue().get("$set");
        assertThat(set).containsEntry(
                "downloadPath",
                Path.of("/downloads").resolve("downloaded").resolve("manhwa").resolve("Solo Leveling").toString()
        );
        verify(kavitaSyncService, atLeastOnce()).ensureLibraryForType("Manhwa", "manhwa");
    }

    @Test
    void checkForNewChaptersReturnsWarningWhenNoTitles() {
        when(vaultService.findMany(eq("manga_library"), anyMap())).thenReturn(List.of());
        when(vaultService.parseDocuments(anyList(), any(Type.class))).thenReturn(Collections.emptyList());

        LibraryService.LibrarySyncSummary result = libraryService.checkForNewChapters();

        assertEquals(0, result.checkedTitles());
        assertEquals(0, result.updatedTitles());
        assertEquals(0, result.queuedChapters());
        assertEquals("No titles in library.", result.message());
        verify(loggerService).warn("LIBRARY", "No titles in Vault to check.");
        verifyNoInteractions(downloadService);
    }

    @Test
    void checkForNewChaptersDownloadsAndUpdatesWhenNewChaptersFound() {
        NewTitle title = new NewTitle();
        title.setTitleName("Omniscient Reader");
        title.setUuid("uuid-456");
        title.setSourceUrl("http://omniscient");
        title.setLastDownloaded("1");
        title.setType("Manhwa");
        when(vaultService.findMany(eq("manga_library"), anyMap())).thenReturn(List.of(Map.of("title", title.getTitleName())));
        when(vaultService.parseDocuments(anyList(), any(Type.class))).thenReturn(List.of(title));
        when(downloadService.fetchChapters(title.getSourceUrl())).thenReturn(List.of(
                Map.of("chapter_number", "2", "chapter_title", "Chapter 2", "href", "http://omniscient/2")
        ));
        when(downloadService.startTrackedTask(any(NewTitle.class), anyString(), anyList(), anyList(), anyList(), anyString(), anyInt(), anyString()))
                .thenAnswer(invocation -> new DownloadProgress(invocation.<NewTitle>getArgument(0).getTitleName()));
        when(downloadService.downloadSingleChapter(eq(title), eq("2"), any())).thenReturn(true);

        LibraryService.LibrarySyncSummary result = libraryService.checkForNewChapters();

        assertEquals(1, result.checkedTitles());
        assertEquals(1, result.updatedTitles());
        assertEquals(1, result.queuedChapters());
        assertEquals(1, result.newChaptersQueued());
        assertEquals(0, result.missingChaptersQueued());
        assertEquals("Queued 1 chapter(s) across 1 title(s).", result.message());
        verify(downloadService).downloadSingleChapter(eq(title), eq("2"), any());

        verify(vaultService, atLeastOnce()).update(eq("manga_library"), eq(Map.of("uuid", title.getUuid())), mapCaptor.capture(), eq(true));
        List<Map<String, Object>> capturedUpdates = mapCaptor.getAllValues();
        Map<String, Object> update = capturedUpdates.get(capturedUpdates.size() - 1);
        assertThat(update).containsKey("$set");
        @SuppressWarnings("unchecked")
        Map<String, Object> set = (Map<String, Object>) update.get("$set");
        assertThat(set).containsEntry("lastDownloaded", "2");
        assertEquals("2", title.getLastDownloaded());
        verify(kavitaSyncService, atLeastOnce()).ensureLibraryForType("Manhwa", "manhwa");
        verify(kavitaSyncService).scanLibraryForType("Manhwa", "manhwa");
    }

    @Test
    void checkForNewChaptersSkipsWhenAlreadyUpToDate() {
        NewTitle title = new NewTitle();
        title.setTitleName("Tower of God");
        title.setUuid("uuid-789");
        title.setSourceUrl("http://tower");
        title.setLastDownloaded("105");
        when(vaultService.findMany(eq("manga_library"), anyMap())).thenReturn(List.of(Map.of("title", title.getTitleName())));
        when(vaultService.parseDocuments(anyList(), any(Type.class))).thenReturn(List.of(title));
        when(downloadService.fetchChapters(title.getSourceUrl())).thenReturn(List.of(
                Map.of("chapter_number", "105", "chapter_title", "Chapter 105", "href", "http://tower/105")
        ));

        LibraryService.LibrarySyncSummary result = libraryService.checkForNewChapters();

        assertEquals(1, result.checkedTitles());
        assertEquals(0, result.updatedTitles());
        assertEquals(0, result.queuedChapters());
        assertEquals("All titles are up-to-date.", result.message());
        verify(downloadService, never()).downloadSingleChapter(any(), anyString());
        verify(vaultService).update(eq("manga_library"), eq(Map.of("uuid", title.getUuid())), anyMap(), eq(true));
    }

    @Test
    void checkForNewChaptersUsesTrailingChapterNumberFallbackForLegacyFiles() throws Exception {
        Path titleFolder = tempDir.resolve("86 Eighty-Six");
        Files.createDirectories(titleFolder);
        Files.createFile(titleFolder.resolve("86 Eighty-Six - 001.cbz"));

        NewTitle title = new NewTitle();
        title.setTitleName("86 Eighty-Six");
        title.setUuid("uuid-legacy");
        title.setSourceUrl("http://86");
        title.setLastDownloaded("2");
        title.setDownloadPath(titleFolder.toString());

        when(vaultService.findMany(eq("manga_library"), anyMap())).thenReturn(List.of(Map.of("title", title.getTitleName())));
        when(vaultService.parseDocuments(anyList(), any(Type.class))).thenReturn(List.of(title));
        when(downloadService.fetchChapters("http://86")).thenReturn(List.of(
                Map.of("chapter_number", "1", "chapter_title", "Chapter 1", "href", "http://86/1"),
                Map.of("chapter_number", "2", "chapter_title", "Chapter 2", "href", "http://86/2")
        ));
        when(downloadService.startTrackedTask(any(NewTitle.class), anyString(), anyList(), anyList(), anyList(), anyString(), anyInt(), anyString()))
                .thenAnswer(invocation -> new DownloadProgress(invocation.<NewTitle>getArgument(0).getTitleName()));
        when(downloadService.downloadSingleChapter(eq(title), eq("2"), any())).thenReturn(true);

        LibraryService.LibrarySyncSummary result = libraryService.checkForNewChapters();

        assertEquals(1, result.updatedTitles());
        assertEquals(1, result.queuedChapters());
        assertEquals(1, result.missingChaptersQueued());
        verify(downloadService).downloadSingleChapter(eq(title), eq("2"), any());
        verify(downloadService, never()).downloadSingleChapter(eq(title), eq("86"), any());
    }

    @Test
    void resolveOrCreateTitleCreatesNewEntryWhenMissing() {
        when(vaultService.findOne("manga_library", Map.of("title", "Solo Leveling", "deletedAt", Map.of("$exists", false)))).thenReturn(null);

        NewTitle created = libraryService.resolveOrCreateTitle("Solo Leveling", "http://solo");

        assertThat(created.getTitleName()).isEqualTo("Solo Leveling");
        assertThat(created.getSourceUrl()).isEqualTo("http://solo");
        assertThat(created.getUuid()).isNotBlank();

        verify(vaultService).update(eq("manga_library"), eq(Map.of("uuid", created.getUuid())), mapCaptor.capture(), eq(true));
        Map<String, Object> update = mapCaptor.getValue();
        assertThat(update).containsKey("$set");
        @SuppressWarnings("unchecked")
        Map<String, Object> set = (Map<String, Object>) update.get("$set");
        assertThat(set).containsEntry("sourceUrl", "http://solo").containsEntry("lastDownloaded", "0");
    }

    @Test
    void resolveOrCreateTitleUpdatesExistingSourceWhenMissing() {
        Map<String, Object> stored = new HashMap<>();
        stored.put("title", "Solo Leveling");
        stored.put("uuid", "existing-uuid");
        stored.put("sourceUrl", "");
        stored.put("lastDownloaded", "7");
        when(vaultService.findOne("manga_library", Map.of("title", "Solo Leveling", "deletedAt", Map.of("$exists", false)))).thenReturn(stored);
        NewTitle existing = new NewTitle();
        existing.setTitleName("Solo Leveling");
        existing.setUuid("existing-uuid");
        existing.setSourceUrl("");
        existing.setLastDownloaded("7");
        when(vaultService.parseJson(eq(stored), eq(NewTitle.class))).thenReturn(existing);

        NewTitle resolved = libraryService.resolveOrCreateTitle("Solo Leveling", "http://solo");

        assertThat(resolved.getUuid()).isEqualTo("existing-uuid");
        assertThat(resolved.getSourceUrl()).isEqualTo("http://solo");

        verify(vaultService).update(eq("manga_library"), eq(Map.of("uuid", "existing-uuid")), anyMap(), eq(true));
    }

    @Test
    void getAllTitleObjectsPopulatesTitleNameAndCheckForNewChaptersUsesIt() {
        Map<String, Object> vaultDoc = Map.of(
                "title", "The Beginning After The End",
                "uuid", "uuid-111",
                "sourceUrl", "http://tbate",
                "lastDownloaded", "23"
        );

        when(vaultService.findMany(eq("manga_library"), anyMap())).thenReturn(List.of(vaultDoc));
        when(vaultService.parseDocuments(anyList(), any(Type.class))).thenAnswer(invocation -> {
            List<Map<String, Object>> docs = invocation.getArgument(0);
            Type type = invocation.getArgument(1);
            com.google.gson.Gson gson = new com.google.gson.Gson();
            return gson.fromJson(gson.toJson(docs), type);
        });
        doAnswer(invocation -> {
            NewTitle passedTitle = invocation.getArgument(0);
            assertThat(passedTitle.getTitleName()).isEqualTo("The Beginning After The End");
            return true;
        }).when(downloadService).downloadSingleChapter(any(NewTitle.class), anyString(), any());
        when(downloadService.fetchChapters("http://tbate")).thenReturn(List.of(
                Map.of("chapter_number", "24", "chapter_title", "Chapter 24", "href", "http://tbate/24")
        ));
        when(downloadService.startTrackedTask(any(NewTitle.class), anyString(), anyList(), anyList(), anyList(), anyString(), anyInt(), anyString()))
                .thenAnswer(invocation -> new DownloadProgress(invocation.<NewTitle>getArgument(0).getTitleName()));

        List<NewTitle> titles = libraryService.getAllTitleObjects();
        assertThat(titles).hasSize(1);
        NewTitle title = titles.get(0);
        assertThat(title.getTitleName()).isEqualTo("The Beginning After The End");

        LibraryService.LibrarySyncSummary result = assertDoesNotThrow(() -> libraryService.checkForNewChapters());
        assertEquals(1, result.checkedTitles());
        assertEquals(1, result.updatedTitles());
        assertEquals(1, result.queuedChapters());
        assertEquals("Queued 1 chapter(s) across 1 title(s).", result.message());

        verify(downloadService).downloadSingleChapter(argThat(t -> "The Beginning After The End".equals(t.getTitleName())), eq("24"), any());
    }
}
