package com.paxkun.raven.service.download;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a search result for a manga or webtoon title.
 * Contains a search ID and title name for selection workflows.
 *
 * @author Pax
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SearchTitle {

    private String searchId;
    private String titleName;

}
