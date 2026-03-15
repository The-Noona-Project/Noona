/**
 * Handles Raven storage requests through Vault Mongo and Redis packets.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/settings/SettingsService.java
 * - src/test/java/com/paxkun/raven/service/VaultServiceTest.java
 * Times this file has been edited: 13
 */
package com.paxkun.raven.service;

import com.google.gson.Gson;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import io.netty.handler.ssl.SslContext;
import io.netty.handler.ssl.SslContextBuilder;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import reactor.core.publisher.Mono;
import reactor.netty.http.client.HttpClient;

import java.io.File;
import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.Collections;
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
    private static final int READ_RETRY_ATTEMPTS = 4;
    private static final long READ_RETRY_BACKOFF_MS = 250L;

    private final Gson gson = new Gson();
    private volatile WebClient webClient;

    @Value("${vault.url:https://noona-vault:3005}")
    private String vaultUrl;

    @Value("${vault.apiToken:${VAULT_API_TOKEN:}}")
    private String vaultApiToken;

    @Value("${vault.caCertPath:${VAULT_CA_CERT_PATH:}}")
    private String vaultCaCertPath;

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
        return sendPacket(packet, false);
    }

    private Map<String, Object> sendPacket(Map<String, Object> packet, boolean retryTransientReadFailures) {
        if (vaultApiToken == null || vaultApiToken.isBlank()) {
            throw new IllegalStateException("VAULT_API_TOKEN is not configured. Set the VAULT_API_TOKEN environment variable or the 'vault.apiToken' property.");
        }

        int maxAttempts = retryTransientReadFailures ? READ_RETRY_ATTEMPTS : 1;
        RuntimeException lastError = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return sendPacketOnce(packet);
            } catch (RuntimeException e) {
                lastError = e;
                boolean canRetry = retryTransientReadFailures
                        && attempt < maxAttempts
                        && isTransientVaultFailure(e);
                if (!canRetry) {
                    throw e;
                }

                try {
                    Thread.sleep(READ_RETRY_BACKOFF_MS * attempt);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new RuntimeException("Interrupted while retrying Vault packet.", interrupted);
                }
            }
        }

        throw lastError == null ? new RuntimeException("Vault request failed.") : lastError;
    }

    private Map<String, Object> sendPacketOnce(Map<String, Object> packet) {
        return getWebClient().post()
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

    private WebClient getWebClient() {
        WebClient current = webClient;
        if (current != null) {
            return current;
        }

        synchronized (this) {
            if (webClient != null) {
                return webClient;
            }

            webClient = buildWebClient();
            return webClient;
        }
    }

    private WebClient buildWebClient() {
        String normalizedUrl = vaultUrl == null ? "" : vaultUrl.trim();
        if (normalizedUrl.startsWith("https://")) {
            String caPath = vaultCaCertPath == null ? "" : vaultCaCertPath.trim();
            if (caPath.isEmpty()) {
                throw new IllegalStateException("VAULT_CA_CERT_PATH is required when vault.url uses HTTPS.");
            }

            File caFile = new File(caPath);
            if (!caFile.isFile()) {
                throw new IllegalStateException("Vault CA certificate file does not exist: " + caPath);
            }

            try {
                SslContext sslContext = SslContextBuilder.forClient()
                        .trustManager(caFile)
                        .build();
                HttpClient httpClient = HttpClient.create()
                        .secure(spec -> spec.sslContext(sslContext));
                return WebClient.builder()
                        .clientConnector(new ReactorClientHttpConnector(httpClient))
                        .build();
            } catch (Exception error) {
                throw new IllegalStateException("Unable to configure HTTPS trust for Vault: " + error.getMessage(), error);
            }
        }

        return WebClient.builder().build();
    }

    private boolean isTransientVaultFailure(RuntimeException error) {
        if (error instanceof WebClientRequestException) {
            return true;
        }

        String message = error.getMessage();
        if (message == null || message.isBlank()) {
            return false;
        }

        String normalized = message.toLowerCase();
        return normalized.contains("connection refused")
                || normalized.contains("failed to connect")
                || normalized.contains("timed out")
                || normalized.contains("timeout")
                || normalized.contains("internal server error")
                || normalized.contains("service unavailable")
                || normalized.contains("status 500")
                || normalized.contains("status 502")
                || normalized.contains("status 503")
                || normalized.contains("status 504");
    }

    // ─────────────────────────────────────────────────────────────
    // DATABASE OPS
    // ─────────────────────────────────────────────────────────────

    /**
     * Handles insert.
     *
     * @param collection The Vault collection name.
     * @param doc        The doc.
     */

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

    /**
     * Finds one.
     *
     * @param collection The Vault collection name.
     * @param query The query document.
     * @return The resulting Object>.
    */

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
            Object data = sendPacket(packet, true).get("data");
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

    /**
     * Finds all.
     *
     * @param collection The Vault collection name.
     * @return The resulting Object>>.
    */

    public List<Map<String, Object>> findAll(String collection) {
        return findMany(collection, Map.of());
    }

    /**
     * Finds many.
     *
     * @param collection The Vault collection name.
     * @param query The query document.
     * @return The resulting Object>>.
    */

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

        Map<String, Object> response = sendPacket(packet, true);
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

    /**
     * Handles update.
     *
     * @param collection The Vault collection name.
     * @param query The query document.
     * @param update The update document.
     * @param upsert Whether upsert should be enabled.
    */

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

    /**
     * Handles delete.
     *
     * @param collection The Vault collection name.
     * @param query The query document.
    */

    public void delete(String collection, Map<String, Object> query) {
        Map<String, Object> payload = Map.of(
                "collection", collection,
                "query", query
        );

        Map<String, Object> packet = Map.of(
                "storageType", "mongo",
                "operation", "delete",
                "payload", payload
        );

        sendPacket(packet);
    }

    /**
     * Updates redis value.
     *
     * @param key The Redis key.
     * @param value The value to store.
    */

    public void setRedisValue(String key, Object value) {
        setRedisValue(key, value, null);
    }

    /**
     * Updates redis value.
     *
     * @param key The Redis key.
     * @param value The value to store.
     * @param ttlSeconds The Redis time-to-live in seconds.
    */

    public void setRedisValue(String key, Object value, Integer ttlSeconds) {
        if (key == null || key.isBlank()) {
            throw new IllegalArgumentException("Redis key is required.");
        }

        java.util.LinkedHashMap<String, Object> payload = new java.util.LinkedHashMap<>();
        payload.put("key", key.trim());
        payload.put("value", value);
        if (ttlSeconds != null && ttlSeconds > 0) {
            payload.put("ttl", ttlSeconds);
        }

        Map<String, Object> packet = Map.of(
                "storageType", "redis",
                "operation", "set",
                "payload", payload
        );

        sendPacket(packet);
    }

    /**
     * Returns redis value.
     *
     * @param key The Redis key.
     * @return The resulting Object.
    */

    public Object getRedisValue(String key) {
        if (key == null || key.isBlank()) {
            throw new IllegalArgumentException("Redis key is required.");
        }

        Map<String, Object> packet = Map.of(
                "storageType", "redis",
                "operation", "get",
                "payload", Map.of("key", key.trim())
        );

        try {
            return sendPacket(packet, true).get("data");
        } catch (RuntimeException e) {
            if (e.getMessage() != null && e.getMessage().toLowerCase().contains("key not found")) {
                return null;
            }
            throw e;
        }
    }

    /**
     * Deletes redis value.
     *
     * @param key The Redis key.
    */

    public void deleteRedisValue(String key) {
        if (key == null || key.isBlank()) {
            throw new IllegalArgumentException("Redis key is required.");
        }

        Map<String, Object> packet = Map.of(
                "storageType", "redis",
                "operation", "del",
                "payload", Map.of("key", key.trim())
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
}
