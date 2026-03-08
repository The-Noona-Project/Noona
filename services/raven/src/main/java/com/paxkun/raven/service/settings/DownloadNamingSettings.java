package com.paxkun.raven.service.settings;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Download naming settings stored in Vault (Mongo).
 * <p>
 * Templates support placeholders like:
 * - {title}, {type}
 * - {chapter}, {chapter_padded} ({chapter} follows the configured chapter padding)
 * - {page}, {page_padded}, {ext}
 * - {pages}, {domain}
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DownloadNamingSettings {
    private String key;
    private String titleTemplate;
    private String chapterTemplate;
    private String pageTemplate;
    private Integer pagePad;
    private Integer chapterPad;
}
