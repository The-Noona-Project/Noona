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

        String portalBaseUrl = resolvePortalBaseUrlEnv();
        String baseUrl = resolveKavitaBaseUrlEnv();
        String apiKey = resolveKavitaApiKeyEnv();
        String libraryRoot = resolveKavitaLibraryRootEnv();
        if (libraryRoot == null) {
            if (missingConfigLogged.compareAndSet(false, true)) {
                logger.info("KAVITA", "Kavita library sync is disabled until KAVITA_LIBRARY_ROOT is configured.");
            }
            return;
        }

        List<String> libraryFolders = buildLibraryFolders(libraryRoot, normalizedFolderSegment);
        if (libraryFolders.isEmpty()) {
            return;
        }

        String primaryLibraryFolder = libraryFolders.get(0);
        Map<String, Object> createPayload = buildCreateLibraryPayload(normalizedLibraryName, libraryFolders, libraryName);

        if (portalBaseUrl != null) {
            try {
                ensureLibraryViaPortal(portalBaseUrl, normalizedLibraryName, createPayload);
                knownLibraries.add(cacheKey);
                logger.info("KAVITA", "Ensured Kavita library [" + normalizedLibraryName + "] via Portal at " + primaryLibraryFolder);
                return;
            } catch (Exception exception) {
                logger.warn("KAVITA", "Portal Kavita sync failed for [" + normalizedLibraryName + "]: " + exception.getMessage());
            }
        }

        if (baseUrl == null || apiKey == null) {
            if (missingConfigLogged.compareAndSet(false, true)) {
                logger.info("KAVITA", "Kavita library sync is disabled until Portal or direct Kavita credentials are configured.");
            }
            return;
        }

        try {
            List<Map<String, Object>> libraries = fetchLibraries(baseUrl, apiKey);
            for (Map<String, Object> library : libraries) {
                String existingName = normalizeLabel(library != null ? library.get("name") : null);
                if (existingName != null && existingName.equalsIgnoreCase(normalizedLibraryName)) {
                    List<String> existingFolders = normalizeFolderList(library != null ? library.get("folders") : null);
                    List<String> mergedFolders = mergeFolderLists(libraryFolders, existingFolders);
                    Integer libraryId = parseInteger(library != null ? library.get("id") : null);

                    if (!sameFolderSet(existingFolders, mergedFolders) && libraryId != null && libraryId > 0) {
                        updateLibrary(baseUrl, apiKey, libraryId, normalizedLibraryName, mergedFolders);
                        logger.info("KAVITA", "Updated Kavita library [" + normalizedLibraryName + "] folders to include " + primaryLibraryFolder);
                    }

                    knownLibraries.add(cacheKey);
                    return;
                }
            }

            createLibrary(baseUrl, apiKey, createPayload);
            knownLibraries.add(cacheKey);
            logger.info("KAVITA", "Created Kavita library [" + normalizedLibraryName + "] at " + primaryLibraryFolder);
        } catch (Exception exception) {
            logger.warn("KAVITA", "Failed to sync Kavita library [" + normalizedLibraryName + "]: " + exception.getMessage());
        }
    }

    public void scanLibraryForType(String libraryName, String folderSegment) {
        String normalizedLibraryName = normalizeLabel(libraryName);
        String normalizedFolderSegment = normalizeFolderSegment(folderSegment);
        if (normalizedLibraryName == null) {
            return;
        }

        if (normalizedFolderSegment != null && resolveKavitaLibraryRootEnv() != null) {
            ensureLibraryForType(normalizedLibraryName, normalizedFolderSegment);
        }

        String portalBaseUrl = resolvePortalBaseUrlEnv();
        String baseUrl = resolveKavitaBaseUrlEnv();
        String apiKey = resolveKavitaApiKeyEnv();

        if (portalBaseUrl != null) {
            try {
                scanLibraryViaPortal(portalBaseUrl, normalizedLibraryName, false);
                logger.info("KAVITA", "Queued Kavita scan for [" + normalizedLibraryName + "] via Portal.");
                return;
            } catch (Exception exception) {
                logger.warn("KAVITA", "Portal Kavita scan failed for [" + normalizedLibraryName + "]: " + exception.getMessage());
            }
        }

        if (baseUrl == null || apiKey == null) {
            if (missingConfigLogged.compareAndSet(false, true)) {
                logger.info("KAVITA", "Kavita library sync is disabled until Portal or direct Kavita credentials are configured.");
            }
            return;
        }

        try {
            Integer libraryId = findLibraryId(fetchLibraries(baseUrl, apiKey), normalizedLibraryName);
            if (libraryId == null) {
                logger.warn("KAVITA", "Unable to find Kavita library [" + normalizedLibraryName + "] for scan.");
                return;
            }

            scanLibrary(baseUrl, apiKey, libraryId, false);
            logger.info("KAVITA", "Queued direct Kavita scan for [" + normalizedLibraryName + "] (id=" + libraryId + ").");
        } catch (Exception exception) {
            logger.warn("KAVITA", "Failed to scan Kavita library [" + normalizedLibraryName + "]: " + exception.getMessage());
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

    protected void updateLibrary(String baseUrl, String apiKey, int libraryId, String libraryName, List<String> folders) {
        restClient.post()
                .uri(baseUrl + "/api/Library/update")
                .header("X-Api-Key", apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .body(Map.of(
                        "id", libraryId,
                        "name", libraryName,
                        "folders", folders
                ))
                .retrieve()
                .toBodilessEntity();
    }

    protected void ensureLibraryViaPortal(String portalBaseUrl, String libraryName, Map<String, Object> payload) {
        restClient.post()
                .uri(portalBaseUrl + "/api/portal/kavita/libraries/ensure")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .body(Map.of(
                        "name", libraryName,
                        "payload", payload
                ))
                .retrieve()
                .toBodilessEntity();
    }

    protected void scanLibraryViaPortal(String portalBaseUrl, String libraryName, boolean force) {
        restClient.post()
                .uri(portalBaseUrl + "/api/portal/kavita/libraries/scan")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .body(Map.of(
                        "name", libraryName,
                        "force", force
                ))
                .retrieve()
                .toBodilessEntity();
    }

    protected void scanLibrary(String baseUrl, String apiKey, int libraryId, boolean force) {
        restClient.post()
                .uri(baseUrl + "/api/Library/scan?libraryId=" + libraryId + "&force=" + force)
                .header("X-Api-Key", apiKey)
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .toBodilessEntity();
    }

    private Map<String, Object> buildCreateLibraryPayload(String libraryName, List<String> folderPaths, String rawType) {
        return Map.ofEntries(
                Map.entry("id", 0),
                Map.entry("name", libraryName),
                Map.entry("type", resolveLibraryType(rawType)),
                Map.entry("folders", folderPaths),
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

    private List<String> buildLibraryFolders(String libraryRoot, String folderSegment) {
        String normalizedRoot = normalizeContainerPath(libraryRoot);
        String normalizedFolderSegment = normalizeFolderSegment(folderSegment);
        if (normalizedRoot == null || normalizedFolderSegment == null) {
            return List.of();
        }

        String legacyRoot = resolveLegacyLibraryRoot(normalizedRoot);
        String currentRoot = normalizedRoot.endsWith("/downloaded")
                ? normalizedRoot
                : joinContainerPath(normalizedRoot, "downloaded");
        String nestedRoot = joinContainerPath(legacyRoot, "Noona", "raven", "downloads");
        String nestedCurrentRoot = joinContainerPath(nestedRoot, "downloaded");

        LinkedHashSet<String> folders = new LinkedHashSet<>();
        addFolderCandidate(folders, currentRoot, normalizedFolderSegment);
        addFolderCandidate(folders, legacyRoot, normalizedFolderSegment);
        addFolderCandidate(folders, nestedCurrentRoot, normalizedFolderSegment);
        addFolderCandidate(folders, nestedRoot, normalizedFolderSegment);
        return List.copyOf(folders);
    }

    private void addFolderCandidate(Set<String> folders, String root, String folderSegment) {
        String joined = joinContainerPath(root, folderSegment);
        if (joined != null) {
            folders.add(joined);
        }
    }

    private String resolveLegacyLibraryRoot(String normalizedRoot) {
        if (normalizedRoot == null) {
            return null;
        }

        if (!normalizedRoot.endsWith("/downloaded")) {
            return normalizedRoot;
        }

        String stripped = normalizedRoot.substring(0, normalizedRoot.length() - "/downloaded".length());
        if (stripped.isBlank()) {
            return "/";
        }

        return stripped;
    }

    private List<String> normalizeFolderList(Object value) {
        if (!(value instanceof List<?> folders)) {
            return List.of();
        }

        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (Object folder : folders) {
            String candidate = null;
            if (folder instanceof String rawFolder) {
                candidate = normalizeContainerPath(rawFolder);
            } else if (folder instanceof Map<?, ?> map) {
                candidate = normalizeContainerPath(
                        normalizeLabel(
                                map.get("path") != null
                                        ? map.get("path")
                                        : map.get("folderPath") != null
                                        ? map.get("folderPath")
                                        : map.get("fullPath")
                        )
                );
            }

            if (candidate != null) {
                normalized.add(candidate);
            }
        }

        return List.copyOf(normalized);
    }

    private List<String> mergeFolderLists(List<String> expectedFolders, List<String> existingFolders) {
        LinkedHashSet<String> merged = new LinkedHashSet<>();
        merged.addAll(expectedFolders != null ? expectedFolders : List.of());
        merged.addAll(existingFolders != null ? existingFolders : List.of());
        return List.copyOf(merged);
    }

    private boolean sameFolderSet(List<String> left, List<String> right) {
        return new LinkedHashSet<>(left != null ? left : List.of())
                .equals(new LinkedHashSet<>(right != null ? right : List.of()));
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

    protected String resolvePortalBaseUrlEnv() {
        return normalizeLabel(System.getenv("PORTAL_BASE_URL"));
    }

    protected String resolveKavitaBaseUrlEnv() {
        return normalizeLabel(System.getenv("KAVITA_BASE_URL"));
    }

    protected String resolveKavitaApiKeyEnv() {
        return normalizeLabel(System.getenv("KAVITA_API_KEY"));
    }

    protected String resolveKavitaLibraryRootEnv() {
        return normalizeContainerPath(normalizeLabel(System.getenv("KAVITA_LIBRARY_ROOT")));
    }

    private Integer findLibraryId(List<Map<String, Object>> libraries, String libraryName) {
        for (Map<String, Object> library : libraries) {
            String existingName = normalizeLabel(library != null ? library.get("name") : null);
            if (existingName == null || !existingName.equalsIgnoreCase(libraryName)) {
                continue;
            }

            Integer id = parseInteger(library.get("id"));
            if (id != null && id > 0) {
                return id;
            }
        }

        return null;
    }

    private Integer parseInteger(Object value) {
        if (value instanceof Number number) {
            return number.intValue();
        }

        String normalized = normalizeLabel(value);
        if (normalized == null) {
            return null;
        }

        try {
            return Integer.parseInt(normalized);
        } catch (NumberFormatException ignored) {
            return null;
        }
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

    private String joinContainerPath(String root, String... segments) {
        String current = normalizeContainerPath(root);
        if (current == null) {
            return null;
        }

        for (String segment : segments) {
            String normalizedSegment = normalizeFolderSegment(segment);
            if (normalizedSegment == null) {
                continue;
            }

            current = normalizeContainerPath(current + "/" + normalizedSegment);
        }

        return current;
    }
}
