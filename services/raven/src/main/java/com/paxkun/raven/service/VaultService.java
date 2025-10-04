package com.paxkun.raven.service;

import com.google.gson.Gson;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

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
        try {
            return webClient.post()
                    .uri(vaultUrl + "/v1/vault/handle")
                    .header("Authorization", "Bearer " + vaultApiToken)
                    .bodyValue(packet)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();
        } catch (Exception e) {
            throw new RuntimeException("Vault request failed: " + e.getMessage(), e);
        }
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

        Object data = sendPacket(packet).get("data");
        if (data instanceof Map) {
            return (Map<String, Object>) data;
        }

        return null;
    }

    public List<Map<String, Object>> findAll(String collection) {
        Map<String, Object> payload = Map.of(
                "collection", collection,
                "query", Map.of()
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

            return chapters.get(0).get("chapter_title").replaceAll("[^\\d.]", "");
        } catch (Exception e) {
            log.warn("[VaultService] ⚠️ Failed to fetch latest chapter from source: " + e.getMessage());
            return "0";
        }
    }
}
