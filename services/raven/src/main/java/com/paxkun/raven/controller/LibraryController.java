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
@RequestMapping("/v1/library")
@RequiredArgsConstructor
public class LibraryController {

    private final LibraryService libraryService;

    @GetMapping("/health")
    public ResponseEntity<String> healthCheck() {
        return ResponseEntity.ok("Raven Library API is up and running!");
    }

    @GetMapping("/getall")
    public ResponseEntity<List<NewTitle>> getAllTitles() {
        List<NewTitle> titles = libraryService.getAllTitleObjects();
        return ResponseEntity.ok(titles);
    }

    @GetMapping("/get/{titleName}")
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
    @PostMapping("/checkForNew")
    public ResponseEntity<String> checkForNewChapters() {
        String result = libraryService.checkForNewChapters();
        return ResponseEntity.ok(result);
    }
}
