/**
 * Represents the result of Raven bulk queue download.
 * Related files:
 * - src/main/java/com/paxkun/raven/controller/DownloadController.java
 * - src/main/java/com/paxkun/raven/service/DownloadService.java
 * Times this file has been edited: 1
 */
package com.paxkun.raven.service.download;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Represents the result of Raven bulk queue download.
 */
@Data
@NoArgsConstructor
public class BulkQueueDownloadResult {

    public static final String STATUS_QUEUED = "queued";
    public static final String STATUS_PARTIAL = "partial";
    public static final String STATUS_ALREADY_ACTIVE = "already_active";
    public static final String STATUS_EMPTY_RESULTS = "empty_results";
    public static final String STATUS_INVALID_REQUEST = "invalid_request";
    public static final String STATUS_MAINTENANCE_PAUSED = "maintenance_paused";

    private String status;
    private String message;
    private Filters filters = new Filters();
    private int pagesScanned;
    private int matchedCount;
    private int queuedCount;
    private int skippedActiveCount;
    private int failedCount;
    private List<String> queuedTitles = List.of();
    private List<String> skippedActiveTitles = List.of();
    private List<String> failedTitles = List.of();

    /**
     * Creates a new Raven bulk queue result instance.
     *
     * @param status              The status value.
     * @param message             The message to store.
     * @param filters             The applied filters.
     * @param pagesScanned        The number of browse pages fetched from the source.
     * @param matchedCount        The number of titles matching the supplied prefix.
     * @param queuedCount         The number of titles queued.
     * @param skippedActiveCount  The number of titles skipped because they were already active.
     * @param failedCount         The number of titles that could not be queued.
     * @param queuedTitles        The queued title names.
     * @param skippedActiveTitles The skipped title names.
     * @param failedTitles        The failed title names.
     */
    public BulkQueueDownloadResult(
            String status,
            String message,
            Filters filters,
            int pagesScanned,
            int matchedCount,
            int queuedCount,
            int skippedActiveCount,
            int failedCount,
            List<String> queuedTitles,
            List<String> skippedActiveTitles,
            List<String> failedTitles
    ) {
        this.status = status;
        this.message = message;
        this.filters = filters == null ? new Filters() : filters;
        this.pagesScanned = Math.max(0, pagesScanned);
        this.matchedCount = Math.max(0, matchedCount);
        this.queuedCount = Math.max(0, queuedCount);
        this.skippedActiveCount = Math.max(0, skippedActiveCount);
        this.failedCount = Math.max(0, failedCount);
        this.queuedTitles = normalizeList(queuedTitles);
        this.skippedActiveTitles = normalizeList(skippedActiveTitles);
        this.failedTitles = normalizeList(failedTitles);
    }

    private static List<String> normalizeList(List<String> values) {
        if (values == null || values.isEmpty()) {
            return List.of();
        }

        List<String> normalized = new ArrayList<>();
        for (String value : values) {
            if (value == null) {
                continue;
            }

            String trimmed = value.trim();
            if (!trimmed.isEmpty()) {
                normalized.add(trimmed);
            }
        }

        return normalized.isEmpty() ? List.of() : List.copyOf(normalized);
    }

    /**
     * Stores the filters applied to Raven bulk queue requests.
     */
    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Filters {
        private String type;
        private boolean nsfw;
        private String titlePrefix;
    }
}
