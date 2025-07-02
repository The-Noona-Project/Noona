package com.paxkun.raven.service.download;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents the result of downloading a chapter.
 * Contains chapter name and download status.
 *
 * @author Pax
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DownloadChapter {

    private String chapterName;
    private String status;

}
