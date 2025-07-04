package com.paxkun.raven.service.library;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a chapter entry saved in the library.
 * <p>
 * Author: Pax
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class NewChapter {

    /** The title of this chapter belongs to. */
    private String title;

    /** The chapter identifier (number or name). */
    private String chapter;

    /** The file path where the chapter is downloaded. */
    private String path;
}
