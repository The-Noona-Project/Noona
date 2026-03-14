/**
 * Represents the request payload for download search.
 * Related files:
 * - src/main/java/com/paxkun/raven/controller/DownloadController.java
 * Times this file has been edited: 1
 */
package com.paxkun.raven.service.download;

/**
 * Represents the request payload for download search.
 *
 * @param query The query document.
 */

public record DownloadSearchRequest(String query) {
}
