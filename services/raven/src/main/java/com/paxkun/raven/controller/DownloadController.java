package com.paxkun.raven.controller;

import com.paxkun.raven.service.DownloadService;
import com.paxkun.raven.service.download.DownloadChapter;
import com.paxkun.raven.service.download.SearchTitle;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * REST controller for Raven download endpoints.
 * Handles searching and downloading new titles.
 */
@RestController
@RequestMapping("/v1/download")
@RequiredArgsConstructor
public class DownloadController {

    private final DownloadService downloadService;

    /**
     * Health check endpoint for Raven downloads.
     *
     * @return status message
     */
    @GetMapping("/health")
    public ResponseEntity<String> healthCheck() {
        return ResponseEntity.ok("Raven Download API is up and running!");
    }

    /**
     * Search for a new title by name.
     *
     * @param titleName name to search
     * @return SearchTitle containing search ID and possible matches
     */
    @GetMapping("/new/{titleName}")
    public ResponseEntity<SearchTitle> searchTitle(@PathVariable String titleName) {
        SearchTitle result = downloadService.searchTitle(titleName);
        return ResponseEntity.ok(result);
    }

    /**
     * Download a selected title by search ID and user option.
     *
     * @param searchId unique search session ID
     * @param optionIndex index of selected option
     * @return DownloadChapter result after downloading
     */
    @PostMapping("/search/{searchId}")
    public ResponseEntity<DownloadChapter> downloadSelectedTitle(
            @PathVariable String searchId,
            @RequestParam int optionIndex) {
        DownloadChapter result = downloadService.downloadSelectedTitle(searchId, optionIndex);
        return ResponseEntity.ok(result);
    }
}
