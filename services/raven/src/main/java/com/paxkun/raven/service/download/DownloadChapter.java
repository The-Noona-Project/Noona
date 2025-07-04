package com.paxkun.raven.service.download;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Represents the result of downloading chapters.
 * Contains title name, status, and optionally a list of chapter statuses.
 * <p>
 * Author: Pax
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DownloadChapter {
    private String chapterName;
    private String status;

    /**
     * List of individual chapter download statuses (for full downloads).
     * Each entry can be "Chapter X: ✅ Success" or "Chapter X: ❌ Failed".
     */
    private List<String> chapterStatuses;

    public DownloadChapter(String chapterName, String status) {
        this.chapterName = chapterName;
        this.status = status;
    }
}
