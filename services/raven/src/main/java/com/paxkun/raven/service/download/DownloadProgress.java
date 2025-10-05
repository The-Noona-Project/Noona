package com.paxkun.raven.service.download;

/**
 * Thread-safe download progress DTO that captures the current state of an
 * ongoing or recently completed download job.
 */
public class DownloadProgress {

    private final String title;
    private final long queuedAt;

    private int totalChapters;
    private int completedChapters;
    private String currentChapter;
    private String status;
    private Long startedAt;
    private Long completedAt;
    private String errorMessage;
    private long lastUpdated;

    /**
     * Creates a new progress tracker for the provided title, defaulting the
     * status to {@code queued}.
     */
    public DownloadProgress(String title) {
        long now = System.currentTimeMillis();
        this.title = title;
        this.status = "queued";
        this.queuedAt = now;
        this.lastUpdated = now;
    }

    private DownloadProgress(
            String title,
            long queuedAt,
            int totalChapters,
            int completedChapters,
            String currentChapter,
            String status,
            Long startedAt,
            Long completedAt,
            String errorMessage,
            long lastUpdated) {
        this.title = title;
        this.queuedAt = queuedAt;
        this.totalChapters = totalChapters;
        this.completedChapters = completedChapters;
        this.currentChapter = currentChapter;
        this.status = status;
        this.startedAt = startedAt;
        this.completedAt = completedAt;
        this.errorMessage = errorMessage;
        this.lastUpdated = lastUpdated;
    }

    private long now() {
        return System.currentTimeMillis();
    }

    public synchronized void markStarted(int totalChapters) {
        this.totalChapters = totalChapters;
        this.startedAt = now();
        this.status = "downloading";
        this.lastUpdated = this.startedAt;
    }

    public synchronized void chapterStarted(String chapterTitle) {
        this.currentChapter = chapterTitle;
        this.status = "downloading";
        this.lastUpdated = now();
    }

    public synchronized void chapterCompleted() {
        this.completedChapters++;
        this.lastUpdated = now();
    }

    public synchronized void markCompleted() {
        long now = now();
        this.status = "completed";
        this.currentChapter = null;
        this.completedAt = now;
        this.lastUpdated = now;
    }

    public synchronized void markFailed(String message) {
        long now = now();
        this.status = "failed";
        this.errorMessage = message;
        this.currentChapter = null;
        this.completedAt = now;
        this.lastUpdated = now;
    }

    public synchronized DownloadProgress copy() {
        return new DownloadProgress(
                title,
                queuedAt,
                totalChapters,
                completedChapters,
                currentChapter,
                status,
                startedAt,
                completedAt,
                errorMessage,
                lastUpdated);
    }

    public String getTitle() {
        return title;
    }

    public long getQueuedAt() {
        return queuedAt;
    }

    public synchronized int getTotalChapters() {
        return totalChapters;
    }

    public synchronized int getCompletedChapters() {
        return completedChapters;
    }

    public synchronized String getCurrentChapter() {
        return currentChapter;
    }

    public synchronized String getStatus() {
        return status;
    }

    public synchronized Long getStartedAt() {
        return startedAt;
    }

    public synchronized Long getCompletedAt() {
        return completedAt;
    }

    public synchronized String getErrorMessage() {
        return errorMessage;
    }

    public synchronized long getLastUpdated() {
        return lastUpdated;
    }
}
