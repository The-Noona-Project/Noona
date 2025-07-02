package com.paxkun.raven.service.library;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Represents a new title entry in the user's library.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class NewTitle {

    /** Name of the manga, webtoon, or light novel. */
    private String title;

    /** Author of the title if available. */
    private String author;

    /** List of chapters under this title. */
    private List<NewChapter> chapters;
}
