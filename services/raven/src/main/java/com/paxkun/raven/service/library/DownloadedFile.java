/**
 * Encapsulates Raven downloaded file behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/controller/LibraryController.java
 * Times this file has been edited: 2
 */
package com.paxkun.raven.service.library;

/**
 * Metadata for a downloaded file stored under the Raven downloads root.
 */
public record DownloadedFile(
        String name,
        long sizeBytes,
        long modifiedAtMs,
        String modifiedAt
) {
}

