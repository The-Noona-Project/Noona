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

