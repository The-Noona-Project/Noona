/**
 * Represents the request payload for Raven bulk queue download.
 * Related files:
 * - src/main/java/com/paxkun/raven/controller/DownloadController.java
 * - src/main/java/com/paxkun/raven/service/download/BulkQueueDownloadResult.java
 * Times this file has been edited: 1
 */
package com.paxkun.raven.service.download;

/**
 * Represents the request payload for Raven bulk queue download.
 *
 * @param type        The content type filter.
 * @param nsfw        Whether adult-only titles should be included.
 * @param titlePrefix The visible title prefix filter.
 */
public record BulkQueueDownloadRequest(String type, Boolean nsfw, String titlePrefix) {
}
