package com.paxkun.raven.service.library;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a newly discovered or downloaded chapter.
 * Typically used during library updates and Vault sync.
 *
 * Author: Pax
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class NewChapter {

    /** Chapter identifier (e.g. "101", "12.5", etc). */
    private String chapter;

    /** Title this chapter belongs to (optional for logging). */
    private String titleName;

    /** Downloaded file path (can be empty for updates). */
    private String path;

    // Convenience constructor if only a chapter number is needed
    public NewChapter(String chapter) {
        this.chapter = chapter;
    }
}
