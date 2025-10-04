package com.paxkun.raven.service.library;

import com.google.gson.annotations.SerializedName;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a manga title stored in the Raven library.
 * Includes title metadata and progress tracking for downloads.
 *
 * Author: Pax
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class NewTitle {

    /** The human-readable name of the manga title. */
    @SerializedName("title")
    private String titleName;

    /** Unique UUID assigned when the title is first added. */
    private String uuid;

    /** Source URL used for scraping chapter list. */
    private String sourceUrl;

    /** Last downloaded chapter number (used for update checking). */
    private String lastDownloaded;
}
