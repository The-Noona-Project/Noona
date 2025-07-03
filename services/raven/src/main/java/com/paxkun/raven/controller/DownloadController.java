package com.paxkun.raven.controller;

import com.paxkun.raven.service.DownloadService;
import com.paxkun.raven.service.download.DownloadChapter;
import com.paxkun.raven.service.download.SearchTitle;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * DownloadController handles endpoints for searching and downloading manga titles and chapters.
 *
 * Note: The download endpoint triggers a download operation with file writing.
 * While it currently uses GET for convenience in internal tools, POST is preferred
 * for non-idempotent write operations in public REST APIs.
 */
@RestController
@RequestMapping("/v1/download")
@RequiredArgsConstructor
public class DownloadController {

    private final DownloadService downloadService;

    /**
     * Health check endpoint for Raven's download module.
     *
     * @return a simple "OK" response if the service is up
     */
    @GetMapping("/health")
    public ResponseEntity<String> healthCheck() {
        return ResponseEntity.ok("Raven Download API is up and running!");
    }

    /**
     * Search for a manga title.
     *
     * @param titleName the title to search for
     * @return SearchTitle object containing possible matches and a generated searchId
     */
    @GetMapping("/search/{titleName}")
    public ResponseEntity<SearchTitle> searchTitle(@PathVariable String titleName) {
        SearchTitle result = downloadService.searchTitle(titleName);
        return ResponseEntity.ok(result);
    }

    /**
     * Download a chapter for a previously searched manga.
     * <p>
     * Note: This endpoint performs a write action (download + save as CBZ) but is using GET
     * for simplicity. For production/public APIs, consider changing to POST.
     *
     * @param searchId the search session ID returned by /search
     * @param optionIndex the selected option index from the search results (1-based index)
     * @return DownloadChapter result with status
     */
    @GetMapping("/select/{searchId}/{optionIndex}")
    public ResponseEntity<DownloadChapter> downloadChapter(
            @PathVariable String searchId,
            @PathVariable int optionIndex) {

        DownloadChapter result = downloadService.downloadSelectedTitle(searchId, optionIndex);
        return ResponseEntity.ok(result);
    }
}
