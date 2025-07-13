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

    public NewChapter(String titleName, String latest, String s) {
    }
}
