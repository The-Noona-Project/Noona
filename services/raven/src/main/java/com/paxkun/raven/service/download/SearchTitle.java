package com.paxkun.raven.service.download;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Represents a search result with an ID and list of manga options.
 *
 * @author Pax
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class SearchTitle {
    private String searchId;
    private List<Map<String, String>> options;
}
