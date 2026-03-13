package com.paxkun.raven.service.download;

import java.util.*;

/**
 * Thread-safe download progress DTO that captures the current state of an
 * ongoing or recently completed download job.
 */
public class DownloadProgress {

    private final String title;
    private final long queuedAt;

    private String taskId;
    private String taskType;
    private String titleUuid;
    private String sourceUrl;
    private String mediaType;
    private String coverUrl;
    private String summary;
    private int totalChapters;
    private int sourceChapterCount;
    private int completedChapters;
    private String currentChapter;
    private String currentChapterNumber;
    private String status;
    private String latestChapter;
    private String message;
    private Long startedAt;
    private Long completedAt;
    private String errorMessage;
    private boolean recoveredFromCache;
    private String recoveryState;
    private List<String> queuedChapterNumbers;
    private List<String> completedChapterNumbers;
    private List<String> newChapterNumbers;
    private List<String> missingChapterNumbers;
    private Integer workerIndex;
    private Integer cpuCoreId;
    private Long workerPid;
    private String executionMode;
    private boolean pauseRequested;
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
        this.queuedChapterNumbers = new ArrayList<>();
        this.completedChapterNumbers = new ArrayList<>();
        this.newChapterNumbers = new ArrayList<>();
        this.missingChapterNumbers = new ArrayList<>();
    }

    private DownloadProgress(
            String title,
            long queuedAt,
            String taskId,
            String taskType,
            String titleUuid,
            String sourceUrl,
            String mediaType,
            String coverUrl,
            String summary,
            int totalChapters,
            int sourceChapterCount,
            int completedChapters,
            String currentChapter,
            String currentChapterNumber,
            String status,
            String latestChapter,
            String message,
            Long startedAt,
            Long completedAt,
            String errorMessage,
            boolean recoveredFromCache,
            String recoveryState,
            List<String> queuedChapterNumbers,
            List<String> completedChapterNumbers,
            List<String> newChapterNumbers,
            List<String> missingChapterNumbers,
            Integer workerIndex,
            Integer cpuCoreId,
            Long workerPid,
            String executionMode,
            boolean pauseRequested,
            long lastUpdated) {
        this.title = title;
        this.queuedAt = queuedAt;
        this.taskId = taskId;
        this.taskType = taskType;
        this.titleUuid = titleUuid;
        this.sourceUrl = sourceUrl;
        this.mediaType = mediaType;
        this.coverUrl = coverUrl;
        this.summary = summary;
        this.totalChapters = totalChapters;
        this.sourceChapterCount = sourceChapterCount;
        this.completedChapters = completedChapters;
        this.currentChapter = currentChapter;
        this.currentChapterNumber = currentChapterNumber;
        this.status = status;
        this.latestChapter = latestChapter;
        this.message = message;
        this.startedAt = startedAt;
        this.completedAt = completedAt;
        this.errorMessage = errorMessage;
        this.recoveredFromCache = recoveredFromCache;
        this.recoveryState = recoveryState;
        this.queuedChapterNumbers = dedupeChapterList(queuedChapterNumbers);
        this.completedChapterNumbers = dedupeChapterList(completedChapterNumbers);
        this.newChapterNumbers = dedupeChapterList(newChapterNumbers);
        this.missingChapterNumbers = dedupeChapterList(missingChapterNumbers);
        this.workerIndex = workerIndex;
        this.cpuCoreId = cpuCoreId;
        this.workerPid = workerPid;
        this.executionMode = executionMode;
        this.pauseRequested = pauseRequested;
        this.lastUpdated = lastUpdated;
    }

    private long now() {
        return System.currentTimeMillis();
    }

    private static List<String> dedupeChapterList(Collection<String> chapters) {
        Set<String> deduped = new LinkedHashSet<>();
        if (chapters != null) {
            for (String chapter : chapters) {
                if (chapter == null) {
                    continue;
                }

                String trimmed = chapter.trim();
                if (!trimmed.isBlank()) {
                    deduped.add(trimmed);
                }
            }
        }

        return new ArrayList<>(deduped);
    }

    public synchronized void ensureTaskId(String fallbackTaskId) {
        if (taskId == null || taskId.isBlank()) {
            taskId = fallbackTaskId;
            this.lastUpdated = now();
        }
    }

    public synchronized void attachTaskContext(
            String nextTaskId,
            String nextTaskType,
            String nextTitleUuid,
            String nextSourceUrl,
            String nextMediaType,
            String nextCoverUrl,
            String nextSummary) {
        if (nextTaskId != null && !nextTaskId.isBlank()) {
            this.taskId = nextTaskId.trim();
        }
        if (nextTaskType != null && !nextTaskType.isBlank()) {
            this.taskType = nextTaskType.trim();
        }
        if (nextTitleUuid != null && !nextTitleUuid.isBlank()) {
            this.titleUuid = nextTitleUuid.trim();
        }
        if (nextSourceUrl != null && !nextSourceUrl.isBlank()) {
            this.sourceUrl = nextSourceUrl.trim();
        }
        if (nextMediaType != null && !nextMediaType.isBlank()) {
            this.mediaType = nextMediaType.trim();
        }
        if (nextCoverUrl != null && !nextCoverUrl.isBlank()) {
            this.coverUrl = nextCoverUrl.trim();
        }
        if (nextSummary != null && !nextSummary.isBlank()) {
            this.summary = nextSummary.trim();
        }
        this.lastUpdated = now();
    }

    public synchronized void applyChapterPlan(
            Collection<String> queuedChapters,
            Collection<String> newChapters,
            Collection<String> missingChapters,
            String nextLatestChapter,
            int nextSourceChapterCount,
            String nextMessage) {
        this.queuedChapterNumbers = dedupeChapterList(queuedChapters);
        this.newChapterNumbers = dedupeChapterList(newChapters);
        this.missingChapterNumbers = dedupeChapterList(missingChapters);
        this.totalChapters = this.queuedChapterNumbers.size();
        this.sourceChapterCount = Math.max(0, nextSourceChapterCount);
        this.latestChapter = nextLatestChapter;
        if (nextMessage != null && !nextMessage.isBlank()) {
            this.message = nextMessage.trim();
        }
        this.lastUpdated = now();
    }

    public synchronized void markStarted(int totalChapters) {
        this.totalChapters = totalChapters;
        this.startedAt = now();
        this.status = "downloading";
        this.pauseRequested = false;
        this.lastUpdated = this.startedAt;
    }

    public synchronized void chapterStarted(String chapterTitle) {
        chapterStarted(chapterTitle, null);
    }

    public synchronized void chapterStarted(String chapterTitle, String chapterNumber) {
        this.currentChapter = chapterTitle;
        this.currentChapterNumber = chapterNumber;
        this.status = "downloading";
        this.lastUpdated = now();
    }

    public synchronized void chapterCompleted() {
        chapterCompleted(null);
    }

    public synchronized void chapterCompleted(String chapterNumber) {
        this.completedChapters++;
        if (chapterNumber != null && !chapterNumber.isBlank()) {
            List<String> nextCompleted = dedupeChapterList(completedChapterNumbers);
            if (!nextCompleted.contains(chapterNumber.trim())) {
                nextCompleted.add(chapterNumber.trim());
            }
            this.completedChapterNumbers = nextCompleted;
        }
        this.lastUpdated = now();
    }

    public synchronized void markCompleted() {
        long now = now();
        this.status = "completed";
        this.pauseRequested = false;
        this.currentChapter = null;
        this.currentChapterNumber = null;
        this.completedAt = now;
        this.lastUpdated = now;
    }

    public synchronized void markFailed(String message) {
        long now = now();
        this.status = "failed";
        this.errorMessage = message;
        this.pauseRequested = false;
        this.currentChapter = null;
        this.currentChapterNumber = null;
        this.completedAt = now;
        this.lastUpdated = now;
    }

    public synchronized void markInterrupted(String message) {
        long now = now();
        this.status = "interrupted";
        this.message = message;
        this.errorMessage = message;
        this.pauseRequested = false;
        this.currentChapter = null;
        this.currentChapterNumber = null;
        this.completedAt = now;
        this.lastUpdated = now;
    }

    public synchronized void markPaused(String message) {
        long now = now();
        this.status = "paused";
        this.message = message;
        this.pauseRequested = true;
        this.errorMessage = null;
        this.currentChapter = null;
        this.currentChapterNumber = null;
        this.completedAt = now;
        this.lastUpdated = now;
    }

    public synchronized void markRecoveredFromCache(String state) {
        this.recoveredFromCache = true;
        this.recoveryState = state;
        this.status = "recovering";
        this.pauseRequested = false;
        this.lastUpdated = now();
    }

    public synchronized void assignWorker(Integer nextWorkerIndex, Integer nextCpuCoreId, Long nextWorkerPid, String nextExecutionMode) {
        this.workerIndex = nextWorkerIndex;
        this.cpuCoreId = nextCpuCoreId;
        this.workerPid = nextWorkerPid;
        if (nextExecutionMode != null && !nextExecutionMode.isBlank()) {
            this.executionMode = nextExecutionMode.trim();
        }
        this.lastUpdated = now();
    }

    public synchronized DownloadProgress copy() {
        return new DownloadProgress(
                title,
                queuedAt,
                taskId,
                taskType,
                titleUuid,
                sourceUrl,
                mediaType,
                coverUrl,
                summary,
                totalChapters,
                sourceChapterCount,
                completedChapters,
                currentChapter,
                currentChapterNumber,
                status,
                latestChapter,
                message,
                startedAt,
                completedAt,
                errorMessage,
                recoveredFromCache,
                recoveryState,
                queuedChapterNumbers,
                completedChapterNumbers,
                newChapterNumbers,
                missingChapterNumbers,
                workerIndex,
                cpuCoreId,
                workerPid,
                executionMode,
                pauseRequested,
                lastUpdated);
    }

    public synchronized boolean hasCompletedChapter(String chapterNumber) {
        if (chapterNumber == null || chapterNumber.isBlank()) {
            return false;
        }
        return completedChapterNumbers.contains(chapterNumber.trim());
    }

    public synchronized List<String> getRemainingChapterNumbers() {
        List<String> remaining = new ArrayList<>();
        for (String chapterNumber : queuedChapterNumbers) {
            if (!completedChapterNumbers.contains(chapterNumber)) {
                remaining.add(chapterNumber);
            }
        }
        return remaining;
    }

    public synchronized Integer getWorkerIndex() {
        return workerIndex;
    }

    public synchronized String getTaskId() {
        return taskId;
    }

    public String getTitle() {
        return title;
    }

    public long getQueuedAt() {
        return queuedAt;
    }

    public synchronized String getTaskType() {
        return taskType;
    }

    public synchronized String getTitleUuid() {
        return titleUuid;
    }

    public synchronized String getSourceUrl() {
        return sourceUrl;
    }

    public synchronized String getMediaType() {
        return mediaType;
    }

    public synchronized String getCoverUrl() {
        return coverUrl;
    }

    public synchronized String getSummary() {
        return summary;
    }

    public synchronized int getSourceChapterCount() {
        return sourceChapterCount;
    }

    public synchronized int getTotalChapters() {
        return totalChapters;
    }

    public synchronized String getCurrentChapterNumber() {
        return currentChapterNumber;
    }

    public synchronized int getCompletedChapters() {
        return completedChapters;
    }

    public synchronized String getCurrentChapter() {
        return currentChapter;
    }

    public synchronized String getLatestChapter() {
        return latestChapter;
    }

    public synchronized String getStatus() {
        return status;
    }

    public synchronized String getMessage() {
        return message;
    }

    public synchronized void setMessage(String message) {
        this.message = message;
        this.lastUpdated = now();
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

    public synchronized boolean isRecoveredFromCache() {
        return recoveredFromCache;
    }

    public synchronized String getRecoveryState() {
        return recoveryState;
    }

    public synchronized List<String> getQueuedChapterNumbers() {
        return new ArrayList<>(queuedChapterNumbers);
    }

    public synchronized List<String> getCompletedChapterNumbers() {
        return new ArrayList<>(completedChapterNumbers);
    }

    public synchronized List<String> getNewChapterNumbers() {
        return new ArrayList<>(newChapterNumbers);
    }

    public synchronized List<String> getMissingChapterNumbers() {
        return new ArrayList<>(missingChapterNumbers);
    }

    public synchronized Integer getCpuCoreId() {
        return cpuCoreId;
    }

    public synchronized Long getWorkerPid() {
        return workerPid;
    }

    public synchronized String getExecutionMode() {
        return executionMode;
    }

    public synchronized boolean isPauseRequested() {
        return pauseRequested;
    }

    public synchronized void setPauseRequested(boolean pauseRequested) {
        this.pauseRequested = pauseRequested;
        this.lastUpdated = now();
    }

    public synchronized long getLastUpdated() {
        return lastUpdated;
    }
}
