package com.paxkun.raven.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.gson.reflect.TypeToken;
import com.paxkun.raven.service.download.DownloadProgress;
import com.paxkun.raven.service.library.NewChapter;
import com.paxkun.raven.service.library.NewTitle;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.lang.reflect.Type;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.ZipFile;

/**
 * LibraryService manages Raven's manga library via VaultService.
 * Tracks downloaded chapters and triggers downloads for new ones.
 *
 * Author: Pax
 */
@Service
@RequiredArgsConstructor
public class LibraryService {
    private static final String DOWNLOADED_FOLDER_NAME = "downloaded";
    private static final String NOONA_MANIFEST_EXTENSION = ".noona";
    private static final ObjectMapper MANIFEST_OBJECT_MAPPER = new ObjectMapper();

    private final VaultService vaultService;
    private final @Lazy DownloadService downloadService;
    private final LoggerService logger;
    private final KavitaSyncService kavitaSyncService;

    private static final String COLLECTION = "manga_library";
    private static final DateTimeFormatter ISO_FORMATTER = DateTimeFormatter.ISO_INSTANT;
    private volatile CheckActivity currentCheckActivity;

    public void addOrUpdateTitle(NewTitle title, NewChapter chapter) {
        Map<String, Object> query = Map.of("uuid", title.getUuid());
        String now = ISO_FORMATTER.format(Instant.now());
        String effectiveLastDownloaded = normalizeChapterNumber(Optional.ofNullable(title.getLastDownloaded()).orElse("0"));
        String chapterNumber = normalizeChapterNumber(chapter != null ? chapter.getChapter() : null);
        if (chapterNumber != null && !chapterNumber.isBlank()) {
            if (effectiveLastDownloaded == null || effectiveLastDownloaded.isBlank() || compareChapterNumbers(chapterNumber, effectiveLastDownloaded) > 0) {
                effectiveLastDownloaded = chapterNumber;
            }
        }
        if (effectiveLastDownloaded == null || effectiveLastDownloaded.isBlank()) {
            effectiveLastDownloaded = "0";
        }

        LinkedHashMap<String, String> downloadedChapterFiles = normalizeDownloadedChapterFileMap(title.getDownloadedChapterFiles());
        List<String> downloadedChapterNumbers = mergeDownloadedChapterNumbers(
                mergeDownloadedChapterNumbers(title.getDownloadedChapterNumbers(), downloadedChapterFiles.keySet()),
                chapterNumber
        );
        LinkedHashMap<String, Integer> chapterVolumeMap = normalizeChapterVolumeMap(title.getChapterVolumeMap());

        title.setDownloadedChapterFiles(downloadedChapterFiles);
        title.setDownloadedChapterNumbers(downloadedChapterNumbers);
        title.setChapterVolumeMap(chapterVolumeMap);
        title.setLastDownloaded(effectiveLastDownloaded);

        Map<String, Object> set = new HashMap<>();
        set.put("uuid", title.getUuid());
        set.put("title", title.getTitleName());
        set.put("sourceUrl", title.getSourceUrl());
        set.put("lastDownloaded", effectiveLastDownloaded);
        set.put("lastDownloadedAt", now);

        if (title.getChapterCount() != null) {
            set.put("chapterCount", title.getChapterCount());
        }

        set.put("downloadedChapterNumbers", downloadedChapterNumbers);
        set.put("downloadedChapterFiles", downloadedChapterFiles);
        set.put("chapterVolumeMap", chapterVolumeMap);

        if (title.getChaptersDownloaded() == null && !downloadedChapterNumbers.isEmpty()) {
            title.setChaptersDownloaded(downloadedChapterNumbers.size());
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

        if (title.getAssociatedNames() != null && !title.getAssociatedNames().isEmpty()) {
            set.put("associatedNames", new ArrayList<>(title.getAssociatedNames()));
        }

        if (title.getStatus() != null && !title.getStatus().isBlank()) {
            set.put("status", title.getStatus());
        }

        if (title.getReleased() != null && !title.getReleased().isBlank()) {
            set.put("released", title.getReleased());
        }

        if (title.getOfficialTranslation() != null) {
            set.put("officialTranslation", title.getOfficialTranslation());
        }

        if (title.getAnimeAdaptation() != null) {
            set.put("animeAdaptation", title.getAnimeAdaptation());
        }

        List<Map<String, String>> relatedSeries = copyRelatedSeries(title.getRelatedSeries());
        if (!relatedSeries.isEmpty()) {
            set.put("relatedSeries", relatedSeries);
        }

        if (title.getMetadataProvider() != null && !title.getMetadataProvider().isBlank()) {
            set.put("metadataProvider", title.getMetadataProvider().trim());
        }

        if (title.getMetadataProviderSeriesId() != null && !title.getMetadataProviderSeriesId().isBlank()) {
            set.put("metadataProviderSeriesId", title.getMetadataProviderSeriesId().trim());
        }

        if (title.getMetadataMatchedAt() != null && !title.getMetadataMatchedAt().isBlank()) {
            set.put("metadataMatchedAt", title.getMetadataMatchedAt().trim());
        }

        ensureKavitaLibraryForType(title.getType());

        title.setLastDownloadedAt(now);

        Map<String, Object> update = Map.of("$set", set);

        vaultService.update(COLLECTION, query, update, true);
        logger.info("LIBRARY", "Updated title [" + title.getTitleName() + "] to chapter " + effectiveLastDownloaded);
        writeTitleImportManifest(title);
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

    public NewTitle updateTitle(String uuid, String titleName, String sourceUrl, String coverUrl) {
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

        if (coverUrl != null && !coverUrl.isBlank()) {
            existing.setCoverUrl(coverUrl);
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
                    .filter((path) -> !isNoonaManifestFile(path))
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
        Set<String> deletedNames = new LinkedHashSet<>();
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
                    deletedNames.add(candidate.getFileName().toString());
                }
            } catch (Exception e) {
                logger.warn("LIBRARY", "Failed to delete file " + fileName + ": " + e.getMessage());
            }
        }

        if (deleted > 0) {
            LinkedHashMap<String, String> downloadedChapterFiles = normalizeDownloadedChapterFileMap(title.getDownloadedChapterFiles());
            if (!downloadedChapterFiles.isEmpty()) {
                Set<String> deletedLookup = deletedNames.stream()
                        .map((entry) -> entry.toLowerCase(Locale.ROOT))
                        .collect(java.util.stream.Collectors.toSet());
                downloadedChapterFiles.entrySet().removeIf((entry) ->
                        deletedLookup.contains(Optional.ofNullable(entry.getValue()).orElse("").toLowerCase(Locale.ROOT)));
                title.setDownloadedChapterFiles(downloadedChapterFiles);
            }

            Set<String> remaining = new LinkedHashSet<>(mergeDownloadedChapterNumbers(
                    title.getDownloadedChapterNumbers(),
                    downloadedChapterFiles.keySet()
            ));
            if (downloadedChapterFiles.isEmpty()) {
                for (String deletedName : deletedNames) {
                    String deletedChapter = normalizeChapterNumber(extractChapterNumberFromTitle(deletedName));
                    if (deletedChapter != null && !deletedChapter.isBlank()) {
                        remaining.remove(deletedChapter);
                    }
                }
            } else {
                remaining = new LinkedHashSet<>(downloadedChapterFiles.keySet());
            }

            List<String> remainingList = new ArrayList<>(remaining);
            remainingList.sort(this::compareChapterNumbers);
            title.setDownloadedChapterNumbers(remainingList);
            title.setChaptersDownloaded(remainingList.size());
            title.setLastDownloaded(resolveLatestDownloadedChapter(remainingList, "0"));
            addOrUpdateTitle(title, null);
        }

        return deleted;
    }

    public VolumeMapApplyResult applyTitleVolumeMap(
            String uuid,
            String provider,
            String providerSeriesId,
            Map<String, Integer> chapterVolumeMap,
            Boolean autoRename
    ) {
        if (uuid == null || uuid.isBlank()) {
            return null;
        }

        NewTitle title = getTitleByUuid(uuid.trim());
        if (title == null) {
            return null;
        }

        String normalizedProvider = Optional.ofNullable(provider).map(String::trim).orElse("");
        String normalizedProviderSeriesId = Optional.ofNullable(providerSeriesId).map(String::trim).orElse("");

        title.setChapterVolumeMap(normalizeChapterVolumeMap(chapterVolumeMap));
        if (!normalizedProvider.isBlank()) {
            title.setMetadataProvider(normalizedProvider);
        }
        if (!normalizedProviderSeriesId.isBlank()) {
            title.setMetadataProviderSeriesId(normalizedProviderSeriesId);
        }
        title.setMetadataMatchedAt(ISO_FORMATTER.format(Instant.now()));

        String downloadPath = resolveTitleFolderPath(title);
        if (downloadPath != null && !downloadPath.isBlank()) {
            title.setDownloadedChapterFiles(resolveDownloadedChapterFileIndex(title, Path.of(downloadPath), title.getTitleName()));
        } else {
            title.setDownloadedChapterFiles(normalizeDownloadedChapterFileMap(title.getDownloadedChapterFiles()));
        }

        List<String> downloadedChapterNumbers = mergeDownloadedChapterNumbers(
                title.getDownloadedChapterNumbers(),
                Optional.ofNullable(title.getDownloadedChapterFiles()).orElse(Map.of()).keySet()
        );
        title.setDownloadedChapterNumbers(downloadedChapterNumbers);
        title.setChaptersDownloaded(downloadedChapterNumbers.size());

        boolean shouldAutoRename = autoRename == null || autoRename;
        RenameSummary renameSummary = shouldAutoRename
                ? renameDownloadedChapterFiles(title)
                : new RenameSummary(
                false,
                Optional.ofNullable(title.getDownloadedChapterFiles()).orElse(Map.of()).size(),
                0,
                Optional.ofNullable(title.getDownloadedChapterFiles()).orElse(Map.of()).size(),
                0,
                0,
                "Stored the volume map without renaming existing files."
        );

        addOrUpdateTitle(title, null);
        return new VolumeMapApplyResult(title, renameSummary);
    }

    private RenameSummary renameDownloadedChapterFiles(NewTitle title) {
        String downloadPath = resolveTitleFolderPath(title);
        if (downloadPath == null || downloadPath.isBlank()) {
            return new RenameSummary(true, 0, 0, 0, 0, 0, "No downloaded files were available to rename.");
        }

        Path titleFolder = Path.of(downloadPath);
        if (!Files.exists(titleFolder) || !Files.isDirectory(titleFolder)) {
            return new RenameSummary(true, 0, 0, 0, 0, 0, "No downloaded files were available to rename.");
        }

        LinkedHashMap<String, String> downloadedChapterFiles = resolveDownloadedChapterFileIndex(title, titleFolder, title.getTitleName());
        title.setDownloadedChapterFiles(downloadedChapterFiles);
        if (downloadedChapterFiles.isEmpty()) {
            return new RenameSummary(true, 0, 0, 0, 0, 0, "No downloaded files were available to rename.");
        }

        int renamed = 0;
        int unchanged = 0;
        int missingFiles = 0;
        int collisions = 0;
        LinkedHashMap<String, String> updatedChapterFiles = new LinkedHashMap<>(downloadedChapterFiles);

        for (Map.Entry<String, String> entry : downloadedChapterFiles.entrySet()) {
            String chapterNumber = entry.getKey();
            String sourceName = entry.getValue();
            Path sourcePath = titleFolder.resolve(sourceName);
            if (!Files.exists(sourcePath) || !Files.isRegularFile(sourcePath) || isNoonaManifestFile(sourcePath)) {
                missingFiles++;
                updatedChapterFiles.remove(chapterNumber);
                continue;
            }

            String targetName = downloadService.buildChapterArchiveName(title, chapterNumber, countArchivePages(sourcePath), "");
            if (targetName == null || targetName.isBlank()) {
                unchanged++;
                continue;
            }

            if (targetName.equals(sourceName)) {
                unchanged++;
                continue;
            }

            Path targetPath = titleFolder.resolve(targetName);
            if (Files.exists(targetPath) && !sourcePath.normalize().equals(targetPath.normalize())) {
                collisions++;
                continue;
            }

            try {
                Files.move(sourcePath, targetPath);
                updatedChapterFiles.put(chapterNumber, targetName);
                renamed++;
            } catch (Exception e) {
                collisions++;
                logger.warn("LIBRARY", "Failed to rename [" + sourceName + "] to [" + targetName + "]: " + e.getMessage());
            }
        }

        LinkedHashMap<String, String> normalizedChapterFiles = sortChapterFileMap(updatedChapterFiles);
        List<String> downloadedChapterNumbers = new ArrayList<>(normalizedChapterFiles.keySet());
        downloadedChapterNumbers.sort(this::compareChapterNumbers);

        title.setDownloadedChapterFiles(normalizedChapterFiles);
        title.setDownloadedChapterNumbers(downloadedChapterNumbers);
        title.setChaptersDownloaded(downloadedChapterNumbers.size());
        title.setLastDownloaded(resolveLatestDownloadedChapter(downloadedChapterNumbers, title.getLastDownloaded()));

        return new RenameSummary(
                true,
                downloadedChapterFiles.size(),
                renamed,
                unchanged,
                missingFiles,
                collisions,
                buildRenameSummaryMessage(downloadedChapterFiles.size(), renamed, unchanged, missingFiles, collisions)
        );
    }

    private int countArchivePages(Path archivePath) {
        if (archivePath == null || !Files.exists(archivePath) || !Files.isRegularFile(archivePath)) {
            return 0;
        }

        try (ZipFile zipFile = new ZipFile(archivePath.toFile())) {
            int count = 0;
            Enumeration<? extends java.util.zip.ZipEntry> entries = zipFile.entries();
            while (entries.hasMoreElements()) {
                java.util.zip.ZipEntry entry = entries.nextElement();
                if (!entry.isDirectory()) {
                    count++;
                }
            }
            return count;
        } catch (Exception e) {
            logger.warn("LIBRARY", "Failed to count archive pages for [" + archivePath.getFileName() + "]: " + e.getMessage());
            return 0;
        }
    }

    private String buildRenameSummaryMessage(int indexedFiles, int renamed, int unchanged, int missingFiles, int collisions) {
        if (indexedFiles <= 0) {
            return "No downloaded files were available to rename.";
        }

        if (renamed <= 0 && collisions <= 0 && missingFiles <= 0) {
            return "Existing chapter files already matched the current naming settings.";
        }

        StringBuilder message = new StringBuilder("Processed ").append(indexedFiles).append(" downloaded file(s).");
        if (renamed > 0) {
            message.append(" Renamed ").append(renamed).append('.');
        }
        if (unchanged > 0) {
            message.append(" Unchanged: ").append(unchanged).append('.');
        }
        if (collisions > 0) {
            message.append(" Skipped collisions: ").append(collisions).append('.');
        }
        if (missingFiles > 0) {
            message.append(" Missing files: ").append(missingFiles).append('.');
        }
        return message.toString();
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

    private void writeTitleImportManifest(NewTitle title) {
        if (title == null) {
            return;
        }

        String uuid = Optional.ofNullable(title.getUuid()).map(String::trim).orElse("");
        String downloadPath = resolveTitleFolderPath(title);
        if (uuid.isBlank() || downloadPath == null || downloadPath.isBlank()) {
            return;
        }

        Path titleFolder = Path.of(downloadPath);
        if (!Files.exists(titleFolder) || !Files.isDirectory(titleFolder)) {
            return;
        }

        Path manifestPath = titleFolder.resolve(uuid + NOONA_MANIFEST_EXTENSION);
        NewTitle manifestTitle = new NewTitle();
        manifestTitle.setTitleName(title.getTitleName());
        manifestTitle.setUuid(title.getUuid());
        manifestTitle.setSourceUrl(title.getSourceUrl());
        manifestTitle.setLastDownloaded(title.getLastDownloaded());
        manifestTitle.setLastDownloadedAt(title.getLastDownloadedAt());
        manifestTitle.setChapterCount(title.getChapterCount());
        manifestTitle.setChaptersDownloaded(title.getChaptersDownloaded());
        manifestTitle.setDownloadPath(titleFolder.toString());
        manifestTitle.setSummary(title.getSummary());
        manifestTitle.setCoverUrl(title.getCoverUrl());
        manifestTitle.setType(title.getType());
        manifestTitle.setAssociatedNames(title.getAssociatedNames() == null ? List.of() : new ArrayList<>(title.getAssociatedNames()));
        manifestTitle.setStatus(title.getStatus());
        manifestTitle.setReleased(title.getReleased());
        manifestTitle.setOfficialTranslation(title.getOfficialTranslation());
        manifestTitle.setAnimeAdaptation(title.getAnimeAdaptation());
        manifestTitle.setRelatedSeries(copyRelatedSeries(title.getRelatedSeries()));
        manifestTitle.setDownloadedChapterNumbers(
                title.getDownloadedChapterNumbers() == null ? List.of() : new ArrayList<>(title.getDownloadedChapterNumbers())
        );
        manifestTitle.setDownloadedChapterFiles(normalizeDownloadedChapterFileMap(title.getDownloadedChapterFiles()));
        manifestTitle.setChapterVolumeMap(normalizeChapterVolumeMap(title.getChapterVolumeMap()));
        manifestTitle.setMetadataProvider(title.getMetadataProvider());
        manifestTitle.setMetadataProviderSeriesId(title.getMetadataProviderSeriesId());
        manifestTitle.setMetadataMatchedAt(title.getMetadataMatchedAt());

        try {
            String payload = MANIFEST_OBJECT_MAPPER
                    .writerWithDefaultPrettyPrinter()
                    .writeValueAsString(manifestTitle);
            Files.writeString(
                    manifestPath,
                    payload,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING,
                    StandardOpenOption.WRITE
            );
        } catch (Exception e) {
            logger.warn("LIBRARY", "Failed to write .noona manifest for [" + title.getTitleName() + "]: " + e.getMessage());
        }
    }

    private boolean isNoonaManifestFile(Path path) {
        if (path == null || path.getFileName() == null) {
            return false;
        }

        String fileName = path.getFileName().toString().trim().toLowerCase(Locale.ROOT);
        return fileName.endsWith(NOONA_MANIFEST_EXTENSION);
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

        Path downloadedRoot = root.resolve(DOWNLOADED_FOLDER_NAME);
        String normalizedFolder = normalizeMediaTypeFolder(type);
        Path base = normalizedFolder != null ? downloadedRoot.resolve(normalizedFolder) : downloadedRoot;

        return base.resolve(cleanTitle).toString();
    }

    private void ensureKavitaLibraryForType(String rawType) {
        String normalizedType = normalizeMediaType(rawType);
        String normalizedFolder = normalizeMediaTypeFolder(rawType);
        if (normalizedType != null && normalizedFolder != null) {
            kavitaSyncService.ensureLibraryForType(normalizedType, normalizedFolder);
        }
    }

    public void scanKavitaLibraryForType(String rawType) {
        String normalizedType = normalizeMediaType(rawType);
        String normalizedFolder = normalizeMediaTypeFolder(rawType);
        if (normalizedType != null) {
            kavitaSyncService.scanLibraryForType(normalizedType, normalizedFolder);
        }
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

        Matcher matcher = Pattern.compile("(?i)\\bc\\s*(\\d+(\\.\\d+)?)\\b").matcher(chapterTitle);
        if (matcher.find()) {
            return matcher.group(1);
        }

        matcher = Pattern.compile("(?i)\\bch(?:apter)?\\.?\\s*(\\d+(\\.\\d+)?)\\b").matcher(chapterTitle);
        if (matcher.find()) {
            return matcher.group(1);
        }

        String stripped = stripTrailingFileDecorators(chapterTitle);
        matcher = Pattern.compile("(?i)(?:^|[^a-z])(\\d+(\\.\\d+)?)$").matcher(stripped);
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

    private List<String> mergeDownloadedChapterNumbers(List<String> existing, Collection<String> chaptersToMerge) {
        LinkedHashSet<String> chapters = new LinkedHashSet<>();
        if (existing != null) {
            for (String chapterNumber : existing) {
                String normalized = normalizeChapterNumber(chapterNumber);
                if (normalized != null && !normalized.isBlank() && !"0".equals(normalized)) {
                    chapters.add(normalized);
                }
            }
        }

        if (chaptersToMerge != null) {
            for (String chapterNumber : chaptersToMerge) {
                String normalizedNext = normalizeChapterNumber(chapterNumber);
                if (normalizedNext != null && !normalizedNext.isBlank() && !"0".equals(normalizedNext)) {
                    chapters.add(normalizedNext);
                }
            }
        }

        List<String> sorted = new ArrayList<>(chapters);
        sorted.sort(this::compareChapterNumbers);
        return sorted;
    }

    private List<String> mergeDownloadedChapterNumbers(List<String> existing, String nextChapter) {
        return mergeDownloadedChapterNumbers(
                existing,
                nextChapter == null || nextChapter.isBlank() ? List.of() : List.of(nextChapter)
        );
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

    private LinkedHashMap<String, Integer> normalizeChapterVolumeMap(Map<String, Integer> chapterVolumeMap) {
        LinkedHashMap<String, Integer> normalized = new LinkedHashMap<>();
        if (chapterVolumeMap == null || chapterVolumeMap.isEmpty()) {
            return normalized;
        }

        List<Map.Entry<String, Integer>> entries = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : chapterVolumeMap.entrySet()) {
            String chapterNumber = normalizeChapterNumber(entry.getKey());
            Integer volumeNumber = entry.getValue();
            if (chapterNumber == null || chapterNumber.isBlank() || volumeNumber == null || volumeNumber < 1) {
                continue;
            }
            entries.add(Map.entry(chapterNumber, volumeNumber));
        }

        entries.sort((left, right) -> compareChapterNumbers(left.getKey(), right.getKey()));
        for (Map.Entry<String, Integer> entry : entries) {
            normalized.put(entry.getKey(), entry.getValue());
        }

        return normalized;
    }

    private LinkedHashMap<String, String> normalizeDownloadedChapterFileMap(Map<String, String> downloadedChapterFiles) {
        return sortChapterFileMap(downloadedChapterFiles);
    }

    private LinkedHashMap<String, String> sortChapterFileMap(Map<String, String> downloadedChapterFiles) {
        LinkedHashMap<String, String> normalized = new LinkedHashMap<>();
        if (downloadedChapterFiles == null || downloadedChapterFiles.isEmpty()) {
            return normalized;
        }

        List<Map.Entry<String, String>> entries = new ArrayList<>();
        for (Map.Entry<String, String> entry : downloadedChapterFiles.entrySet()) {
            String chapterNumber = normalizeChapterNumber(entry.getKey());
            String fileName = sanitizeStoredFileName(entry.getValue());
            if (chapterNumber == null || chapterNumber.isBlank() || fileName.isBlank()) {
                continue;
            }
            entries.add(Map.entry(chapterNumber, fileName));
        }

        entries.sort((left, right) -> compareChapterNumbers(left.getKey(), right.getKey()));
        for (Map.Entry<String, String> entry : entries) {
            normalized.put(entry.getKey(), entry.getValue());
        }

        return normalized;
    }

    private String sanitizeStoredFileName(String rawName) {
        if (rawName == null || rawName.isBlank()) {
            return "";
        }

        try {
            return Path.of(rawName).getFileName().toString().trim();
        } catch (Exception ignored) {
            return rawName.trim();
        }
    }

    private String stripTrailingFileDecorators(String rawText) {
        String stripped = rawText == null ? "" : rawText.trim();
        if (stripped.isBlank()) {
            return stripped;
        }

        stripped = stripped.replaceFirst("(?i)\\.cbz$", "").trim();
        boolean changed;
        do {
            changed = false;
            String next = stripped.replaceFirst("\\s*(\\[[^\\]]*]|\\([^)]*\\))\\s*$", "").trim();
            if (!next.equals(stripped)) {
                stripped = next;
                changed = true;
            }
        } while (changed);

        return stripped;
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

    private Path resolveDownloadedRoot() {
        Path root = logger.getDownloadsRoot();
        if (root == null) {
            return null;
        }
        return root.resolve(DOWNLOADED_FOLDER_NAME);
    }

    private Set<String> extractDownloadedChapterNumbers(NewTitle title) {
        LinkedHashMap<String, String> downloadedChapterFiles = normalizeDownloadedChapterFileMap(
                title != null ? title.getDownloadedChapterFiles() : null
        );
        if (!downloadedChapterFiles.isEmpty()) {
            return new LinkedHashSet<>(downloadedChapterFiles.keySet());
        }

        if (title != null && title.getDownloadedChapterNumbers() != null && !title.getDownloadedChapterNumbers().isEmpty()) {
            Set<String> indexed = new LinkedHashSet<>();
            for (String chapterNumber : title.getDownloadedChapterNumbers()) {
                String normalized = normalizeChapterNumber(chapterNumber);
                if (normalized != null && !normalized.isBlank() && !"0".equals(normalized)) {
                    indexed.add(normalized);
                }
            }
            if (!indexed.isEmpty()) {
                return indexed;
            }
        }

        String downloadPath = resolveTitleFolderPath(title);
        if (downloadPath == null || downloadPath.isBlank()) {
            return Set.of();
        }

        return new LinkedHashSet<>(resolveDownloadedChapterFileIndex(
                title,
                Path.of(downloadPath),
                title != null ? title.getTitleName() : null
        ).keySet());
    }

    private LinkedHashMap<String, String> resolveDownloadedChapterFileIndex(NewTitle title, Path titleFolder, String titleName) {
        LinkedHashMap<String, String> stored = normalizeDownloadedChapterFileMap(title != null ? title.getDownloadedChapterFiles() : null);
        if (titleFolder == null || !Files.exists(titleFolder) || !Files.isDirectory(titleFolder)) {
            return stored;
        }

        LinkedHashMap<String, String> resolved = new LinkedHashMap<>();
        Set<String> indexedNames = new HashSet<>();

        for (Map.Entry<String, String> entry : stored.entrySet()) {
            String fileName = entry.getValue();
            if (fileName == null || fileName.isBlank()) {
                continue;
            }

            Path candidate = titleFolder.resolve(fileName);
            if (!Files.exists(candidate) || !Files.isRegularFile(candidate) || isNoonaManifestFile(candidate)) {
                continue;
            }

            resolved.put(entry.getKey(), candidate.getFileName().toString());
            indexedNames.add(candidate.getFileName().toString().toLowerCase(Locale.ROOT));
        }

        try (Stream<Path> stream = Files.list(titleFolder)) {
            stream.filter(Files::isRegularFile)
                    .filter((path) -> !isNoonaManifestFile(path))
                    .sorted(Comparator.comparing((Path path) -> path.getFileName().toString(), String.CASE_INSENSITIVE_ORDER))
                    .forEach((path) -> {
                        String fileName = path.getFileName().toString();
                        String lookupKey = fileName.toLowerCase(Locale.ROOT);
                        if (indexedNames.contains(lookupKey)) {
                            return;
                        }

                        String chapter = normalizeChapterNumber(extractChapterNumberFromTitle(fileName));
                        if (chapter == null || chapter.isBlank() || resolved.containsKey(chapter)) {
                            return;
                        }

                        resolved.put(chapter, fileName);
                    });
        } catch (Exception e) {
            logger.warn(
                    "LIBRARY",
                    "Failed to read existing chapter files for [" + Optional.ofNullable(titleName).orElse("Untitled") + "]: " + e.getMessage());
        }

        return sortChapterFileMap(resolved);
    }

    private String resolveLatestDownloadedChapter(Collection<String> chapterNumbers, String fallback) {
        String latest = normalizeChapterNumber(fallback);
        if (latest == null || latest.isBlank()) {
            latest = "0";
        }

        if (chapterNumbers == null) {
            return latest;
        }

        for (String chapterNumber : chapterNumbers) {
            String normalized = normalizeChapterNumber(chapterNumber);
            if (normalized == null || normalized.isBlank()) {
                continue;
            }

            if (compareChapterNumbers(normalized, latest) > 0) {
                latest = normalized;
            }
        }

        return latest;
    }

    private String inferMediaTypeFromTitleFolder(Path titleFolder) {
        if (titleFolder == null) {
            return null;
        }

        Path typeFolder = titleFolder.getParent();
        if (typeFolder == null || typeFolder.getFileName() == null) {
            return null;
        }

        return normalizeMediaType(typeFolder.getFileName().toString());
    }

    private List<Path> listAvailableImportManifests(Path downloadedRoot) {
        if (downloadedRoot == null || !Files.exists(downloadedRoot) || !Files.isDirectory(downloadedRoot)) {
            return List.of();
        }

        try (Stream<Path> stream = Files.walk(downloadedRoot)) {
            return stream
                    .filter(Files::isRegularFile)
                    .filter(this::isNoonaManifestFile)
                    .sorted(Comparator.comparing(Path::toString))
                    .toList();
        } catch (Exception e) {
            logger.warn("LIBRARY", "Failed to list available .noona imports: " + e.getMessage());
            return List.of();
        }
    }

    private NewTitle readTitleImportManifest(Path manifestPath) throws Exception {
        if (manifestPath == null || !Files.exists(manifestPath) || !Files.isRegularFile(manifestPath)) {
            throw new IllegalStateException("Manifest file does not exist.");
        }

        NewTitle title = MANIFEST_OBJECT_MAPPER.readValue(Files.readString(manifestPath), NewTitle.class);
        if (title == null) {
            throw new IllegalStateException("Manifest did not contain a valid title object.");
        }

        Path titleFolder = manifestPath.getParent();
        String fileName = manifestPath.getFileName() != null ? manifestPath.getFileName().toString() : "";
        String uuidFromFile = fileName.endsWith(NOONA_MANIFEST_EXTENSION)
                ? fileName.substring(0, fileName.length() - NOONA_MANIFEST_EXTENSION.length())
                : fileName;

        if (title.getUuid() == null || title.getUuid().isBlank()) {
            title.setUuid(uuidFromFile);
        }
        if (title.getTitleName() == null || title.getTitleName().isBlank()) {
            title.setTitleName(titleFolder != null && titleFolder.getFileName() != null ? titleFolder.getFileName().toString() : "Untitled");
        }

        title.setDownloadPath(titleFolder != null ? titleFolder.toString() : title.getDownloadPath());
        if (title.getType() == null || title.getType().isBlank()) {
            title.setType(inferMediaTypeFromTitleFolder(titleFolder));
        }
        title.setChapterVolumeMap(normalizeChapterVolumeMap(title.getChapterVolumeMap()));

        LinkedHashMap<String, String> discoveredDownloads = resolveDownloadedChapterFileIndex(title, titleFolder, title.getTitleName());
        List<String> manifestDownloaded = title.getDownloadedChapterNumbers() == null
                ? List.of()
                : new ArrayList<>(title.getDownloadedChapterNumbers());
        List<String> mergedDownloads = mergeDownloadedChapterNumbers(manifestDownloaded, discoveredDownloads.keySet());

        title.setDownloadedChapterFiles(discoveredDownloads);
        title.setDownloadedChapterNumbers(mergedDownloads);
        title.setChaptersDownloaded(Math.max(discoveredDownloads.size(), mergedDownloads.size()));
        title.setLastDownloaded(resolveLatestDownloadedChapter(
                !mergedDownloads.isEmpty() ? mergedDownloads : discoveredDownloads.keySet(),
                title.getLastDownloaded()
        ));

        return title;
    }

    private NewTitle importTitleFromManifest(NewTitle importedTitle) {
        if (importedTitle == null) {
            return null;
        }

        NewTitle existing = null;
        String importedUuid = Optional.ofNullable(importedTitle.getUuid()).map(String::trim).orElse("");
        if (!importedUuid.isBlank()) {
            existing = getTitleByUuid(importedUuid);
        }
        if (existing == null) {
            String titleName = Optional.ofNullable(importedTitle.getTitleName()).map(String::trim).orElse("");
            if (!titleName.isBlank()) {
                existing = getTitle(titleName);
            }
        }

        NewTitle target = existing != null ? existing : new NewTitle();
        if ((target.getUuid() == null || target.getUuid().isBlank()) && !importedUuid.isBlank()) {
            target.setUuid(importedUuid);
        }
        if (target.getTitleName() == null || target.getTitleName().isBlank()) {
            target.setTitleName(importedTitle.getTitleName());
        }
        if (importedTitle.getSourceUrl() != null && !importedTitle.getSourceUrl().isBlank()) {
            target.setSourceUrl(importedTitle.getSourceUrl());
        }
        if (importedTitle.getSummary() != null && !importedTitle.getSummary().isBlank()) {
            target.setSummary(importedTitle.getSummary());
        }
        if (importedTitle.getCoverUrl() != null && !importedTitle.getCoverUrl().isBlank()) {
            target.setCoverUrl(importedTitle.getCoverUrl());
        }
        if (importedTitle.getType() != null && !importedTitle.getType().isBlank()) {
            target.setType(importedTitle.getType());
        }
        if (importedTitle.getAssociatedNames() != null && !importedTitle.getAssociatedNames().isEmpty()) {
            target.setAssociatedNames(new ArrayList<>(importedTitle.getAssociatedNames()));
        }
        if (importedTitle.getStatus() != null && !importedTitle.getStatus().isBlank()) {
            target.setStatus(importedTitle.getStatus());
        }
        if (importedTitle.getReleased() != null && !importedTitle.getReleased().isBlank()) {
            target.setReleased(importedTitle.getReleased());
        }
        if (importedTitle.getOfficialTranslation() != null) {
            target.setOfficialTranslation(importedTitle.getOfficialTranslation());
        }
        if (importedTitle.getAnimeAdaptation() != null) {
            target.setAnimeAdaptation(importedTitle.getAnimeAdaptation());
        }
        if (importedTitle.getRelatedSeries() != null && !importedTitle.getRelatedSeries().isEmpty()) {
            target.setRelatedSeries(copyRelatedSeries(importedTitle.getRelatedSeries()));
        }
        if (importedTitle.getDownloadPath() != null && !importedTitle.getDownloadPath().isBlank()) {
            target.setDownloadPath(importedTitle.getDownloadPath());
        }
        if (importedTitle.getChapterCount() != null) {
            target.setChapterCount(importedTitle.getChapterCount());
        }
        if (importedTitle.getChaptersDownloaded() != null) {
            target.setChaptersDownloaded(importedTitle.getChaptersDownloaded());
        }
        if (importedTitle.getLastDownloadedAt() != null && !importedTitle.getLastDownloadedAt().isBlank()) {
            target.setLastDownloadedAt(importedTitle.getLastDownloadedAt());
        }
        target.setLastDownloaded(resolveLatestDownloadedChapter(
                importedTitle.getDownloadedChapterNumbers(),
                importedTitle.getLastDownloaded()
        ));
        target.setDownloadedChapterNumbers(
                mergeDownloadedChapterNumbers(
                        importedTitle.getDownloadedChapterNumbers(),
                        normalizeDownloadedChapterFileMap(importedTitle.getDownloadedChapterFiles()).keySet()
                )
        );
        target.setDownloadedChapterFiles(normalizeDownloadedChapterFileMap(importedTitle.getDownloadedChapterFiles()));
        target.setChapterVolumeMap(normalizeChapterVolumeMap(importedTitle.getChapterVolumeMap()));
        if (importedTitle.getMetadataProvider() != null && !importedTitle.getMetadataProvider().isBlank()) {
            target.setMetadataProvider(importedTitle.getMetadataProvider().trim());
        }
        if (importedTitle.getMetadataProviderSeriesId() != null && !importedTitle.getMetadataProviderSeriesId().isBlank()) {
            target.setMetadataProviderSeriesId(importedTitle.getMetadataProviderSeriesId().trim());
        }
        if (importedTitle.getMetadataMatchedAt() != null && !importedTitle.getMetadataMatchedAt().isBlank()) {
            target.setMetadataMatchedAt(importedTitle.getMetadataMatchedAt().trim());
        }
        if (target.getChaptersDownloaded() == null) {
            target.setChaptersDownloaded(target.getDownloadedChapterNumbers().size());
        }

        addOrUpdateTitle(target, null);
        return target;
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
        title.setDownloadedChapterNumbers(new ArrayList<>(downloadedChapters));
        title.setChaptersDownloaded(downloadedChapters.size());

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
                new ArrayList<>(newQueue),
                new ArrayList<>(missingQueue),
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
                    List.of(),
                    List.of(),
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
                    List.of(),
                    List.of(),
                    Optional.ofNullable(title.getDownloadedChapterNumbers()).orElse(List.of()),
                    "Title has no source URL configured."
            );
        }

        if (downloadService.isTaskActive(titleName)) {
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
                    List.of(),
                    List.of(),
                    Optional.ofNullable(title.getDownloadedChapterNumbers()).orElse(List.of()),
                    "This title already has an active Raven task."
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
                        List.of(),
                        List.of(),
                        Optional.ofNullable(title.getDownloadedChapterNumbers()).orElse(List.of()),
                        "No chapters were returned by the source."
                );
            }

            TitleSyncComputation plan = computeTitleSync(title, chapters);
            String nextLastDownloaded = plan.previousLastDownloaded();
            List<String> downloadedDuringSync = new ArrayList<>();
            List<String> failedChapters = new ArrayList<>();
            DownloadProgress trackedTask = null;

            if (!plan.queuedChapters().isEmpty()) {
                trackedTask = downloadService.startTrackedTask(
                        title,
                        "title-sync",
                        plan.queuedChapters(),
                        plan.newChapterNumbers(),
                        plan.missingChapterNumbers(),
                        plan.latestChapter(),
                        plan.sourceChapterCount(),
                        buildTitleSyncMessage(plan.queuedChapters().size(), plan.newQueuedCount(), plan.missingQueuedCount())
                );
                try {
                    String latestSuccessfulChapter = null;
                    for (String chapter : plan.queuedChapters()) {
                        if (!downloadService.downloadSingleChapter(title, chapter, trackedTask)) {
                            failedChapters.add(chapter);
                            continue;
                        }

                        downloadedDuringSync.add(chapter);
                        if (latestSuccessfulChapter == null || compareChapterNumbers(chapter, latestSuccessfulChapter) > 0) {
                            latestSuccessfulChapter = chapter;
                        }

                        if (compareChapterNumbers(chapter, nextLastDownloaded) > 0) {
                            nextLastDownloaded = chapter;
                        }

                        title.setLastDownloaded(nextLastDownloaded);
                        title.setDownloadedChapterNumbers(mergeDownloadedChapterNumbers(title.getDownloadedChapterNumbers(), chapter));
                        title.setChaptersDownloaded(Optional.ofNullable(title.getDownloadedChapterNumbers()).orElse(List.of()).size());
                        addOrUpdateTitle(title, new NewChapter(chapter));
                    }

                    if (latestSuccessfulChapter != null) {
                        scanKavitaLibraryForType(title.getType());
                    }

                    if (failedChapters.isEmpty()) {
                        trackedTask.setMessage("Title sync completed.");
                        trackedTask.markCompleted();
                    } else {
                        trackedTask.markInterrupted("Title sync paused with pending chapters: " + String.join(", ", failedChapters));
                    }
                    downloadService.updateTrackedTask(trackedTask);
                } finally {
                    downloadService.finalizeTrackedTask(titleName, trackedTask);
                }
            }

            title.setChapterCount(plan.sourceChapterCount());
            title.setLastDownloaded(nextLastDownloaded);
            title.setDownloadedChapterNumbers(mergeDownloadedChapterNumbers(
                    title.getDownloadedChapterNumbers(),
                    Optional.ofNullable(title.getDownloadedChapterFiles()).orElse(Map.of()).keySet()
            ));
            title.setChaptersDownloaded(Optional.ofNullable(title.getDownloadedChapterNumbers()).orElse(List.of()).size());
            addOrUpdateTitle(title, new NewChapter(nextLastDownloaded));

            int totalQueued = plan.queuedChapters().size();
            String status;
            if (totalQueued <= 0) {
                status = "up-to-date";
            } else if (!failedChapters.isEmpty() && !downloadedDuringSync.isEmpty()) {
                status = "partial";
            } else if (!failedChapters.isEmpty()) {
                status = "interrupted";
            } else {
                status = "updated";
            }
            String message = buildTitleSyncMessage(totalQueued, plan.newQueuedCount(), plan.missingQueuedCount());
            if (!failedChapters.isEmpty()) {
                message = message + " Pending retry: " + String.join(", ", failedChapters) + ".";
            }

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
                    plan.newChapterNumbers(),
                    plan.missingChapterNumbers(),
                    Optional.ofNullable(title.getDownloadedChapterNumbers()).orElse(List.of()),
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
                    List.of(),
                    List.of(),
                    Optional.ofNullable(title.getDownloadedChapterNumbers()).orElse(List.of()),
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

        updateCurrentCheckActivity("single", title.getTitleName(), 0, 1);
        try {
            return syncTitleChapters(title);
        } finally {
            clearCurrentCheckActivity();
        }
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

        try {
            for (int index = 0; index < titles.size(); index++) {
                NewTitle title = titles.get(index);
                updateCurrentCheckActivity("library", title.getTitleName(), index, titles.size());

                TitleSyncResult result = syncTitleChapters(title);
                results.add(result);

                if ("updated".equals(result.status())) {
                    updatedTitles++;
                }

                queuedChapters += result.totalQueued();
                newChaptersQueued += result.newChaptersQueued();
                missingChaptersQueued += result.missingChaptersQueued();
            }
        } finally {
            clearCurrentCheckActivity();
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

    public LibraryImportSummary checkAvailableImports() {
        Path downloadedRoot = resolveDownloadedRoot();
        List<Path> manifests = listAvailableImportManifests(downloadedRoot);
        if (manifests.isEmpty()) {
            return new LibraryImportSummary(0, 0, 0, 0, 0, 0, 0, List.of(), "No available .noona imports were found.");
        }

        List<LibraryImportResult> results = new ArrayList<>();
        Set<String> scanTypes = new LinkedHashSet<>();
        int importedTitles = 0;
        int failedImports = 0;
        int queuedChapters = 0;
        int newChaptersQueued = 0;
        int missingChaptersQueued = 0;

        try {
            for (int index = 0; index < manifests.size(); index++) {
                Path manifestPath = manifests.get(index);
                String titleLabel = manifestPath.getParent() != null && manifestPath.getParent().getFileName() != null
                        ? manifestPath.getParent().getFileName().toString()
                        : manifestPath.getFileName().toString();
                updateCurrentCheckActivity("imports", titleLabel, index, manifests.size());

                try {
                    NewTitle manifestTitle = readTitleImportManifest(manifestPath);
                    NewTitle importedTitle = importTitleFromManifest(manifestTitle);
                    if (importedTitle == null) {
                        failedImports++;
                        results.add(new LibraryImportResult(
                                manifestTitle.getUuid(),
                                manifestTitle.getTitleName(),
                                manifestPath.toString(),
                                "error",
                                0,
                                0,
                                0,
                                "Manifest did not produce an importable title."
                        ));
                        continue;
                    }

                    importedTitles++;
                    if (importedTitle.getType() != null && !importedTitle.getType().isBlank()) {
                        scanTypes.add(importedTitle.getType());
                    }

                    TitleSyncResult syncResult = syncTitleChapters(importedTitle);
                    queuedChapters += syncResult.totalQueued();
                    newChaptersQueued += syncResult.newChaptersQueued();
                    missingChaptersQueued += syncResult.missingChaptersQueued();
                    results.add(new LibraryImportResult(
                            syncResult.uuid(),
                            syncResult.title(),
                            manifestPath.toString(),
                            syncResult.status(),
                            syncResult.totalQueued(),
                            syncResult.newChaptersQueued(),
                            syncResult.missingChaptersQueued(),
                            syncResult.message()
                    ));
                } catch (Exception e) {
                    failedImports++;
                    results.add(new LibraryImportResult(
                            null,
                            titleLabel,
                            manifestPath.toString(),
                            "error",
                            0,
                            0,
                            0,
                            "Unable to import manifest: " + e.getMessage()
                    ));
                }
            }
        } finally {
            clearCurrentCheckActivity();
        }

        for (String type : scanTypes) {
            scanKavitaLibraryForType(type);
        }

        StringBuilder message = new StringBuilder()
                .append("Imported ")
                .append(importedTitles)
                .append(" title(s) from ")
                .append(manifests.size())
                .append(" .noona file(s).");
        if (queuedChapters > 0) {
            message.append(" Queued ")
                    .append(queuedChapters)
                    .append(" chapter(s)")
                    .append(" (")
                    .append(newChaptersQueued)
                    .append(" new, ")
                    .append(missingChaptersQueued)
                    .append(" missing).");
        }
        if (!scanTypes.isEmpty()) {
            message.append(" Requested ")
                    .append(scanTypes.size())
                    .append(" Kavita scan(s).");
        }
        if (failedImports > 0) {
            message.append(" Failed imports: ").append(failedImports).append('.');
        }

        return new LibraryImportSummary(
                manifests.size(),
                importedTitles,
                failedImports,
                queuedChapters,
                newChaptersQueued,
                missingChaptersQueued,
                scanTypes.size(),
                results,
                message.toString()
        );
    }

    private boolean isNewer(String latest, String current) {
        return compareChapterNumbers(latest, current) > 0;
    }

    public CheckActivity getCurrentCheckActivity() {
        return currentCheckActivity;
    }

    private void updateCurrentCheckActivity(String mode, String title, int checkedTitles, int totalTitles) {
        currentCheckActivity = new CheckActivity(
                mode,
                Optional.ofNullable(title).orElse("Untitled"),
                Math.max(0, checkedTitles),
                Math.max(1, totalTitles),
                System.currentTimeMillis()
        );
    }

    private void clearCurrentCheckActivity() {
        currentCheckActivity = null;
    }

    private List<Map<String, String>> copyRelatedSeries(List<Map<String, String>> relatedSeries) {
        if (relatedSeries == null || relatedSeries.isEmpty()) {
            return List.of();
        }

        List<Map<String, String>> copied = new ArrayList<>();
        for (Map<String, String> entry : relatedSeries) {
            if (entry == null || entry.isEmpty()) {
                continue;
            }
            copied.add(new LinkedHashMap<>(entry));
        }

        return copied.isEmpty() ? List.of() : copied;
    }

    private record TitleSyncComputation(
            String previousLastDownloaded,
            String latestChapter,
            List<String> queuedChapters,
            List<String> newChapterNumbers,
            List<String> missingChapterNumbers,
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
            List<String> newChapterNumbers,
            List<String> missingChapterNumbers,
            List<String> downloadedChapterNumbers,
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

    public record LibraryImportResult(
            String uuid,
            String title,
            String manifestPath,
            String status,
            int totalQueued,
            int newChaptersQueued,
            int missingChaptersQueued,
            String message
    ) {
    }

    public record LibraryImportSummary(
            int manifestsFound,
            int importedTitles,
            int failedImports,
            int queuedChapters,
            int newChaptersQueued,
            int missingChaptersQueued,
            int scannedLibraries,
            List<LibraryImportResult> results,
            String message
    ) {
    }

    public record RenameSummary(
            boolean attempted,
            int indexedFiles,
            int renamed,
            int unchanged,
            int missingFiles,
            int collisions,
            String message
    ) {
    }

    public record VolumeMapApplyResult(
            NewTitle title,
            RenameSummary renameSummary
    ) {
    }

    public record CheckActivity(
            String mode,
            String title,
            int checkedTitles,
            int totalTitles,
            long updatedAt
    ) {
    }
}
