package com.paxkun.raven.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public class KavitaSyncService {

    private static final ParameterizedTypeReference<List<Map<String, Object>>> LIBRARY_LIST_TYPE =
            new ParameterizedTypeReference<>() {
            };

    private final LoggerService logger;
    private final RestClient restClient;
    private final Set<String> knownLibraries = ConcurrentHashMap.newKeySet();
    private final AtomicBoolean missingConfigLogged = new AtomicBoolean(false);

    @Autowired
    public KavitaSyncService(LoggerService logger) {
        this(logger, RestClient.create());
    }

    KavitaSyncService(LoggerService logger, RestClient restClient) {
        this.logger = logger;
        this.restClient = restClient;
    }

    public void ensureLibraryForType(String libraryName, String folderSegment) {
        String normalizedLibraryName = normalizeLabel(libraryName);
        String normalizedFolderSegment = normalizeFolderSegment(folderSegment);
        if (normalizedLibraryName == null || normalizedFolderSegment == null) {
            return;
        }

        String cacheKey = normalizedLibraryName.toLowerCase(Locale.ROOT);
        if (knownLibraries.contains(cacheKey)) {
            return;
        }

        String baseUrl = normalizeEnv("KAVITA_BASE_URL");
        String apiKey = normalizeEnv("KAVITA_API_KEY");
        String libraryRoot = normalizeContainerPath(normalizeEnv("KAVITA_LIBRARY_ROOT"));
        if (baseUrl == null || apiKey == null || libraryRoot == null) {
            if (missingConfigLogged.compareAndSet(false, true)) {
                logger.info("KAVITA", "Kavita library sync is disabled until KAVITA_BASE_URL, KAVITA_API_KEY, and KAVITA_LIBRARY_ROOT are configured.");
            }
            return;
        }

        try {
            List<Map<String, Object>> libraries = fetchLibraries(baseUrl, apiKey);
            for (Map<String, Object> library : libraries) {
                String existingName = normalizeLabel(library != null ? library.get("name") : null);
                if (existingName != null && existingName.equalsIgnoreCase(normalizedLibraryName)) {
                    knownLibraries.add(cacheKey);
                    return;
                }
            }

            String libraryFolder = joinContainerPath(libraryRoot, normalizedFolderSegment);
            createLibrary(baseUrl, apiKey, buildCreateLibraryPayload(normalizedLibraryName, libraryFolder, libraryName));
            knownLibraries.add(cacheKey);
            logger.info("KAVITA", "Created Kavita library [" + normalizedLibraryName + "] at " + libraryFolder);
        } catch (Exception exception) {
            logger.warn("KAVITA", "Failed to sync Kavita library [" + normalizedLibraryName + "]: " + exception.getMessage());
        }
    }

    protected List<Map<String, Object>> fetchLibraries(String baseUrl, String apiKey) {
        List<Map<String, Object>> response = restClient.get()
                .uri(baseUrl + "/api/Library/libraries")
                .header("X-Api-Key", apiKey)
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .body(LIBRARY_LIST_TYPE);

        return response != null ? response : List.of();
    }

    protected void createLibrary(String baseUrl, String apiKey, Map<String, Object> payload) {
        restClient.post()
                .uri(baseUrl + "/api/Library/create")
                .header("X-Api-Key", apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .body(payload)
                .retrieve()
                .toBodilessEntity();
    }

    private Map<String, Object> buildCreateLibraryPayload(String libraryName, String folderPath, String rawType) {
        return Map.ofEntries(
                Map.entry("id", 0),
                Map.entry("name", libraryName),
                Map.entry("type", resolveLibraryType(rawType)),
                Map.entry("folders", List.of(folderPath)),
                Map.entry("folderWatching", true),
                Map.entry("includeInDashboard", true),
                Map.entry("includeInSearch", true),
                Map.entry("manageCollections", true),
                Map.entry("manageReadingLists", true),
                Map.entry("allowScrobbling", false),
                Map.entry("allowMetadataMatching", true),
                Map.entry("enableMetadata", true),
                Map.entry("removePrefixForSortName", false),
                Map.entry("inheritWebLinksFromFirstChapter", false),
                Map.entry("fileGroupTypes", resolveFileGroupTypes(rawType)),
                Map.entry("excludePatterns", List.of())
        );
    }

    private Integer resolveLibraryType(String rawType) {
        String normalized = normalizeLabel(rawType);
        if (normalized == null) {
            return 0;
        }

        String lower = normalized.toLowerCase(Locale.ROOT);
        if (lower.contains("novel") || lower.contains("book")) {
            return lower.contains("light") ? 4 : 2;
        }
        if (lower.contains("comic") || lower.contains("webtoon")) {
            return 1;
        }
        if (lower.contains("image") || lower.contains("art")) {
            return 3;
        }
        return 0;
    }

    private List<Integer> resolveFileGroupTypes(String rawType) {
        String normalized = normalizeLabel(rawType);
        if (normalized == null) {
            return List.of(1, 4);
        }

        String lower = normalized.toLowerCase(Locale.ROOT);
        List<Integer> fileGroups = new ArrayList<>();
        if (lower.contains("novel") || lower.contains("book")) {
            fileGroups.add(1);
            fileGroups.add(2);
            fileGroups.add(3);
            return fileGroups;
        }

        fileGroups.add(1);
        fileGroups.add(4);
        return fileGroups;
    }

    private String normalizeEnv(String key) {
        return normalizeLabel(System.getenv(key));
    }

    private String normalizeLabel(Object value) {
        if (value == null) {
            return null;
        }

        String normalized = String.valueOf(value).trim();
        return normalized.isBlank() ? null : normalized;
    }

    private String normalizeFolderSegment(String value) {
        String normalized = normalizeLabel(value);
        if (normalized == null) {
            return null;
        }

        String cleaned = normalized
                .replace('\\', '/')
                .replaceAll("/+", "/")
                .replaceAll("^/+", "")
                .replaceAll("/+$", "");
        return cleaned.isBlank() ? null : cleaned;
    }

    private String normalizeContainerPath(String value) {
        String normalized = normalizeLabel(value);
        if (normalized == null) {
            return null;
        }

        String cleaned = normalized
                .replace('\\', '/')
                .replaceAll("/+", "/")
                .replaceAll("/+$", "");
        if (cleaned.isBlank()) {
            return null;
        }

        return cleaned.startsWith("/") ? cleaned : "/" + cleaned;
    }

    private String joinContainerPath(String root, String folderSegment) {
        return normalizeContainerPath(root + "/" + folderSegment);
    }
}
