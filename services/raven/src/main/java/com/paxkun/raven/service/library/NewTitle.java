package com.paxkun.raven.service.library;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Represents a manga title.
 * Includes titleName field with Lombok-generated getters, setters, and constructors.
 *
 * @author Pax
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class NewTitle {
    private String titleName;
}
