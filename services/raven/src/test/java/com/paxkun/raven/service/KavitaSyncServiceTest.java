package com.paxkun.raven.service;

import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class KavitaSyncServiceTest {

    @Test
    void ensureLibraryForTypeUsesPortalRouteAndCachesKnownLibraries() {
        LoggerService logger = mock(LoggerService.class);
        AtomicInteger portalCalls = new AtomicInteger();
        AtomicReference<String> portalBaseUrl = new AtomicReference<>();
        AtomicReference<String> portalLibraryName = new AtomicReference<>();
        AtomicReference<Map<String, Object>> portalPayload = new AtomicReference<>();

        KavitaSyncService service = new KavitaSyncService(logger, RestClient.create()) {
            @Override
            protected String resolvePortalBaseUrlEnv() {
                return "http://noona-portal:3003";
            }

            @Override
            protected String resolveKavitaBaseUrlEnv() {
                return "http://noona-kavita:5000";
            }

            @Override
            protected String resolveKavitaApiKeyEnv() {
                return "portal-api-key";
            }

            @Override
            protected String resolveKavitaLibraryRootEnv() {
                return "/manga";
            }

            @Override
            protected void ensureLibraryViaPortal(String nextPortalBaseUrl, String libraryName, Map<String, Object> payload) {
                portalCalls.incrementAndGet();
                portalBaseUrl.set(nextPortalBaseUrl);
                portalLibraryName.set(libraryName);
                portalPayload.set(payload);
            }

            @Override
            protected List<Map<String, Object>> fetchLibraries(String baseUrl, String apiKey) {
                throw new AssertionError("Direct Kavita lookup should not run when Portal sync succeeds.");
            }

            @Override
            protected void createLibrary(String baseUrl, String apiKey, Map<String, Object> payload) {
                throw new AssertionError("Direct Kavita create should not run when Portal sync succeeds.");
            }
        };

        service.ensureLibraryForType("Manhwa", "manhwa");
        service.ensureLibraryForType("Manhwa", "manhwa");

        assertThat(portalCalls.get()).isEqualTo(1);
        assertThat(portalBaseUrl.get()).isEqualTo("http://noona-portal:3003");
        assertThat(portalLibraryName.get()).isEqualTo("Manhwa");
        assertThat(portalPayload.get())
                .containsEntry("name", "Manhwa")
                .containsEntry("type", 0)
                .containsEntry("folders", List.of(
                        "/manga/downloaded/manhwa",
                        "/manga/manhwa",
                        "/manga/Noona/raven/downloads/downloaded/manhwa",
                        "/manga/Noona/raven/downloads/manhwa"
                ))
                .containsEntry("fileGroupTypes", List.of(1, 4));
    }

    @Test
    void ensureLibraryForTypeFallsBackToDirectKavitaWhenPortalSyncFails() {
        LoggerService logger = mock(LoggerService.class);
        AtomicInteger portalCalls = new AtomicInteger();
        AtomicReference<String> directBaseUrl = new AtomicReference<>();
        AtomicReference<String> directApiKey = new AtomicReference<>();
        AtomicReference<Map<String, Object>> directPayload = new AtomicReference<>();

        KavitaSyncService service = new KavitaSyncService(logger, RestClient.create()) {
            @Override
            protected String resolvePortalBaseUrlEnv() {
                return "http://noona-portal:3003";
            }

            @Override
            protected String resolveKavitaBaseUrlEnv() {
                return "http://noona-kavita:5000";
            }

            @Override
            protected String resolveKavitaApiKeyEnv() {
                return "direct-api-key";
            }

            @Override
            protected String resolveKavitaLibraryRootEnv() {
                return "/manga";
            }

            @Override
            protected void ensureLibraryViaPortal(String portalBaseUrl, String libraryName, Map<String, Object> payload) {
                portalCalls.incrementAndGet();
                throw new IllegalStateException("Portal unavailable");
            }

            @Override
            protected List<Map<String, Object>> fetchLibraries(String baseUrl, String apiKey) {
                return List.of();
            }

            @Override
            protected void createLibrary(String baseUrl, String apiKey, Map<String, Object> payload) {
                directBaseUrl.set(baseUrl);
                directApiKey.set(apiKey);
                directPayload.set(payload);
            }
        };

        service.ensureLibraryForType("Light Novel", "light-novel");

        assertThat(portalCalls.get()).isEqualTo(1);
        assertThat(directBaseUrl.get()).isEqualTo("http://noona-kavita:5000");
        assertThat(directApiKey.get()).isEqualTo("direct-api-key");
        assertThat(directPayload.get())
                .containsEntry("name", "Light Novel")
                .containsEntry("type", 4)
                .containsEntry("folders", List.of(
                        "/manga/downloaded/light-novel",
                        "/manga/light-novel",
                        "/manga/Noona/raven/downloads/downloaded/light-novel",
                        "/manga/Noona/raven/downloads/light-novel"
                ))
                .containsEntry("fileGroupTypes", List.of(1, 2, 3));
        verify(logger).warn(eq("KAVITA"), contains("Portal Kavita sync failed for [Light Novel]"));
    }

    @Test
    void ensureLibraryForTypeUpdatesExistingLibraryFoldersWhenCurrentRootIsMissing() {
        LoggerService logger = mock(LoggerService.class);
        AtomicReference<Map<String, Object>> updatePayload = new AtomicReference<>();

        KavitaSyncService service = new KavitaSyncService(logger, RestClient.create()) {
            @Override
            protected String resolvePortalBaseUrlEnv() {
                return null;
            }

            @Override
            protected String resolveKavitaBaseUrlEnv() {
                return "http://noona-kavita:5000";
            }

            @Override
            protected String resolveKavitaApiKeyEnv() {
                return "direct-api-key";
            }

            @Override
            protected String resolveKavitaLibraryRootEnv() {
                return "/manga";
            }

            @Override
            protected List<Map<String, Object>> fetchLibraries(String baseUrl, String apiKey) {
                return List.of(Map.of(
                        "id", 12,
                        "name", "Manhwa",
                        "folders", List.of("/manga/manhwa")
                ));
            }

            @Override
            protected void updateLibrary(String baseUrl, String apiKey, int libraryId, String libraryName, List<String> folders) {
                updatePayload.set(Map.of(
                        "id", libraryId,
                        "name", libraryName,
                        "folders", folders
                ));
            }
        };

        service.ensureLibraryForType("Manhwa", "manhwa");

        assertThat(updatePayload.get()).isEqualTo(Map.of(
                "id", 12,
                "name", "Manhwa",
                "folders", List.of(
                        "/manga/downloaded/manhwa",
                        "/manga/manhwa",
                        "/manga/Noona/raven/downloads/downloaded/manhwa",
                        "/manga/Noona/raven/downloads/manhwa"
                )
        ));
    }

    @Test
    void scanLibraryForTypeUsesPortalRouteWhenAvailable() {
        LoggerService logger = mock(LoggerService.class);
        AtomicInteger portalCalls = new AtomicInteger();
        AtomicReference<String> portalBaseUrl = new AtomicReference<>();
        AtomicReference<String> portalLibraryName = new AtomicReference<>();
        AtomicReference<Boolean> portalForce = new AtomicReference<>();

        KavitaSyncService service = new KavitaSyncService(logger, RestClient.create()) {
            @Override
            protected String resolvePortalBaseUrlEnv() {
                return "http://noona-portal:3003";
            }

            @Override
            protected String resolveKavitaBaseUrlEnv() {
                return "http://noona-kavita:5000";
            }

            @Override
            protected String resolveKavitaApiKeyEnv() {
                return "portal-api-key";
            }

            @Override
            protected String resolveKavitaLibraryRootEnv() {
                return null;
            }

            @Override
            protected void scanLibraryViaPortal(String nextPortalBaseUrl, String libraryName, boolean force) {
                portalCalls.incrementAndGet();
                portalBaseUrl.set(nextPortalBaseUrl);
                portalLibraryName.set(libraryName);
                portalForce.set(force);
            }

            @Override
            protected List<Map<String, Object>> fetchLibraries(String baseUrl, String apiKey) {
                throw new AssertionError("Direct Kavita lookup should not run when Portal scan succeeds.");
            }

            @Override
            protected void scanLibrary(String baseUrl, String apiKey, int libraryId, boolean force) {
                throw new AssertionError("Direct Kavita scan should not run when Portal scan succeeds.");
            }
        };

        service.scanLibraryForType("Manhwa", "manhwa");

        assertThat(portalCalls.get()).isEqualTo(1);
        assertThat(portalBaseUrl.get()).isEqualTo("http://noona-portal:3003");
        assertThat(portalLibraryName.get()).isEqualTo("Manhwa");
        assertThat(portalForce.get()).isFalse();
    }

    @Test
    void scanLibraryForTypeFallsBackToDirectKavitaWhenPortalScanFails() {
        LoggerService logger = mock(LoggerService.class);
        AtomicInteger portalCalls = new AtomicInteger();
        AtomicReference<String> directBaseUrl = new AtomicReference<>();
        AtomicReference<String> directApiKey = new AtomicReference<>();
        AtomicReference<Integer> directLibraryId = new AtomicReference<>();
        AtomicReference<Boolean> directForce = new AtomicReference<>();

        KavitaSyncService service = new KavitaSyncService(logger, RestClient.create()) {
            @Override
            protected String resolvePortalBaseUrlEnv() {
                return "http://noona-portal:3003";
            }

            @Override
            protected String resolveKavitaBaseUrlEnv() {
                return "http://noona-kavita:5000";
            }

            @Override
            protected String resolveKavitaApiKeyEnv() {
                return "direct-api-key";
            }

            @Override
            protected String resolveKavitaLibraryRootEnv() {
                return null;
            }

            @Override
            protected void scanLibraryViaPortal(String portalBaseUrl, String libraryName, boolean force) {
                portalCalls.incrementAndGet();
                throw new IllegalStateException("Portal unavailable");
            }

            @Override
            protected List<Map<String, Object>> fetchLibraries(String baseUrl, String apiKey) {
                return List.of(Map.of("id", 12, "name", "Manhwa"));
            }

            @Override
            protected void scanLibrary(String baseUrl, String apiKey, int libraryId, boolean force) {
                directBaseUrl.set(baseUrl);
                directApiKey.set(apiKey);
                directLibraryId.set(libraryId);
                directForce.set(force);
            }
        };

        service.scanLibraryForType("Manhwa", "manhwa");

        assertThat(portalCalls.get()).isEqualTo(1);
        assertThat(directBaseUrl.get()).isEqualTo("http://noona-kavita:5000");
        assertThat(directApiKey.get()).isEqualTo("direct-api-key");
        assertThat(directLibraryId.get()).isEqualTo(12);
        assertThat(directForce.get()).isFalse();
        verify(logger).warn(eq("KAVITA"), contains("Portal Kavita scan failed for [Manhwa]"));
    }
}
