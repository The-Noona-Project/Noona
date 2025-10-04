package com.paxkun.raven.service;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Type;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class VaultServiceTest {

    private static final Gson GSON = new Gson();

    private HttpServer server;
    private int port;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress(0), 0);
        port = server.getAddress().getPort();
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void findAllRequestsFindManyAndReturnsDocuments() {
        DownloadService downloadService = Mockito.mock(DownloadService.class);
        VaultService vaultService = new VaultService(downloadService);

        AtomicReference<String> capturedBody = new AtomicReference<>();
        AtomicReference<String> capturedAuth = new AtomicReference<>();

        List<Map<String, Object>> mockDocs = List.of(
                Map.of("title", "Solo Leveling"),
                Map.of("title", "Omniscient Reader")
        );

        server.createContext("/v1/vault/handle", exchange -> {
            capturedAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            capturedBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));

            byte[] responseBytes = GSON.toJson(Map.of(
                    "status", "ok",
                    "data", mockDocs
            )).getBytes(StandardCharsets.UTF_8);

            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, responseBytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(responseBytes);
            }
        });
        server.start();

        ReflectionTestUtils.setField(vaultService, "vaultUrl", "http://127.0.0.1:" + port);
        ReflectionTestUtils.setField(vaultService, "vaultApiToken", "test-token");

        List<Map<String, Object>> documents = vaultService.findAll("manga_library");

        assertThat(documents).containsExactlyElementsOf(mockDocs);
        assertEquals("Bearer test-token", capturedAuth.get());

        String body = capturedBody.get();
        assertNotNull(body);
        Type type = new TypeToken<Map<String, Object>>() {}.getType();
        Map<String, Object> request = GSON.fromJson(body, type);

        assertEquals("mongo", request.get("storageType"));
        assertEquals("findMany", request.get("operation"));
    }
}
