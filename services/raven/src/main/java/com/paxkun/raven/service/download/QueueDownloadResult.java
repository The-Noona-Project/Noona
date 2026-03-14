/**
 * Represents the result of queue download.
 * Related files:
 * - src/main/java/com/paxkun/raven/controller/DownloadController.java
 * - src/test/java/com/paxkun/raven/controller/DownloadControllerTest.java
 * - src/test/java/com/paxkun/raven/service/DownloadServiceTest.java
 * Times this file has been edited: 1
 */
package com.paxkun.raven.service.download;

import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Represents the result of queue download.
 */

@Data
@NoArgsConstructor
public class QueueDownloadResult {

    public static final String STATUS_QUEUED = "queued";
    public static final String STATUS_PARTIAL = "partial";
    public static final String STATUS_SEARCH_EXPIRED = "search_expired";
    public static final String STATUS_INVALID_SELECTION = "invalid_selection";
    public static final String STATUS_ALREADY_ACTIVE = "already_active";
    public static final String STATUS_MAINTENANCE_PAUSED = "maintenance_paused";
    public static final String STATUS_EMPTY_RESULTS = "empty_results";

    private String status;
    private String message;
    private int queuedCount;
    private List<String> queuedTitles = List.of();
    private List<String> skippedTitles = List.of();

    /**
     * Creates a new queue download result instance.
     *
     * @param status        The status.
     * @param message       The message to store.
     * @param queuedCount   The queued count.
     * @param queuedTitles  The queued titles.
     * @param skippedTitles The skipped titles.
     */

    public QueueDownloadResult(String status, String message, int queuedCount, List<String> queuedTitles, List<String> skippedTitles) {
        this.status = status;
        this.message = message;
        this.queuedCount = queuedCount;
        this.queuedTitles = normalizeList(queuedTitles);
        this.skippedTitles = normalizeList(skippedTitles);
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

    public boolean isAccepted() {
        return STATUS_QUEUED.equals(status) || STATUS_PARTIAL.equals(status);
    }
}
