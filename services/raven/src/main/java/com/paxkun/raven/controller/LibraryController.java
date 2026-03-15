/**
 * Exposes Raven library, file-management, sync, and volume-map endpoints.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/LibraryService.java
 * - src/main/java/com/paxkun/raven/service/library/DownloadedFile.java
 * - src/main/java/com/paxkun/raven/service/library/NewTitle.java
 * - src/main/java/com/paxkun/raven/service/library/TitleFilesResponse.java
 * Times this file has been edited: 12
 */
package com.paxkun.raven.controller;

import com.paxkun.raven.service.LibraryService;
import com.paxkun.raven.service.library.DownloadedFile;
import com.paxkun.raven.service.library.NewTitle;
import com.paxkun.raven.service.library.TitleFilesResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * REST controller for Raven library endpoints.
 * Handles retrieving titles and chapters from the library.
 *
 * Author: Pax
 */
@RestController
@RequiredArgsConstructor
public class LibraryController {

    private final LibraryService libraryService;

    // ─────────────────────────────
    // 🔍 Health Check Endpoints
    // ─────────────────────────────

    // Used by Docker/Warden for health check

    /**
     * Handles api health check.
     *
     * @return The HTTP response.
     */

    @GetMapping("/api/health")
    public ResponseEntity<String> apiHealthCheck() {
        return ResponseEntity.ok("Raven is alive!");
    }

    // Optional: Used for internal status checks

    /**
     * Handles library health check.
     *
     * @return The HTTP response.
     */

    @GetMapping("/v1/library/health")
    public ResponseEntity<String> libraryHealthCheck() {
        return ResponseEntity.ok("Raven Library API is up and running!");
    }

    // ─────────────────────────────
    // 📚 Library API
    // ─────────────────────────────

    /**
     * Returns all titles.
     *
     * @return The HTTP response.
     */

    @GetMapping("/v1/library/getall")
    public ResponseEntity<List<NewTitle>> getAllTitles() {
        List<NewTitle> titles = libraryService.getAllTitleObjects();
        return ResponseEntity.ok(titles);
    }

    /**
     * Returns title.
     *
     * @param titleName The title name to search or resolve.
     * @return The HTTP response.
     */

    @GetMapping("/v1/library/get/{titleName}")
    public ResponseEntity<NewTitle> getTitle(@PathVariable String titleName) {
        NewTitle title = libraryService.getTitle(titleName);
        if (title != null) {
            return ResponseEntity.ok(title);
        } else {
            return ResponseEntity.notFound().build();
        }
    }

    /**
     * Returns title by uuid.
     *
     * @param uuid The Raven title UUID.
     * @return The HTTP response.
     */

    @GetMapping("/v1/library/title/{uuid}")
    public ResponseEntity<NewTitle> getTitleByUuid(@PathVariable String uuid) {
        NewTitle title = libraryService.getTitleByUuid(uuid);
        if (title != null) {
            return ResponseEntity.ok(title);
        }
        return ResponseEntity.notFound().build();
    }

    /**
     * Creates title.
     *
     * @param request The request payload.
     * @return The HTTP response.
     */

    @PostMapping("/v1/library/title")
    public ResponseEntity<?> createTitle(@RequestBody LibraryTitleRequest request) {
        if (request == null || request.title() == null || request.title().isBlank()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "title is required."));
        }

        NewTitle title = libraryService.resolveOrCreateTitle(request.title().trim(), request.sourceUrl());
        return ResponseEntity.ok(title);
    }

    /**
     * Updates title.
     *
     * @param uuid The Raven title UUID.
     * @param request The request payload.
     * @return The HTTP response.
     */

    @PatchMapping("/v1/library/title/{uuid}")
    public ResponseEntity<?> updateTitle(@PathVariable String uuid, @RequestBody LibraryTitleUpdateRequest request) {
        if (uuid == null || uuid.isBlank()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "uuid is required."));
        }

        String nextTitle = request != null ? request.title() : null;
        String nextSource = request != null ? request.sourceUrl() : null;
        String nextCoverUrl = request != null ? request.coverUrl() : null;

        if ((nextTitle == null || nextTitle.isBlank())
                && (nextSource == null || nextSource.isBlank())
                && (nextCoverUrl == null || nextCoverUrl.isBlank())) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "At least one of title/sourceUrl/coverUrl must be provided."));
        }

        NewTitle updated = libraryService.updateTitle(uuid.trim(), nextTitle, nextSource, nextCoverUrl);
        if (updated == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(updated);
    }

    /**
     * Deletes title.
     *
     * @param uuid The Raven title UUID.
     * @return The HTTP response.
     */

    @DeleteMapping("/v1/library/title/{uuid}")
    public ResponseEntity<?> deleteTitle(@PathVariable String uuid) {
        if (uuid == null || uuid.isBlank()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "uuid is required."));
        }

        boolean deleted = libraryService.deleteTitle(uuid.trim());
        if (!deleted) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(java.util.Map.of("deleted", true));
    }

    /**
     * Returns title files.
     *
     * @param uuid The Raven title UUID.
     * @param limit The limit.
     * @return The HTTP response.
     */

    @GetMapping("/v1/library/title/{uuid}/files")
    public ResponseEntity<?> listTitleFiles(
            @PathVariable String uuid,
            @RequestParam(value = "limit", required = false) Integer limit
    ) {
        if (uuid == null || uuid.isBlank()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "uuid is required."));
        }

        NewTitle title = libraryService.getTitleByUuid(uuid.trim());
        if (title == null) {
            return ResponseEntity.notFound().build();
        }

        int safeLimit = limit == null ? 200 : limit;
        List<DownloadedFile> files = libraryService.listDownloadedFiles(title, safeLimit);
        TitleFilesResponse response = new TitleFilesResponse(title.getUuid(), title.getTitleName(), files);
        return ResponseEntity.ok(response);
    }

    /**
     * Deletes title files.
     *
     * @param uuid The Raven title UUID.
     * @param request The request payload.
     * @return The HTTP response.
     */

    @DeleteMapping("/v1/library/title/{uuid}/files")
    public ResponseEntity<?> deleteTitleFiles(
            @PathVariable String uuid,
            @RequestBody(required = false) DeleteTitleFilesRequest request
    ) {
        if (uuid == null || uuid.isBlank()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "uuid is required."));
        }

        if (request == null || request.names() == null || request.names().isEmpty()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "names must include at least one file name."));
        }

        NewTitle title = libraryService.getTitleByUuid(uuid.trim());
        if (title == null) {
            return ResponseEntity.notFound().build();
        }

        int deleted = libraryService.deleteDownloadedFiles(title, request.names());
        return ResponseEntity.ok(java.util.Map.of(
                "deleted", deleted,
                "requested", request.names().size(),
                "uuid", title.getUuid()
        ));
    }

    /**
     * Applies title volume map.
     *
     * @param uuid The Raven title UUID.
     * @param request The request payload.
     * @return The HTTP response.
     */

    @PostMapping("/v1/library/title/{uuid}/volume-map")
    public ResponseEntity<?> applyTitleVolumeMap(
            @PathVariable String uuid,
            @RequestBody(required = false) TitleVolumeMapRequest request
    ) {
        if (uuid == null || uuid.isBlank()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "uuid is required."));
        }

        if (request == null) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "provider and providerSeriesId are required."));
        }

        String provider = request.provider() != null ? request.provider().trim() : "";
        String providerSeriesId = request.providerSeriesId() != null ? request.providerSeriesId().trim() : "";
        if (provider.isBlank() || providerSeriesId.isBlank()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "provider and providerSeriesId are required."));
        }

        LibraryService.VolumeMapApplyResult result = libraryService.applyTitleVolumeMap(
                uuid.trim(),
                provider,
                providerSeriesId,
                request.chapterVolumeMap(),
                request.autoRename()
        );
        if (result == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(java.util.Map.of(
                "title", result.title(),
                "renameSummary", result.renameSummary()
        ));
    }

    /**
     * Checks title for new chapters.
     *
     * @param uuid The Raven title UUID.
     * @return The HTTP response.
     */

    @PostMapping("/v1/library/title/{uuid}/checkForNew")
    public ResponseEntity<?> checkTitleForNewChapters(@PathVariable String uuid) {
        if (uuid == null || uuid.isBlank()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "uuid is required."));
        }

        LibraryService.TitleSyncResult result = libraryService.checkForNewChaptersByUuid(uuid.trim());
        if (result == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(result);
    }

    /**
     * Checks for new chapters.
     *
     * @return The HTTP response.
     */

    @PostMapping("/v1/library/checkForNew")
    public ResponseEntity<LibraryService.LibrarySyncSummary> checkForNewChapters() {
        LibraryService.LibrarySyncSummary result = libraryService.checkForNewChapters();
        return ResponseEntity.ok(result);
    }

    /**
     * Checks available imports.
     *
     * @return The HTTP response.
     */

    @PostMapping("/v1/library/imports/check")
    public ResponseEntity<LibraryService.LibraryImportSummary> checkAvailableImports() {
        LibraryService.LibraryImportSummary result = libraryService.checkAvailableImports();
        return ResponseEntity.ok(result);
    }

    /**
     * Represents Raven library, file-management, sync, and volume-map endpoints.
     *
     * @param title The Raven title.
     * @param sourceUrl The source url.
     */

    public record LibraryTitleRequest(String title, String sourceUrl) {
    }

    /**
     * Represents Raven library, file-management, sync, and volume-map endpoints.
     *
     * @param title The Raven title.
     * @param sourceUrl The source url.
     * @param coverUrl The cover url.
     */

    public record LibraryTitleUpdateRequest(String title, String sourceUrl, String coverUrl) {
    }

    /**
     * Represents Raven library, file-management, sync, and volume-map endpoints.
     *
     * @param names The names.
     */

    public record DeleteTitleFilesRequest(List<String> names) {
    }

    /**
     * Represents Raven library, file-management, sync, and volume-map endpoints.
     *
     * @param provider The provider.
     * @param providerSeriesId The provider series id.
     * @param chapterVolumeMap The chapter volume map.
     * @param autoRename The auto rename.
     */

    public record TitleVolumeMapRequest(
            String provider,
            String providerSeriesId,
            java.util.Map<String, Integer> chapterVolumeMap,
            Boolean autoRename
    ) {
    }
}
