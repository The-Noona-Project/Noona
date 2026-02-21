package com.paxkun.raven.service;

import com.google.gson.Gson;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * VaultService handles authenticated communication with Noona Vault using static API tokens.
 * Provides helper methods for MongoDB-style insert, find, update operations.
 *
 * Author: Pax
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class VaultService {

    private final WebClient webClient = WebClient.builder().build();
    private final Gson gson = new Gson();
    private final DownloadService downloadService;

    @Value("${vault.url:http://noona-vault:3005}")
    private String vaultUrl;

    @Value("${vault.apiToken:${VAULT_API_TOKEN:}}")
    private String vaultApiToken;

    // ─────────────────────────────────────────────────────────────
    // AUTH
    /**
     * Send a packet to the Vault service's /v1/vault/handle endpoint and return the parsed JSON response.
     *
     * @param packet the request payload to send to Vault; must be serializable to JSON
     * @return       the response body deserialized to a Map<String, Object>
     * @throws IllegalStateException if the VAULT_API_TOKEN configuration is missing or blank
     * @throws RuntimeException      if the HTTP request to Vault fails
     */

    private Map<String, Object> sendPacket(Map<String, Object> packet) {
        if (vaultApiToken == null || vaultApiToken.isBlank()) {
            throw new IllegalStateException("VAULT_API_TOKEN is not configured. Set the VAULT_API_TOKEN environment variable or the 'vault.apiToken' property.");
        }

        return webClient.post()
                .uri(vaultUrl + "/v1/vault/handle")
                .header("Authorization", "Bearer " + vaultApiToken)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .bodyValue(packet)
                .exchangeToMono(response -> response
                        .bodyToMono(Map.class)
                        .defaultIfEmpty(Collections.emptyMap())
                        .flatMap(body -> {
                            if (!response.statusCode().is2xxSuccessful()) {
                                Object error = body.get("error");
                                String message = error instanceof String && !((String) error).isBlank()
                                        ? (String) error
                                        : "Vault responded with status " + response.statusCode().value();
                                return Mono.error(new RuntimeException(message));
                            }
                            return Mono.just(body);
                        }))
                .block();
    }

    // ─────────────────────────────────────────────────────────────
    // DATABASE OPS
    // ─────────────────────────────────────────────────────────────

    public void insert(String collection, Map<String, Object> doc) {
        Map<String, Object> payload = Map.of(
                "collection", collection,
                "data", doc
        );

        Map<String, Object> packet = Map.of(
                "storageType", "mongo",
                "operation", "insert",
                "payload", payload
        );

        sendPacket(packet);
    }

    public Map<String, Object> findOne(String collection, Map<String, Object> query) {
        Map<String, Object> payload = Map.of(
                "collection", collection,
                "query", query
        );

        Map<String, Object> packet = Map.of(
                "storageType", "mongo",
                "operation", "find",
                "payload", payload
        );

        try {
            Object data = sendPacket(packet).get("data");
            if (data instanceof Map) {
                return (Map<String, Object>) data;
            }

            return null;
        } catch (RuntimeException e) {
            if (e.getMessage() != null && e.getMessage().toLowerCase().contains("no document found")) {
                return null;
            }
            throw e;
        }
    }

    public List<Map<String, Object>> findAll(String collection) {
        return findMany(collection, Map.of());
    }

    public List<Map<String, Object>> findMany(String collection, Map<String, Object> query) {
        Map<String, Object> payload = Map.of(
                "collection", collection,
                "query", query == null ? Map.of() : query
        );

        Map<String, Object> packet = Map.of(
                "storageType", "mongo",
                "operation", "findMany",
                "payload", payload
        );

        Map<String, Object> response = sendPacket(packet);
        if (response == null) {
            return List.of();
        }

        Object data = response.get("data");
        if (!(data instanceof List<?> list)) {
            return List.of();
        }

        List<Map<String, Object>> documents = new ArrayList<>();
        for (Object item : list) {
            if (item instanceof Map<?, ?> map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> document = (Map<String, Object>) map;
                documents.add(document);
            }
        }

        return documents;
    }

    public void update(String collection, Map<String, Object> query, Map<String, Object> update, boolean upsert) {
        Map<String, Object> payload = Map.of(
                "collection", collection,
                "query", query,
                "update", update,
                "upsert", upsert
        );

        Map<String, Object> packet = Map.of(
                "storageType", "mongo",
                "operation", "update",
                "payload", payload
        );

        sendPacket(packet);
    }

    // ─────────────────────────────────────────────────────────────
    // UTILS
    // ─────────────────────────────────────────────────────────────

    /**
     * Deserialize an object to a target type using Gson.
     */
    public <T> T parseJson(Object raw, Type typeOfT) {
        return gson.fromJson(gson.toJson(raw), typeOfT);
    }

    /**
     * Converts a list of Vault documents into typed objects.
     */
    public <T> List<T> parseDocuments(List<Map<String, Object>> docs, Type typeOfT) {
        return gson.fromJson(gson.toJson(docs), typeOfT);
    }

    /**
     * Fetches the latest chapter number from a given manga source URL.
     */
    public String fetchLatestChapterFromSource(String sourceUrl) {
        try {
            List<Map<String, String>> chapters = downloadService.fetchChapters(sourceUrl);
            if (chapters == null || chapters.isEmpty()) return "0";

            Map<String, String> latest = chapters.get(0);
            if (latest == null) {
                return "0";
            }

            String chapterNumber = latest.get("chapter_number");
            if (chapterNumber != null && !chapterNumber.isBlank()) {
                return chapterNumber;
            }

            String extracted = extractChapterNumberFromTitle(latest.get("chapter_title"));
            return extracted != null && !extracted.isBlank() ? extracted : "0";
        } catch (Exception e) {
            log.warn("[VaultService] ⚠️ Failed to fetch latest chapter from source: " + e.getMessage());
            return "0";
        }
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
}
