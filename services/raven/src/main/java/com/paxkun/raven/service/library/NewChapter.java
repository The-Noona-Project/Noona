package com.paxkun.raven.service.library;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a new chapter entry to be saved in the library.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class NewChapter {

    /** Title name the chapter belongs to. */
    private String title;

    /** Chapter number or name. */
    private String chapter;

    /** Downloaded file path. */
    private String path;
}
