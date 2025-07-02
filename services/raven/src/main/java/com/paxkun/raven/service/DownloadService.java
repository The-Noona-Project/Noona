package com.paxkun.raven.service;

import com.paxkun.raven.service.download.DownloadChapter;
import com.paxkun.raven.service.download.SearchTitle;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * Service class handling download operations.
 * Provides title searching and chapter downloading logic.
 */
@Service
@RequiredArgsConstructor
public class DownloadService {

    /**
     * Searches for a title and returns possible matches.
     *
     * @param titleName The title to search for.
     * @return A SearchTitle object containing the searchId and title name.
     */
    public SearchTitle searchTitle(String titleName) {
        // 🔧 Using the all-args constructor with example searchId.
        return new SearchTitle("exampleSearchId", titleName);
    }

    /**
     * Downloads the selected title's chapter based on searchId and optionIndex.
     *
     * @param searchId    The search ID returned from title search.
     * @param optionIndex The index of the chosen option to download.
     * @return A DownloadChapter object with download result details.
     */
    public DownloadChapter downloadSelectedTitle(String searchId, int optionIndex) {
        // 🔧 Using the all-args constructor with example chapter and status.
        return new DownloadChapter("Chapter 1", "Downloaded successfully");
    }
}
