package com.paxkun.raven.service.download;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * SearchTitle represents the result of a manga title search operation.
 * Contains a generated searchId to track the session and a list of options,
 * each option being a map with keys such as:
 * - "index": option number
 * - "title": manga title
 * - "href": URL to the manga page.
 *
 * Author: Pax
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SearchTitle {

    /** Unique search session ID for this search request. */
    private String searchId;

    /** List of search result options, each as a map with "index", "title", "href". */
    private List<Map<String, String>> options;
}
