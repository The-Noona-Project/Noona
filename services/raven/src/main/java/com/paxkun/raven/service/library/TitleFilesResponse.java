/**
 * Represents the response payload for title files.
 * Related files:
 * - src/main/java/com/paxkun/raven/controller/LibraryController.java
 * Times this file has been edited: 2
 */
package com.paxkun.raven.service.library;

import java.util.List;

/**
 * Response payload for listing downloaded files for a title.
 */
public record TitleFilesResponse(
        String uuid,
        String title,
        List<DownloadedFile> files
) {
}

