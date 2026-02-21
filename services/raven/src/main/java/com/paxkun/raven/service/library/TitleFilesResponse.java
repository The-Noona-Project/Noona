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

