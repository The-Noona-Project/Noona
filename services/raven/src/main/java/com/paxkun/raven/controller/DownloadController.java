package com.paxkun.raven.controller;

import com.paxkun.raven.service.DownloadService;
import com.paxkun.raven.service.LibraryService;
import com.paxkun.raven.service.LoggerService;
import com.paxkun.raven.service.download.DownloadProgress;
import com.paxkun.raven.service.download.SearchTitle;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

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
    private final LibraryService libraryService;
    private final LoggerService logger;

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
        String sanitizedTitle = sanitizeForLog(titleName);
        logger.debug("DOWNLOAD_CONTROLLER", "Request received to search title: " + sanitizedTitle);
        SearchTitle result = downloadService.searchTitle(titleName);
        String sanitizedSearchId = result != null ? sanitizeForLog(result.getSearchId()) : "";
        int optionCount = result != null && result.getOptions() != null ? result.getOptions().size() : 0;
        logger.debug(
                "DOWNLOAD_CONTROLLER",
                "Search completed for query: " + sanitizedTitle +
                        " | searchId=" + sanitizedSearchId +
                        " | options=" + optionCount);
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
        String sanitizedSearchId = sanitizeForLog(searchId);
        logger.debug(
                "DOWNLOAD_CONTROLLER",
                "Queue request received | searchId=" + sanitizedSearchId + " | optionIndex=" + optionIndex);
        String result = downloadService.queueDownloadAllChapters(searchId, optionIndex);
        logger.debug(
                "DOWNLOAD_CONTROLLER",
                "Queue response | searchId=" + sanitizedSearchId +
                        " | optionIndex=" + optionIndex +
                        " | message=" + sanitizeForLog(result));
        return ResponseEntity.ok(result);
    }

    /**
     * Retrieves the current download queue and recently completed jobs.
     *
     * @return List of {@link DownloadProgress} entries.
     */
    @GetMapping("/status")
    public ResponseEntity<List<DownloadProgress>> getStatus() {
        logger.debug("DOWNLOAD_CONTROLLER", "Status request received");
        List<DownloadProgress> status = downloadService.getDownloadStatuses();
        logger.debug(
                "DOWNLOAD_CONTROLLER",
                "Returning " + status.size() + " progress entries");
        return ResponseEntity.ok(status);
    }

    @GetMapping("/status/history")
    public ResponseEntity<List<DownloadProgress>> getHistory() {
        logger.debug("DOWNLOAD_CONTROLLER", "History request received");
        List<DownloadProgress> history = downloadService.getDownloadHistory();
        return ResponseEntity.ok(history);
    }

    @GetMapping("/status/summary")
    public ResponseEntity<Map<String, Object>> getStatusSummary() {
        logger.debug("DOWNLOAD_CONTROLLER", "Status summary request received");
        DownloadProgress currentDownload = downloadService.getPrimaryActiveDownloadStatus();
        DownloadProgress currentTask = downloadService.getCurrentTaskSnapshot();
        LibraryService.CheckActivity currentCheck = libraryService.getCurrentCheckActivity();

        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("activeDownloads", downloadService.getActiveDownloadCount());
        payload.put("maxThreads", downloadService.getConfiguredDownloadThreads());
        payload.put("threadRateLimitsKbps", downloadService.getThreadRateLimitsKbps());
        if (currentTask != null) {
            payload.put("currentTask", toTaskPayload(currentTask));
        }

        if (currentDownload != null) {
            payload.put("state", "downloading");
            payload.put("statusText", "Downloading " + currentDownload.getTitle());
            payload.put("currentDownload", toTaskPayload(currentDownload));
        } else if (currentCheck != null) {
            Map<String, Object> currentCheckPayload = new java.util.LinkedHashMap<>();
            currentCheckPayload.put("mode", currentCheck.mode());
            currentCheckPayload.put("title", currentCheck.title());
            currentCheckPayload.put("checkedTitles", currentCheck.checkedTitles());
            currentCheckPayload.put("totalTitles", currentCheck.totalTitles());
            currentCheckPayload.put("updatedAt", currentCheck.updatedAt());

            payload.put("state", "checking");
            payload.put("statusText", "Checking " + currentCheck.title());
            payload.put("currentCheck", currentCheckPayload);
        } else if (currentTask != null) {
            String status = currentTask.getStatus() == null ? "idle" : currentTask.getStatus();
            payload.put("state", status.toLowerCase());
            payload.put("statusText", buildTaskStatusText(currentTask));
        } else {
            payload.put("state", "idle");
            payload.put("statusText", "Idle");
        }

        return ResponseEntity.ok(payload);
    }

    @PostMapping("/pause")
    public ResponseEntity<Map<String, Object>> pauseDownloads() {
        logger.debug("DOWNLOAD_CONTROLLER", "Pause request received");
        DownloadService.PauseRequestResult result = downloadService.requestPauseActiveDownloads();

        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("affectedTasks", result.getAffectedTasks());
        payload.put("pausedImmediately", result.pausedImmediately());
        payload.put("pausingAfterCurrentChapter", result.pausingAfterCurrentChapter());
        if (result.getAffectedTasks() == 0) {
            payload.put("message", "No active Raven downloads were available to pause.");
        } else if (result.pausingAfterCurrentChapter().isEmpty()) {
            payload.put("message", "Paused " + result.getAffectedTasks() + " Raven task(s).");
        } else {
            payload.put("message", "Pause queued. Raven will stop " + result.pausingAfterCurrentChapter().size()
                    + " task(s) after the current chapter completes.");
        }
        return ResponseEntity.accepted().body(payload);
    }

    /**
     * Clears an existing progress entry, allowing stale history to be removed.
     *
     * @param titleName Title whose progress entry should be cleared.
     * @return Empty response with 204 status.
     */
    @DeleteMapping("/status/{titleName}")
    public ResponseEntity<Void> clearStatus(@PathVariable String titleName) {
        String sanitizedTitle = sanitizeForLog(titleName);
        logger.debug("DOWNLOAD_CONTROLLER", "Clearing status for title=" + sanitizedTitle);
        downloadService.clearDownloadStatus(titleName);
        return ResponseEntity.noContent().build();
    }

    private String sanitizeForLog(String value) {
        if (value == null) {
            return "";
        }
        return value.replaceAll("[\\r\\n]", "").replaceAll("[^\\p{Alnum}\\s_-]", "").trim();
    }

    private Map<String, Object> toTaskPayload(DownloadProgress progress) {
        Map<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("taskId", progress.getTaskId());
        payload.put("taskType", progress.getTaskType());
        payload.put("title", progress.getTitle());
        payload.put("titleUuid", progress.getTitleUuid());
        payload.put("currentChapter", progress.getCurrentChapter());
        payload.put("currentChapterNumber", progress.getCurrentChapterNumber());
        payload.put("completedChapters", progress.getCompletedChapters());
        payload.put("totalChapters", progress.getTotalChapters());
        payload.put("sourceChapterCount", progress.getSourceChapterCount());
        payload.put("status", progress.getStatus());
        payload.put("queuedAt", progress.getQueuedAt());
        payload.put("lastUpdated", progress.getLastUpdated());
        payload.put("latestChapter", progress.getLatestChapter());
        payload.put("message", progress.getMessage());
        payload.put("errorMessage", progress.getErrorMessage());
        payload.put("recoveredFromCache", progress.isRecoveredFromCache());
        payload.put("recoveryState", progress.getRecoveryState());
        payload.put("queuedChapterNumbers", progress.getQueuedChapterNumbers());
        payload.put("completedChapterNumbers", progress.getCompletedChapterNumbers());
        payload.put("remainingChapterNumbers", progress.getRemainingChapterNumbers());
        payload.put("newChapterNumbers", progress.getNewChapterNumbers());
        payload.put("missingChapterNumbers", progress.getMissingChapterNumbers());
        return payload;
    }

    private String buildTaskStatusText(DownloadProgress progress) {
        String title = progress.getTitle() == null || progress.getTitle().isBlank() ? "download task" : progress.getTitle();
        String status = progress.getStatus() == null ? "idle" : progress.getStatus().trim().toLowerCase();
        return switch (status) {
            case "completed" -> "Completed " + title;
            case "failed" -> "Failed " + title;
            case "interrupted" -> "Interrupted " + title;
            case "paused" -> "Paused " + title;
            case "recovering" -> "Recovering " + title;
            case "queued" -> "Queued " + title;
            default -> "Tracking " + title;
        };
    }
}
