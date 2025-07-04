package com.paxkun.raven.service.library;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a manga title in the library.
 * Includes titleName field with Lombok-generated getters, setters, and constructors.
 * <p>
 * Author: Pax
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class NewTitle {

    /** The name of the manga title. */
    private String titleName;
}
