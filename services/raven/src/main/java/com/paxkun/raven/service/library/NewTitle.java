package com.paxkun.raven.service.library;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.google.gson.annotations.SerializedName;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

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
    @JsonProperty("title")
    @JsonAlias("titleName")
    @SerializedName(value = "title")
    private String titleName;

    /** Unique UUID assigned when the title is first added. */
    private String uuid;

    /** Source URL used for scraping chapter list. */
    private String sourceUrl;

    /** Last downloaded chapter number (used for update checking). */
    private String lastDownloaded;

    /**
     * Timestamp (ISO-8601) when the last chapter update was recorded.
     */
    private String lastDownloadedAt;

    /**
     * Total chapters discovered for this title at the time of the latest download run.
     */
    private Integer chapterCount;

    /**
     * Chapters downloaded (or processed) during the latest download run.
     */
    private Integer chaptersDownloaded;

    /**
     * Download folder path (inside the container) where Raven stores files for this title.
     */
    private String downloadPath;

    /**
     * Optional summary/description scraped from the source site.
     */
    private String summary;

    /**
     * Optional cover image URL scraped from the source site.
     */
    private String coverUrl;

    /**
     * Optional title type scraped from the source site (ex: Manga, Manhwa).
     */
    private String type;

    /**
     * Alternate names listed on the source title page.
     */
    private List<String> associatedNames;

    /**
     * Source-site release status (ex: Ongoing, Complete).
     */
    private String status;

    /**
     * Source-site release year or label.
     */
    private String released;

    /**
     * Whether the source marks this title as officially translated.
     */
    private Boolean officialTranslation;

    /**
     * Whether the source marks this title as having an anime adaptation.
     */
    private Boolean animeAdaptation;

    /**
     * Related series links scraped from the source title page.
     */
    private List<Map<String, String>> relatedSeries;

    /**
     * Canonical downloaded chapter index used for missing-chapter detection.
     */
    private List<String> downloadedChapterNumbers;
}
