package com.paxkun.raven.service;

import com.google.gson.reflect.TypeToken;
import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.lang.reflect.Type;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Stream;

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
    private static final DateTimeFormatter ISO_FORMATTER = DateTimeFormatter.ISO_INSTANT;

    public void addOrUpdateTitle(NewTitle title, NewChapter chapter) {
        Map<String, Object> query = Map.of("uuid", title.getUuid());
        String now = ISO_FORMATTER.format(Instant.now());

        Map<String, Object> set = new HashMap<>();
        set.put("uuid", title.getUuid());
        set.put("title", title.getTitleName());
        set.put("sourceUrl", title.getSourceUrl());
        set.put("lastDownloaded", chapter.getChapter());
        set.put("lastDownloadedAt", now);

        if (title.getChapterCount() != null) {
            set.put("chapterCount", title.getChapterCount());
        }

        if (title.getChaptersDownloaded() != null) {
            set.put("chaptersDownloaded", title.getChaptersDownloaded());
        }

        String downloadPath = title.getDownloadPath();
        if (downloadPath == null || downloadPath.isBlank()) {
            downloadPath = resolveDownloadPath(title.getTitleName());
        }
        if (downloadPath != null && !downloadPath.isBlank()) {
            set.put("downloadPath", downloadPath);
            title.setDownloadPath(downloadPath);
        }

        if (title.getSummary() != null && !title.getSummary().isBlank()) {
            set.put("summary", title.getSummary());
        }

        title.setLastDownloadedAt(now);

        Map<String, Object> update = Map.of("$set", set);

        vaultService.update(COLLECTION, query, update, true);
        logger.info("LIBRARY", "📚 Updated title [" + title.getTitleName() + "] to chapter " + chapter.getChapter());
    }

    public List<NewTitle> getAllTitleObjects() {
        Map<String, Object> activeQuery = Map.of("deletedAt", Map.of("$exists", false));
        List<Map<String, Object>> raw = vaultService.findMany(COLLECTION, activeQuery);
        Type listType = new TypeToken<List<NewTitle>>() {}.getType();
        return vaultService.parseDocuments(raw, listType);
    }

    public NewTitle getTitle(String titleName) {
        Map<String, Object> query = Map.of(
                "title", titleName,
                "deletedAt", Map.of("$exists", false)
        );
        Map<String, Object> doc = vaultService.findOne(COLLECTION, query);
        if (doc == null) return null;

        return vaultService.parseJson(doc, NewTitle.class);
    }

    public NewTitle getTitleByUuid(String uuid) {
        if (uuid == null || uuid.isBlank()) {
            return null;
        }

        Map<String, Object> query = Map.of(
                "uuid", uuid,
                "deletedAt", Map.of("$exists", false)
        );
        Map<String, Object> doc = vaultService.findOne(COLLECTION, query);
        if (doc == null) return null;

        return vaultService.parseJson(doc, NewTitle.class);
    }

    public NewTitle updateTitle(String uuid, String titleName, String sourceUrl) {
        NewTitle existing = getTitleByUuid(uuid);
        if (existing == null) {
            return null;
        }

        if (titleName != null && !titleName.isBlank()) {
            existing.setTitleName(titleName);
        }

        if (sourceUrl != null && !sourceUrl.isBlank()) {
            existing.setSourceUrl(sourceUrl);
        }

        String chapter = Optional.ofNullable(existing.getLastDownloaded()).orElse("0");
        addOrUpdateTitle(existing, new NewChapter(chapter));
        return existing;
    }

    public boolean deleteTitle(String uuid) {
        NewTitle existing = getTitleByUuid(uuid);
        if (existing == null) {
            return false;
        }

        Map<String, Object> query = Map.of("uuid", uuid);
        Map<String, Object> update = Map.of(
                "$set", Map.of(
                        "deletedAt", ISO_FORMATTER.format(Instant.now())
                )
        );

        vaultService.update(COLLECTION, query, update, false);
        logger.warn("LIBRARY", "ðŸ—‘ï¸ Archived title [" + existing.getTitleName() + "] (" + uuid + ")");
        return true;
    }

    public List<com.paxkun.raven.service.library.DownloadedFile> listDownloadedFiles(NewTitle title, int limit) {
        if (title == null) {
            return List.of();
        }

        Path root = logger.getDownloadsRoot();
        if (root == null) {
            return List.of();
        }

        String cleanTitle = Optional.ofNullable(title.getTitleName())
                .orElse("")
                .replaceAll("[^a-zA-Z0-9\\s]", "")
                .trim();
        if (cleanTitle.isBlank()) {
            return List.of();
        }

        Path titleFolder = root.resolve(cleanTitle);
        if (!Files.exists(titleFolder) || !Files.isDirectory(titleFolder)) {
            return List.of();
        }

        int safeLimit = Math.max(1, Math.min(500, limit));

        try (Stream<Path> stream = Files.list(titleFolder)) {
            return stream
                    .filter(Files::isRegularFile)
                    .sorted((a, b) -> {
                        try {
                            return Files.getLastModifiedTime(b).compareTo(Files.getLastModifiedTime(a));
                        } catch (Exception e) {
                            return 0;
                        }
                    })
                    .limit(safeLimit)
                    .map(path -> {
                        try {
                            String name = path.getFileName().toString();
                            long size = Files.size(path);
                            long modifiedMs = Files.getLastModifiedTime(path).toMillis();
                            String modifiedAt = ISO_FORMATTER.format(Instant.ofEpochMilli(modifiedMs));
                            return new com.paxkun.raven.service.library.DownloadedFile(name, size, modifiedMs, modifiedAt);
                        } catch (Exception e) {
                            return null;
                        }
                    })
                    .filter(Objects::nonNull)
                    .toList();
        } catch (Exception e) {
            logger.warn("LIBRARY", "âš ï¸ Failed to list files for [" + title.getTitleName() + "]: " + e.getMessage());
            return List.of();
        }
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

        NewTitle created = new NewTitle();
        created.setTitleName(titleName);
        created.setUuid(UUID.randomUUID().toString());
        created.setSourceUrl(sourceUrl);
        created.setLastDownloaded("0");
        addOrUpdateTitle(created, new NewChapter("0"));
        return created;
    }

    private String resolveDownloadPath(String titleName) {
        if (titleName == null || titleName.isBlank()) {
            return null;
        }

        Path root = logger.getDownloadsRoot();
        if (root == null) {
            return null;
        }

        String cleanTitle = titleName.replaceAll("[^a-zA-Z0-9\\s]", "").trim();
        if (cleanTitle.isBlank()) {
            return null;
        }

        return root.resolve(cleanTitle).toString();
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
