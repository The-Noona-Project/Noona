package com.paxkun.raven.service;

import com.google.gson.reflect.TypeToken;
import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.lang.reflect.Type;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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
            downloadPath = resolveDownloadPath(title.getTitleName(), title.getType());
        }
        if (downloadPath != null && !downloadPath.isBlank()) {
            set.put("downloadPath", downloadPath);
            title.setDownloadPath(downloadPath);
        }

        if (title.getSummary() != null && !title.getSummary().isBlank()) {
            set.put("summary", title.getSummary());
        }

        if (title.getCoverUrl() != null && !title.getCoverUrl().isBlank()) {
            set.put("coverUrl", title.getCoverUrl());
        }

        if (title.getType() != null && !title.getType().isBlank()) {
            set.put("type", title.getType());
        }

        title.setLastDownloadedAt(now);

        Map<String, Object> update = Map.of("$set", set);

        vaultService.update(COLLECTION, query, update, true);
        logger.info("LIBRARY", "Updated title [" + title.getTitleName() + "] to chapter " + chapter.getChapter());
    }

    public List<NewTitle> getAllTitleObjects() {
        Map<String, Object> activeQuery = Map.of("deletedAt", Map.of("$exists", false));
        List<Map<String, Object>> raw = vaultService.findMany(COLLECTION, activeQuery);
        Type listType = new TypeToken<List<NewTitle>>() {
        }.getType();
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
        logger.warn("LIBRARY", "Archived title [" + existing.getTitleName() + "] (" + uuid + ")");
        return true;
    }

    public List<com.paxkun.raven.service.library.DownloadedFile> listDownloadedFiles(NewTitle title, int limit) {
        if (title == null) {
            return List.of();
        }

        String downloadPath = title.getDownloadPath();
        if (downloadPath == null || downloadPath.isBlank()) {
            downloadPath = resolveDownloadPath(title.getTitleName(), title.getType());
        }

        if (downloadPath == null || downloadPath.isBlank()) {
            return List.of();
        }

        Path titleFolder = Path.of(downloadPath);
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
            logger.warn("LIBRARY", "Failed to list files for [" + title.getTitleName() + "]: " + e.getMessage());
            return List.of();
        }
    }

    public int deleteDownloadedFiles(NewTitle title, List<String> names) {
        if (title == null || names == null || names.isEmpty()) {
            return 0;
        }

        String downloadPath = title.getDownloadPath();
        if (downloadPath == null || downloadPath.isBlank()) {
            downloadPath = resolveDownloadPath(title.getTitleName(), title.getType());
        }

        if (downloadPath == null || downloadPath.isBlank()) {
            return 0;
        }

        Path titleFolder = Path.of(downloadPath).normalize();
        if (!Files.exists(titleFolder) || !Files.isDirectory(titleFolder)) {
            return 0;
        }

        int deleted = 0;
        Set<String> requested = new HashSet<>();
        for (String rawName : names) {
            if (rawName == null || rawName.isBlank()) {
                continue;
            }

            String fileName = Path.of(rawName).getFileName().toString().trim();
            if (fileName.isBlank() || !requested.add(fileName)) {
                continue;
            }

            Path candidate = titleFolder.resolve(fileName).normalize();
            if (!candidate.startsWith(titleFolder)) {
                continue;
            }

            try {
                if (Files.exists(candidate) && Files.isRegularFile(candidate)) {
                    Files.delete(candidate);
                    deleted++;
                }
            } catch (Exception e) {
                logger.warn("LIBRARY", "Failed to delete file " + fileName + ": " + e.getMessage());
            }
        }

        return deleted;
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

    private String resolveDownloadPath(String titleName, String type) {
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

        String normalizedFolder = normalizeMediaTypeFolder(type);
        Path base = normalizedFolder != null ? root.resolve(normalizedFolder) : root;

        return base.resolve(cleanTitle).toString();
    }

    private String normalizeMediaTypeFolder(String raw) {
        String normalized = normalizeMediaType(raw);
        if (normalized == null) {
            return null;
        }
        return slugifyFolderSegment(normalized);
    }

    private String normalizeMediaType(String raw) {
        if (raw == null) {
            return null;
        }

        String trimmed = raw.trim();
        if (trimmed.isBlank()) {
            return null;
        }

        String cleaned = trimmed.replaceFirst("(?i)^Type:?\\s*", "").replaceAll("\\s+", " ").trim();
        if (cleaned.isBlank()) {
            return null;
        }

        String lower = cleaned.toLowerCase(Locale.ROOT);
        return switch (lower) {
            case "manga" -> "Manga";
            case "manhwa" -> "Manhwa";
            case "manhua" -> "Manhua";
            default -> prettifyLabel(cleaned);
        };
    }

    private String prettifyLabel(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isBlank()) return null;

        boolean hasUpper = false;
        boolean hasLower = false;
        for (int i = 0; i < trimmed.length(); i++) {
            char ch = trimmed.charAt(i);
            if (!Character.isLetter(ch)) continue;
            if (Character.isUpperCase(ch)) hasUpper = true;
            if (Character.isLowerCase(ch)) hasLower = true;
        }

        if (hasUpper && hasLower) {
            return trimmed;
        }

        String[] parts = trimmed.toLowerCase(Locale.ROOT).split("\\s+");
        StringBuilder out = new StringBuilder();
        for (String part : parts) {
            if (part.isBlank()) continue;
            if (out.length() > 0) out.append(' ');
            out.append(Character.toUpperCase(part.charAt(0)));
            if (part.length() > 1) {
                out.append(part.substring(1));
            }
        }

        String result = out.toString().trim();
        return result.isBlank() ? trimmed : result;
    }

    private String slugifyFolderSegment(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        if (trimmed.isBlank()) return null;

        String lower = trimmed.toLowerCase(Locale.ROOT);
        String slug = lower
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+", "")
                .replaceAll("-+$", "");
        return slug.isBlank() ? null : slug;
    }

    private String extractChapterNumberFromTitle(String chapterTitle) {
        if (chapterTitle == null || chapterTitle.isBlank()) {
            return null;
        }

        Matcher matcher = Pattern.compile("Chapter\\s*(\\d+(\\.\\d+)?)", Pattern.CASE_INSENSITIVE).matcher(chapterTitle);
        if (matcher.find()) {
            return matcher.group(1);
        }

        matcher = Pattern.compile("(\\d+(\\.\\d+)?)").matcher(chapterTitle);
        if (matcher.find()) {
            return matcher.group(1);
        }

        return null;
    }

    private String extractChapterNumber(Map<String, String> chapter) {
        if (chapter == null || chapter.isEmpty()) {
            return null;
        }

        String chapterNumber = normalizeChapterNumber(chapter.get("chapter_number"));
        if (chapterNumber != null && !chapterNumber.isBlank()) {
            return chapterNumber;
        }

        return normalizeChapterNumber(extractChapterNumberFromTitle(chapter.get("chapter_title")));
    }

    private String normalizeChapterNumber(String chapter) {
        if (chapter == null) {
            return null;
        }

        String trimmed = chapter.trim();
        if (trimmed.isBlank()) {
            return null;
        }

        try {
            return new BigDecimal(trimmed).stripTrailingZeros().toPlainString();
        } catch (NumberFormatException ignored) {
            return trimmed;
        }
    }

    private int compareChapterNumbers(String left, String right) {
        String normalizedLeft = normalizeChapterNumber(left);
        String normalizedRight = normalizeChapterNumber(right);

        if (normalizedLeft == null && normalizedRight == null) {
            return 0;
        }
        if (normalizedLeft == null) {
            return -1;
        }
        if (normalizedRight == null) {
            return 1;
        }

        try {
            return new BigDecimal(normalizedLeft).compareTo(new BigDecimal(normalizedRight));
        } catch (NumberFormatException ignored) {
            return normalizedLeft.compareToIgnoreCase(normalizedRight);
        }
    }

    private String resolveLatestChapterNumber(List<Map<String, String>> chapters) {
        if (chapters == null || chapters.isEmpty()) {
            return "0";
        }

        String latest = "0";
        for (Map<String, String> chapter : chapters) {
            String value = extractChapterNumber(chapter);
            if (value == null || value.isBlank()) {
                continue;
            }

            if (compareChapterNumbers(value, latest) > 0) {
                latest = value;
            }
        }

        return latest;
    }

    private String resolveTitleFolderPath(NewTitle title) {
        if (title == null) {
            return null;
        }

        String downloadPath = title.getDownloadPath();
        if (downloadPath == null || downloadPath.isBlank()) {
            downloadPath = resolveDownloadPath(title.getTitleName(), title.getType());
        }

        if (downloadPath == null || downloadPath.isBlank()) {
            return null;
        }

        return downloadPath;
    }

    private Set<String> extractDownloadedChapterNumbers(NewTitle title) {
        String downloadPath = resolveTitleFolderPath(title);
        if (downloadPath == null || downloadPath.isBlank()) {
            return Set.of();
        }

        Path titleFolder = Path.of(downloadPath);
        if (!Files.exists(titleFolder) || !Files.isDirectory(titleFolder)) {
            return Set.of();
        }

        Set<String> chapterNumbers = new LinkedHashSet<>();
        try (Stream<Path> stream = Files.list(titleFolder)) {
            stream.filter(Files::isRegularFile).forEach((path) -> {
                String fileName = path.getFileName().toString();
                String chapter = normalizeChapterNumber(extractChapterNumberFromTitle(fileName));
                if (chapter != null && !chapter.isBlank()) {
                    chapterNumbers.add(chapter);
                }
            });
        } catch (Exception e) {
            logger.warn(
                    "LIBRARY",
                    "Failed to read existing chapter files for [" + title.getTitleName() + "]: " + e.getMessage());
        }

        return chapterNumbers;
    }

    private String buildTitleSyncMessage(int totalQueued, int newQueued, int missingQueued) {
        if (totalQueued <= 0) {
            return "No new or missing chapters found.";
        }

        if (newQueued > 0 && missingQueued > 0) {
            return "Queued " + totalQueued + " chapter(s): " + newQueued + " new and " + missingQueued + " missing.";
        }

        if (newQueued > 0) {
            return "Queued " + newQueued + " new chapter(s).";
        }

        return "Queued " + missingQueued + " missing chapter(s).";
    }

    private TitleSyncComputation computeTitleSync(NewTitle title, List<Map<String, String>> chapters) {
        String previousLastDownloaded = normalizeChapterNumber(Optional.ofNullable(title.getLastDownloaded()).orElse("0"));
        if (previousLastDownloaded == null || previousLastDownloaded.isBlank()) {
            previousLastDownloaded = "0";
        }

        String latestChapter = resolveLatestChapterNumber(chapters);
        Set<String> downloadedChapters = extractDownloadedChapterNumbers(title);
        boolean hasDownloadedIndex = !downloadedChapters.isEmpty();

        Set<String> newQueue = new LinkedHashSet<>();
        Set<String> missingQueue = new LinkedHashSet<>();

        for (Map<String, String> chapter : chapters) {
            String chapterNumber = extractChapterNumber(chapter);
            if (chapterNumber == null || chapterNumber.isBlank()) {
                continue;
            }

            if (isNewer(chapterNumber, previousLastDownloaded)) {
                newQueue.add(chapterNumber);
                continue;
            }

            if (hasDownloadedIndex
                    && compareChapterNumbers(chapterNumber, previousLastDownloaded) <= 0
                    && !downloadedChapters.contains(chapterNumber)) {
                missingQueue.add(chapterNumber);
            }
        }

        List<String> queuedChapters = new ArrayList<>(missingQueue);
        queuedChapters.addAll(newQueue);
        queuedChapters = queuedChapters.stream().distinct().sorted(this::compareChapterNumbers).toList();

        return new TitleSyncComputation(
                previousLastDownloaded,
                latestChapter,
                queuedChapters,
                newQueue.size(),
                missingQueue.size(),
                chapters.size()
        );
    }

    private TitleSyncResult syncTitleChapters(NewTitle title) {
        if (title == null) {
            return new TitleSyncResult(
                    null,
                    "Untitled",
                    "error",
                    null,
                    null,
                    null,
                    0,
                    0,
                    0,
                    0,
                    List.of(),
                    "Unable to sync an empty title."
            );
        }

        String uuid = title.getUuid();
        String titleName = Optional.ofNullable(title.getTitleName()).orElse("Untitled");
        String sourceUrl = Optional.ofNullable(title.getSourceUrl()).map(String::trim).orElse("");
        String currentLastDownloaded = normalizeChapterNumber(Optional.ofNullable(title.getLastDownloaded()).orElse("0"));
        if (currentLastDownloaded == null || currentLastDownloaded.isBlank()) {
            currentLastDownloaded = "0";
        }

        if (sourceUrl.isBlank()) {
            return new TitleSyncResult(
                    uuid,
                    titleName,
                    "skipped",
                    currentLastDownloaded,
                    currentLastDownloaded,
                    currentLastDownloaded,
                    0,
                    0,
                    0,
                    0,
                    List.of(),
                    "Title has no source URL configured."
            );
        }

        try {
            List<Map<String, String>> chapters = downloadService.fetchChapters(sourceUrl);
            if (chapters == null || chapters.isEmpty()) {
                return new TitleSyncResult(
                        uuid,
                        titleName,
                        "up-to-date",
                        currentLastDownloaded,
                        currentLastDownloaded,
                        currentLastDownloaded,
                        0,
                        0,
                        0,
                        0,
                        List.of(),
                        "No chapters were returned by the source."
                );
            }

            TitleSyncComputation plan = computeTitleSync(title, chapters);
            String nextLastDownloaded = plan.previousLastDownloaded();

            if (!plan.queuedChapters().isEmpty()) {
                for (String chapter : plan.queuedChapters()) {
                    downloadService.downloadSingleChapter(title, chapter);
                }

                if (plan.newQueuedCount() > 0 && plan.latestChapter() != null) {
                    nextLastDownloaded = plan.latestChapter();
                }
            }

            title.setChapterCount(plan.sourceChapterCount());
            title.setLastDownloaded(nextLastDownloaded);
            addOrUpdateTitle(title, new NewChapter(nextLastDownloaded));

            int totalQueued = plan.queuedChapters().size();
            String status = totalQueued > 0 ? "updated" : "up-to-date";
            String message = buildTitleSyncMessage(totalQueued, plan.newQueuedCount(), plan.missingQueuedCount());

            return new TitleSyncResult(
                    uuid,
                    titleName,
                    status,
                    plan.latestChapter(),
                    plan.previousLastDownloaded(),
                    nextLastDownloaded,
                    plan.sourceChapterCount(),
                    totalQueued,
                    plan.newQueuedCount(),
                    plan.missingQueuedCount(),
                    plan.queuedChapters(),
                    message
            );
        } catch (Exception e) {
            logger.warn("LIBRARY", "Failed to check/update " + titleName + ": " + e.getMessage());
            return new TitleSyncResult(
                    uuid,
                    titleName,
                    "error",
                    currentLastDownloaded,
                    currentLastDownloaded,
                    currentLastDownloaded,
                    0,
                    0,
                    0,
                    0,
                    List.of(),
                    "Unable to check this title: " + e.getMessage()
            );
        }
    }

    public TitleSyncResult checkForNewChaptersByUuid(String uuid) {
        if (uuid == null || uuid.isBlank()) {
            return null;
        }

        NewTitle title = getTitleByUuid(uuid.trim());
        if (title == null) {
            return null;
        }

        return syncTitleChapters(title);
    }

    public LibrarySyncSummary checkForNewChapters() {
        List<NewTitle> titles = getAllTitleObjects();
        if (titles.isEmpty()) {
            logger.warn("LIBRARY", "No titles in Vault to check.");
            return new LibrarySyncSummary(0, 0, 0, 0, 0, List.of(), "No titles in library.");
        }

        List<TitleSyncResult> results = new ArrayList<>();
        int updatedTitles = 0;
        int queuedChapters = 0;
        int newChaptersQueued = 0;
        int missingChaptersQueued = 0;

        for (NewTitle title : titles) {
            TitleSyncResult result = syncTitleChapters(title);
            results.add(result);

            if ("updated".equals(result.status())) {
                updatedTitles++;
            }

            queuedChapters += result.totalQueued();
            newChaptersQueued += result.newChaptersQueued();
            missingChaptersQueued += result.missingChaptersQueued();
        }

        String message = queuedChapters == 0
                ? "All titles are up-to-date."
                : "Queued " + queuedChapters + " chapter(s) across " + updatedTitles + " title(s).";

        return new LibrarySyncSummary(
                titles.size(),
                updatedTitles,
                queuedChapters,
                newChaptersQueued,
                missingChaptersQueued,
                results,
                message
        );
    }

    private boolean isNewer(String latest, String current) {
        return compareChapterNumbers(latest, current) > 0;
    }

    private record TitleSyncComputation(
            String previousLastDownloaded,
            String latestChapter,
            List<String> queuedChapters,
            int newQueuedCount,
            int missingQueuedCount,
            int sourceChapterCount
    ) {
    }

    public record TitleSyncResult(
            String uuid,
            String title,
            String status,
            String latestChapter,
            String previousLastDownloaded,
            String currentLastDownloaded,
            int sourceChapterCount,
            int totalQueued,
            int newChaptersQueued,
            int missingChaptersQueued,
            List<String> queuedChapters,
            String message
    ) {
    }

    public record LibrarySyncSummary(
            int checkedTitles,
            int updatedTitles,
            int queuedChapters,
            int newChaptersQueued,
            int missingChaptersQueued,
            List<TitleSyncResult> results,
            String message
    ) {
    }
}
