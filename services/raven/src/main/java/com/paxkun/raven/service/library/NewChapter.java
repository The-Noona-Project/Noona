/**
 * Encapsulates Raven new chapter behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/DownloadService.java
 * - src/main/java/com/paxkun/raven/service/LibraryService.java
 * - src/test/java/com/paxkun/raven/service/DownloadServiceTest.java
 * - src/test/java/com/paxkun/raven/service/LibraryServiceTest.java
 * Times this file has been edited: 5
 */
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

    /**
     * Creates a new new chapter instance.
     *
     * @param chapter The chapter.
     */

    public NewChapter(String chapter) {
        this.chapter = chapter;
    }
}
