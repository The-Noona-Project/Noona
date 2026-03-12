package com.paxkun.raven.service.download;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TitleDetails {
    private String sourceUrl;
    private String summary;
    private String type;
    private Boolean adultContent;
    private List<String> associatedNames;
    private String status;
    private String released;
    private Boolean officialTranslation;
    private Boolean animeAdaptation;
    private List<Map<String, String>> relatedSeries;
}
