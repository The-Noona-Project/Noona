package com.paxkun.raven.controller;

import com.paxkun.raven.service.LibraryService;
import com.paxkun.raven.service.library.NewTitle;
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