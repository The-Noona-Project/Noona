package com.paxkun.raven.service;

import com.google.gson.reflect.TypeToken;
import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.lang.reflect.Type;
import java.util.*;

/**
 * LibraryService manages Raven's manga library via VaultService.
 * Tracks downloaded chapters and triggers downloads for new ones.
 *
 * Author: Pax
 */
@Service
@RequiredArgsConstructor
public class LibraryService {

    private final VaultService vaultService;
    private final @Lazy DownloadService downloadService;
    private final LoggerService logger;

    private static final String COLLECTION = "manga_library";

    public void addOrUpdateTitle(NewTitle title, NewChapter chapter) {
        Map<String, Object> query = Map.of("uuid", title.getUuid());
        Map<String, Object> update = Map.of(
                "$set", Map.of(
                        "uuid", title.getUuid(),
                        "title", title.getTitleName(),
                        "sourceUrl", title.getSourceUrl(),
                        "lastDownloaded", chapter.getChapter()
                )
        );

        vaultService.update(COLLECTION, query, update, true);
        logger.info("LIBRARY", "📚 Updated title [" + title.getTitleName() + "] to chapter " + chapter.getChapter());
    }

    public List<NewTitle> getAllTitleObjects() {
        List<Map<String, Object>> raw = vaultService.findAll(COLLECTION);
        Type listType = new TypeToken<List<NewTitle>>() {}.getType();
        return vaultService.parseDocuments(raw, listType);
    }

    public NewTitle getTitle(String titleName) {
        Map<String, Object> query = Map.of("title", titleName);
        Map<String, Object> doc = vaultService.findOne(COLLECTION, query);
        if (doc == null) return null;

        return new NewTitle(
                (String) doc.get("title"),
                (String) doc.get("uuid"),
                (String) doc.get("sourceUrl"),
                (String) doc.getOrDefault("lastDownloaded", "0")
        );
    }

    public NewTitle resolveOrCreateTitle(String titleName, String sourceUrl) {
        NewTitle existing = getTitle(titleName);
        if (existing != null) {
            boolean needsUpdate = false;
            if (existing.getUuid() == null || existing.getUuid().isBlank()) {
                existing.setUuid(UUID.randomUUID().toString());
                needsUpdate = true;
            }
            if (sourceUrl != null && (existing.getSourceUrl() == null || existing.getSourceUrl().isBlank())) {
                existing.setSourceUrl(sourceUrl);
                needsUpdate = true;
            }
            if (needsUpdate) {
                addOrUpdateTitle(existing, new NewChapter(Optional.ofNullable(existing.getLastDownloaded()).orElse("0")));
            }
            return existing;
        }

        NewTitle created = new NewTitle(titleName, UUID.randomUUID().toString(), sourceUrl, "0");
        addOrUpdateTitle(created, new NewChapter("0"));
        return created;
    }

    public String checkForNewChapters() {
        List<NewTitle> titles = getAllTitleObjects();
        if (titles.isEmpty()) {
            logger.warn("LIBRARY", "⚠️ No titles in Vault to check.");
            return "No titles in Vault.";
        }

        int updated = 0;
        for (NewTitle title : titles) {
            try {
                String sourceUrl = title.getSourceUrl();
                String latest = vaultService.fetchLatestChapterFromSource(sourceUrl);
                String last = Optional.ofNullable(title.getLastDownloaded()).orElse("0");

                if (isNewer(latest, last)) {
                    logger.info("LIBRARY", "⬆️ New chapter found for " + title.getTitleName() + ": " + latest);
                    downloadService.downloadSingleChapter(title, latest);

                    title.setLastDownloaded(latest);
                    addOrUpdateTitle(title, new NewChapter(latest));
                    updated++;
                } else {
                    logger.info("LIBRARY", "✅ No update needed for " + title.getTitleName());
                }

            } catch (Exception e) {
                logger.warn("LIBRARY", "⚠️ Failed to check/update " + title.getTitleName() + ": " + e.getMessage());
            }
        }

        return updated == 0 ? "✅ All titles up-to-date." : "⬇️ Downloaded " + updated + " new chapters.";
    }

    private boolean isNewer(String latest, String current) {
        try {
            return Float.parseFloat(latest) > Float.parseFloat(current);
        } catch (NumberFormatException e) {
            return !latest.equals(current);
        }
    }
}
