package com.paxkun.raven.service;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.lang.reflect.Type;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * VaultService handles secure communication with Noona Vault using JWT auth.
 * Provides basic database operations (insert, find, update) on MongoDB via Vault.
 *
 * Author: Pax
 */
@Slf4j
@Service
public class VaultService {

    private final WebClient webClient;
    private final Gson gson = new Gson();

    @Value("${vault.url:http://noona-vault:3005}")
    private String vaultUrl;

    @Value("${WARDENPASS}")
    private String wardenPass;

    private String jwtToken;

    public VaultService() {
        this.webClient = WebClient.builder().build();
    }

    private void ensureAuth() {
        if (jwtToken == null || jwtToken.isEmpty()) {
            log.info("[VaultService] 🔐 Authenticating with Vault...");
            Map<String, String> authRequest = Map.of("password", wardenPass);

            try {
                Map<?, ?> res = webClient.post()
                        .uri(vaultUrl + "/v1/auth")
                        .bodyValue(authRequest)
                        .retrieve()
                        .bodyToMono(Map.class)
                        .block();

                this.jwtToken = (String) res.get("token");
                log.info("[VaultService] ✅ JWT token received.");
            } catch (Exception e) {
                throw new RuntimeException("Failed to authenticate with Vault: " + e.getMessage(), e);
            }
        }
    }

    private Map<String, Object> sendPacket(Map<String, Object> packet) {
        ensureAuth();
        try {
            return webClient.post()
                    .uri(vaultUrl + "/v1/vault/handle")
                    .header("x-service-token", jwtToken)
                    .bodyValue(packet)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block();
        } catch (Exception e) {
            throw new RuntimeException("Vault request failed: " + e.getMessage(), e);
        }
    }

    public void insert(String collection, Map<String, Object> doc) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("collection", collection);
        payload.put("data", doc);

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

        return (Map<String, Object>) sendPacket(packet).get("data");
    }

    public List<Map<String, Object>> findAll(String collection) {
        Map<String, Object> payload = Map.of(
                "collection", collection,
                "query", Map.of()
        );

        Map<String, Object> packet = Map.of(
                "storageType", "mongo",
                "operation", "find",
                "payload", payload
        );

        Object data = sendPacket(packet).get("data");
        if (data == null) return List.of();

        Type listType = new TypeToken<List<Map<String, Object>>>() {}.getType();
        return gson.fromJson(gson.toJson(data), listType);
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

    // ──────────────────────────────
    // UTILITY: JSON wrapper
    // ──────────────────────────────

    public <T> T parseJson(Object raw, Type typeOfT) {
        return gson.fromJson(gson.toJson(raw), typeOfT);
    }

    // ──────────────────────────────
    // UTILITY: FETCH LATEST CHAPTER
    // ──────────────────────────────

    public String fetchLatestChapterFromSource(String sourceUrl) {
        try {
            List<Map<String, String>> chapters = DownloadService.parseChapters(sourceUrl);
            if (chapters == null || chapters.isEmpty()) return "0";
            return chapters.get(0).get("chapter_title").replaceAll("[^\\d.]", "");
        } catch (Exception e) {
            log.warn("[VaultService] ⚠️ Failed to fetch latest chapter from source: " + e.getMessage());
            return "0";
        }
    }
}
