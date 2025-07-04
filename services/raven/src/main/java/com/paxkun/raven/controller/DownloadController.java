package com.paxkun.raven.controller;

import com.paxkun.raven.service.DownloadService;
import com.paxkun.raven.service.download.SearchTitle;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * DownloadController handles endpoints for searching and downloading manga titles and chapters.
 *
 * Author: Pax
 */
@RestController
@RequestMapping("/v1/download")
@RequiredArgsConstructor
public class DownloadController {

    private final DownloadService downloadService;

    /**
     * Health check endpoint for Raven's download module.
     *
     * @return Status message
     */
    @GetMapping("/health")
    public ResponseEntity<String> healthCheck() {
        return ResponseEntity.ok("Raven Download API is up and running!");
    }

    /**
     * Searches for a manga title.
     *
     * @param titleName The title to search.
     * @return SearchTitle object containing possible matches and a generated searchId.
     */
    @GetMapping("/search/{titleName}")
    public ResponseEntity<SearchTitle> searchTitle(@PathVariable String titleName) {
        SearchTitle result = downloadService.searchTitle(titleName);
        return ResponseEntity.ok(result);
    }

    /**
     * Queues downloading of chapters for a selected manga title asynchronously.
     * If optionIndex is 0, queues downloads for all available titles in the search result.
     *
     * @param searchId    The search session ID returned by /search.
     * @param optionIndex The selected option index from the search results (1-based). Use 0 for ALL.
     * @return Status message indicating the queue result.
     */
    @GetMapping("/select/{searchId}/{optionIndex}")
    public ResponseEntity<String> queueDownload(
            @PathVariable String searchId,
            @PathVariable int optionIndex) {

        String result = downloadService.queueDownloadAllChapters(searchId, optionIndex);
        return ResponseEntity.ok(result);
    }
}
