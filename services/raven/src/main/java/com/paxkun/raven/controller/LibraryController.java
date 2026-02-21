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
    @GetMapping("/api/health")
    public ResponseEntity<String> apiHealthCheck() {
        return ResponseEntity.ok("Raven is alive!");
    }

    // Optional: Used for internal status checks
    @GetMapping("/v1/library/health")
    public ResponseEntity<String> libraryHealthCheck() {
        return ResponseEntity.ok("Raven Library API is up and running!");
    }

    // ─────────────────────────────
    // 📚 Library API
    // ─────────────────────────────

    @GetMapping("/v1/library/getall")
    public ResponseEntity<List<NewTitle>> getAllTitles() {
        List<NewTitle> titles = libraryService.getAllTitleObjects();
        return ResponseEntity.ok(titles);
    }

    @GetMapping("/v1/library/get/{titleName}")
    public ResponseEntity<NewTitle> getTitle(@PathVariable String titleName) {
        NewTitle title = libraryService.getTitle(titleName);
        if (title != null) {
            return ResponseEntity.ok(title);
        } else {
            return ResponseEntity.notFound().build();
        }
    }

    @GetMapping("/v1/library/title/{uuid}")
    public ResponseEntity<NewTitle> getTitleByUuid(@PathVariable String uuid) {
        NewTitle title = libraryService.getTitleByUuid(uuid);
        if (title != null) {
            return ResponseEntity.ok(title);
        }
        return ResponseEntity.notFound().build();
    }

    @PostMapping("/v1/library/title")
    public ResponseEntity<?> createTitle(@RequestBody LibraryTitleRequest request) {
        if (request == null || request.title() == null || request.title().isBlank()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "title is required."));
        }

        NewTitle title = libraryService.resolveOrCreateTitle(request.title().trim(), request.sourceUrl());
        return ResponseEntity.ok(title);
    }

    @PatchMapping("/v1/library/title/{uuid}")
    public ResponseEntity<?> updateTitle(@PathVariable String uuid, @RequestBody LibraryTitleUpdateRequest request) {
        if (uuid == null || uuid.isBlank()) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "uuid is required."));
        }

        String nextTitle = request != null ? request.title() : null;
        String nextSource = request != null ? request.sourceUrl() : null;

        if ((nextTitle == null || nextTitle.isBlank()) && (nextSource == null || nextSource.isBlank())) {
            return ResponseEntity.badRequest().body(java.util.Map.of("error", "At least one of title/sourceUrl must be provided."));
        }

        NewTitle updated = libraryService.updateTitle(uuid.trim(), nextTitle, nextSource);
        if (updated == null) {
            return ResponseEntity.notFound().build();
        }

        return ResponseEntity.ok(updated);
    }

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

    public record LibraryTitleRequest(String title, String sourceUrl) {
    }

    public record LibraryTitleUpdateRequest(String title, String sourceUrl) {
    }

    /**
     * Endpoint to check all titles for new chapters.
     * Calls Vault to get the library data, scrapes sources,
     * and queues downloads for missing chapters.
     */
    @PostMapping("/v1/library/checkForNew")
    public ResponseEntity<String> checkForNewChapters() {
        String result = libraryService.checkForNewChapters();
        return ResponseEntity.ok(result);
    }
}
