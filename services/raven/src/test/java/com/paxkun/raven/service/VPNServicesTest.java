/**
 * Covers v p n services behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/settings/DownloadVpnSettings.java
 * - src/main/java/com/paxkun/raven/service/settings/SettingsService.java
 * - src/main/java/com/paxkun/raven/service/vpn/VpnRotationResult.java
 * - src/main/java/com/paxkun/raven/service/VPNServices.java
 * Times this file has been edited: 7
 */
package com.paxkun.raven.service;

import com.paxkun.raven.service.settings.DownloadVpnSettings;
import com.paxkun.raven.service.settings.SettingsService;
import com.paxkun.raven.service.vpn.VpnLoginTestResult;
import com.paxkun.raven.service.vpn.VpnRegionOption;
import com.paxkun.raven.service.vpn.VpnRotationResult;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Covers v p n services behavior.
 */

@ExtendWith(MockitoExtension.class)
class VPNServicesTest {

    private static final Duration STALE_PROFILE_AGE = Duration.ofHours(7);

    @TempDir
    Path tempDir;

    @Mock
    private SettingsService settingsService;

    @Mock
    private DownloadService downloadService;

    @Mock
    private LoggerService loggerService;

    @BeforeEach
    void setUp() {
        lenient().when(settingsService.getDownloadVpnSettings()).thenReturn(defaultVpnSettings());
        lenient().when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(defaultVpnSettings());
    }

    @Test
    void workerModeSkipsVpnSchedulerStartup() {
        TestableVPNServices vpnServices = spy(new TestableVPNServices(settingsService, downloadService, loggerService));
        RavenRuntimeProperties runtimeProperties = new RavenRuntimeProperties();
        runtimeProperties.setWorkerMode(true);
        ReflectionTestUtils.setField(vpnServices, "runtimeProperties", runtimeProperties);

        vpnServices.start();

        assertThat(vpnServices.scheduleCount).isZero();
    }

    @Test
    void captureLocalRouteSpecsFiltersOutDefaultVpnAndLoopbackRoutes() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        doReturn(List.of(
                "default via 172.18.0.1 dev eth0",
                "172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2",
                "10.8.0.1 dev tun0 scope link",
                "127.0.0.0/8 dev lo scope link",
                "192.168.65.0/24 dev eth0"
        )).when(vpnServices).runCommandForOutput(anyList());

        List<String> routes = vpnServices.captureLocalRouteSpecs();

        assertThat(routes).containsExactly(
                "172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2",
                "192.168.65.0/24 dev eth0"
        );
    }

    @Test
    void restoreLocalRouteSpecsReplaysEachRouteWithIpRouteReplace() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<List<String>> commands = new ArrayList<>();
        doAnswer(invocation -> {
            commands.add(List.copyOf(invocation.getArgument(0)));
            return null;
        }).when(vpnServices).runCommand(anyList());

        vpnServices.restoreLocalRouteSpecs(List.of(
                "172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2",
                "192.168.65.0/24 dev eth0"
        ));

        assertThat(commands).containsExactly(
                List.of("ip", "route", "replace", "172.18.0.0/16", "dev", "eth0", "proto", "kernel", "scope", "link", "src", "172.18.0.2"),
                List.of("ip", "route", "replace", "192.168.65.0/24", "dev", "eth0")
        );
    }

    @Test
    void rotateNowUsesFreshVpnSettingsSnapshotForValidation() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<String> preservedRoutes = List.of("172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2");

        when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(enabledVpnSettings("us_texas"));
        doNothing().when(downloadService).beginMaintenancePause(anyString());
        when(downloadService.requestPauseActiveDownloads()).thenReturn(new DownloadService.PauseRequestResult(List.of(), List.of()));
        when(downloadService.waitForNoActiveDownloads(any())).thenReturn(true);
        doReturn(preservedRoutes).when(vpnServices).captureLocalRouteSpecs();
        doNothing().when(vpnServices).connectOpenVpn("us_texas", "pia-user", "pia-secret");
        doNothing().when(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        doReturn("198.51.100.12").when(vpnServices).resolvePublicIp();

        VpnRotationResult result = vpnServices.rotateNow("manual");

        assertThat(result.ok()).isTrue();
        assertThat(result.region()).isEqualTo("us_texas");

        waitForCondition("Timed out waiting for background rotation to finish.", () -> !vpnServices.getStatus().isRotating());
        verify(vpnServices).connectOpenVpn("us_texas", "pia-user", "pia-secret");
        vpnServices.stop();
    }

    @Test
    void rotateNowRejectsDuplicateManualRequestsBeforeSecondQueue() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<String> preservedRoutes = List.of("172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2");

        when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(enabledVpnSettings("us_california"));
        doNothing().when(downloadService).beginMaintenancePause(anyString());
        when(downloadService.requestPauseActiveDownloads()).thenReturn(new DownloadService.PauseRequestResult(List.of("Solo Leveling"), List.of()));
        when(downloadService.waitForNoActiveDownloads(any())).thenAnswer(invocation -> {
            Thread.sleep(200L);
            return true;
        });
        when(downloadService.resumePausedDownloads(eq(List.of("Solo Leveling")))).thenReturn(1);
        doReturn(preservedRoutes).when(vpnServices).captureLocalRouteSpecs();
        doNothing().when(vpnServices).connectOpenVpn("us_california", "pia-user", "pia-secret");
        doNothing().when(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        doReturn("198.51.100.12").when(vpnServices).resolvePublicIp();

        VpnRotationResult first = vpnServices.rotateNow("manual");
        VpnRotationResult second = vpnServices.rotateNow("manual");

        assertThat(first.ok()).isTrue();
        assertThat(first.message()).isEqualTo("VPN rotation started in background.");
        assertThat(second.ok()).isFalse();
        assertThat(second.message()).isEqualTo("A VPN rotation is already in progress.");

        waitForCondition("Timed out waiting for background rotation to finish.", () -> !vpnServices.getStatus().isRotating());
        verify(downloadService, times(1)).requestPauseActiveDownloads();
        vpnServices.stop();
    }

    @Test
    void rotateNowFailsValidationBeforeQueueingBackgroundWork() {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(defaultVpnSettings());

        VpnRotationResult result = vpnServices.rotateNow("manual");

        assertThat(result.ok()).isFalse();
        assertThat(result.message()).isEqualTo("VPN is disabled in Raven settings.");
        verify(downloadService, never()).beginMaintenancePause(anyString());
        verify(downloadService, never()).requestPauseActiveDownloads();
    }

    @Test
    void scheduleTickEnsuresVpnConnectionWhenEnabledWithoutAutoRotate() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<String> preservedRoutes = List.of("172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2");
        Process openVpnProcess = mock(Process.class);

        when(openVpnProcess.isAlive()).thenReturn(true);
        when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(enabledVpnSettings("us_california", true, false));
        doNothing().when(downloadService).beginMaintenancePause(anyString());
        when(downloadService.requestPauseActiveDownloads()).thenReturn(new DownloadService.PauseRequestResult(List.of("Solo Leveling"), List.of()));
        when(downloadService.waitForNoActiveDownloads(any())).thenReturn(true);
        when(downloadService.resumePausedDownloads(eq(List.of("Solo Leveling")))).thenReturn(1);
        doReturn(preservedRoutes).when(vpnServices).captureLocalRouteSpecs();
        doAnswer(invocation -> {
            ReflectionTestUtils.setField(vpnServices, "openVpnProcess", openVpnProcess);
            ReflectionTestUtils.setField(vpnServices, "connectionState", "connected");
            return null;
        }).when(vpnServices).connectOpenVpn("us_california", "pia-user", "pia-secret");
        doNothing().when(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        doReturn("198.51.100.88").when(vpnServices).resolvePublicIp();

        ReflectionTestUtils.invokeMethod(vpnServices, "runScheduleTick");

        assertThat(vpnServices.getStatus().isConnected()).isTrue();
        assertThat(vpnServices.getStatus().getNextRotationAt()).isNull();
        InOrder inOrder = inOrder(vpnServices, downloadService);
        inOrder.verify(downloadService).beginMaintenancePause("VPN auto-connect");
        inOrder.verify(downloadService).requestPauseActiveDownloads();
        inOrder.verify(downloadService).waitForNoActiveDownloads(any());
        inOrder.verify(vpnServices).captureLocalRouteSpecs();
        inOrder.verify(vpnServices).connectOpenVpn("us_california", "pia-user", "pia-secret");
        inOrder.verify(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        inOrder.verify(downloadService).resumePausedDownloads(eq(List.of("Solo Leveling")));
    }

    @Test
    void scheduleTickBacksOffAutoConnectRetriesAfterFailure() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<String> preservedRoutes = List.of("172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2");

        when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(enabledVpnSettings("us_california", true, false));
        doNothing().when(downloadService).beginMaintenancePause(anyString());
        when(downloadService.requestPauseActiveDownloads()).thenReturn(new DownloadService.PauseRequestResult(List.of(), List.of()));
        when(downloadService.waitForNoActiveDownloads(any())).thenReturn(true);
        doReturn(preservedRoutes).when(vpnServices).captureLocalRouteSpecs();
        doNothing().when(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        doReturn("203.0.113.40").when(vpnServices).resolvePublicIp();
        doThrow(new IOException("PIA authentication failed"))
                .when(vpnServices).connectOpenVpn("us_california", "pia-user", "pia-secret");

        ReflectionTestUtils.invokeMethod(vpnServices, "runScheduleTick");

        assertThat(vpnServices.getStatus().isConnected()).isFalse();
        assertThat(vpnServices.getStatus().getLastError()).contains("PIA authentication failed");
        assertThat(vpnServices.getStatus().getConnectionState()).isEqualTo("error");
        verify(vpnServices, times(1)).connectOpenVpn("us_california", "pia-user", "pia-secret");

        ReflectionTestUtils.invokeMethod(vpnServices, "runScheduleTick");
        verify(vpnServices, times(1)).connectOpenVpn("us_california", "pia-user", "pia-secret");

        ReflectionTestUtils.setField(vpnServices, "nextAutoConnectAttemptAtMs", System.currentTimeMillis() - 1);
        ReflectionTestUtils.invokeMethod(vpnServices, "runScheduleTick");
        verify(vpnServices, times(2)).connectOpenVpn("us_california", "pia-user", "pia-secret");
    }

    @Test
    void rotateNowInternalReportsDrainTimeoutWithPhaseSpecificFailureMessage() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));

        when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(enabledVpnSettings("us_california"));
        doNothing().when(downloadService).beginMaintenancePause(anyString());
        when(downloadService.requestPauseActiveDownloads()).thenReturn(new DownloadService.PauseRequestResult(List.of("Solo Leveling"), List.of()));
        when(downloadService.waitForNoActiveDownloads(any())).thenReturn(false);
        when(downloadService.resumePausedDownloads(eq(List.of("Solo Leveling")))).thenReturn(1);
        doReturn("198.51.100.30").when(vpnServices).resolvePublicIp();

        VpnRotationResult result = ReflectionTestUtils.invokeMethod(vpnServices, "rotateNowInternal", "manual", false);

        assertThat(result.ok()).isFalse();
        assertThat(result.message()).contains("VPN rotation failed while waiting for downloads to pause");
        assertThat(result.message()).contains("Timed out while waiting for active downloads to pause.");
        assertThat(vpnServices.getStatus().getLastError()).contains("waiting for downloads to pause");
        verify(downloadService).resumePausedDownloads(eq(List.of("Solo Leveling")));
    }

    @Test
    void rotateNowInternalRestoresLocalRoutesBeforeResumingOnlyAffectedTitles() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<String> preservedRoutes = List.of("172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2");
        DownloadService.PauseRequestResult pauseResult = new DownloadService.PauseRequestResult(
                List.of("Solo Leveling"),
                List.of("Trigun")
        );

        when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(enabledVpnSettings("us_california"));
        doNothing().when(downloadService).beginMaintenancePause(anyString());
        when(downloadService.requestPauseActiveDownloads()).thenReturn(pauseResult);
        when(downloadService.waitForNoActiveDownloads(any())).thenReturn(true);
        when(downloadService.resumePausedDownloads(eq(List.of("Solo Leveling", "Trigun")))).thenReturn(2);
        doReturn(preservedRoutes).when(vpnServices).captureLocalRouteSpecs();
        doNothing().when(vpnServices).connectOpenVpn("us_california", "pia-user", "pia-secret");
        doNothing().when(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        doReturn("198.51.100.12").when(vpnServices).resolvePublicIp();

        VpnRotationResult result = ReflectionTestUtils.invokeMethod(vpnServices, "rotateNowInternal", "manual", false);

        assertThat(result.ok()).isTrue();
        assertThat(result.currentIp()).isEqualTo("198.51.100.12");
        assertThat(result.resumedTasks()).isEqualTo(2);

        InOrder inOrder = inOrder(vpnServices, downloadService);
        inOrder.verify(downloadService).beginMaintenancePause("VPN rotation");
        inOrder.verify(downloadService).requestPauseActiveDownloads();
        inOrder.verify(downloadService).waitForNoActiveDownloads(any());
        inOrder.verify(vpnServices).captureLocalRouteSpecs();
        inOrder.verify(vpnServices).connectOpenVpn("us_california", "pia-user", "pia-secret");
        inOrder.verify(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        inOrder.verify(downloadService).resumePausedDownloads(eq(List.of("Solo Leveling", "Trigun")));
        verify(downloadService, never()).resumePausedDownloads();
    }

    @Test
    void rotateNowInternalDisconnectsAndResumesOnlyAffectedTitlesWhenRouteRestoreFails() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<String> preservedRoutes = List.of("172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2");
        Process openVpnProcess = mock(Process.class);
        AtomicBoolean processAlive = new AtomicBoolean(true);

        when(openVpnProcess.isAlive()).thenAnswer(invocation -> processAlive.get());
        doAnswer(invocation -> {
            processAlive.set(false);
            return null;
        }).when(openVpnProcess).destroy();
        when(openVpnProcess.waitFor(anyLong(), any(TimeUnit.class))).thenAnswer(invocation -> {
            processAlive.set(false);
            return true;
        });

        when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(enabledVpnSettings("us_california"));
        doNothing().when(downloadService).beginMaintenancePause(anyString());
        when(downloadService.requestPauseActiveDownloads()).thenReturn(new DownloadService.PauseRequestResult(List.of("Solo Leveling"), List.of()));
        when(downloadService.waitForNoActiveDownloads(any())).thenReturn(true);
        when(downloadService.resumePausedDownloads(eq(List.of("Solo Leveling")))).thenReturn(1);
        doReturn(preservedRoutes).when(vpnServices).captureLocalRouteSpecs();
        doAnswer(invocation -> {
            ReflectionTestUtils.setField(vpnServices, "openVpnProcess", openVpnProcess);
            ReflectionTestUtils.setField(vpnServices, "connectionState", "connected");
            return null;
        }).when(vpnServices).connectOpenVpn("us_california", "pia-user", "pia-secret");
        doThrow(new IOException("route restore failed"))
                .doNothing()
                .when(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        doReturn("198.51.100.30").when(vpnServices).resolvePublicIp();

        VpnRotationResult result = ReflectionTestUtils.invokeMethod(vpnServices, "rotateNowInternal", "manual", false);

        assertThat(result.ok()).isFalse();
        assertThat(result.message()).contains("VPN rotation failed while restoring local routes");
        assertThat(result.message()).contains("route restore failed");
        assertThat(vpnServices.getStatus().isConnected()).isFalse();
        verify(downloadService).resumePausedDownloads(eq(List.of("Solo Leveling")));
        verify(downloadService, never()).resumePausedDownloads();
        verify(openVpnProcess, atLeastOnce()).destroy();
    }

    @Test
    void rotateNowInternalAppendsCleanupFailureWithoutReplacingPrimaryFailure() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<String> preservedRoutes = List.of("172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2");

        when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(enabledVpnSettings("us_california"));
        doNothing().when(downloadService).beginMaintenancePause(anyString());
        when(downloadService.requestPauseActiveDownloads()).thenReturn(new DownloadService.PauseRequestResult(List.of("Solo Leveling"), List.of()));
        when(downloadService.waitForNoActiveDownloads(any())).thenReturn(true);
        when(downloadService.resumePausedDownloads(eq(List.of("Solo Leveling")))).thenReturn(1);
        doReturn(preservedRoutes).when(vpnServices).captureLocalRouteSpecs();
        doThrow(new IOException("PIA authentication failed for Raven VPN."))
                .when(vpnServices).connectOpenVpn("us_california", "pia-user", "pia-secret");
        doThrow(new IOException("route cleanup failed"))
                .when(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        doReturn("198.51.100.30").when(vpnServices).resolvePublicIp();

        VpnRotationResult result = ReflectionTestUtils.invokeMethod(vpnServices, "rotateNowInternal", "manual", false);

        assertThat(result.ok()).isFalse();
        assertThat(result.message()).contains("VPN rotation failed while connecting OpenVPN");
        assertThat(result.message()).contains("PIA authentication failed for Raven VPN.");
        assertThat(result.message()).contains("Failed to restore local routes after VPN rotation: route cleanup failed");
        assertThat(vpnServices.getStatus().getLastError()).contains("Failed to restore local routes after VPN rotation: route cleanup failed");
    }

    @Test
    void testLoginRejectsDuplicateRequestsWhileAnotherProbeIsRunning() throws Exception {
        when(loggerService.getDownloadsRoot()).thenReturn(tempDir);
        writeCachedProfile("us_california", "198.51.100.10");

        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<String> preservedRoutes = List.of("172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2");
        doAnswer(invocation -> {
            Thread.sleep(300L);
            return preservedRoutes;
        }).when(vpnServices).captureLocalRouteSpecs();
        doNothing().when(vpnServices).restoreLocalRouteSpecs(preservedRoutes);

        Path fakeOpenVpn = writeFakeOpenVpnCommand("""
                @echo off
                echo AUTH_FAILED
                exit /b 1
                """);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<VpnLoginTestResult> firstAttempt = executor.submit(
                    () -> vpnServices.testLogin("manual", "us_california", "pia-user", "pia-secret")
            );

            AtomicBoolean inProgress = (AtomicBoolean) ReflectionTestUtils.getField(vpnServices, "loginTestInProgress");
            assertThat(inProgress).isNotNull();
            waitForCondition("Timed out waiting for Raven VPN login test reservation.", inProgress::get);

            VpnLoginTestResult duplicate = vpnServices.testLogin("manual", "us_california", "pia-user", "pia-secret");

            assertThat(duplicate.ok()).isFalse();
            assertThat(duplicate.message()).isEqualTo("A VPN login test is already in progress.");
            assertThat(firstAttempt.get(10, TimeUnit.SECONDS).ok()).isFalse();
        } finally {
            executor.shutdownNow();
            Files.deleteIfExists(fakeOpenVpn);
        }
    }

    @Test
    void testLoginRestoresLocalRoutesWhenProbeFails() throws Exception {
        when(loggerService.getDownloadsRoot()).thenReturn(tempDir);
        writeCachedProfile("us_california", "198.51.100.10");

        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<String> preservedRoutes = List.of("172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2");
        doReturn(preservedRoutes).when(vpnServices).captureLocalRouteSpecs();
        doNothing().when(vpnServices).restoreLocalRouteSpecs(preservedRoutes);

        Path fakeOpenVpn = writeFakeOpenVpnCommand("""
                @echo off
                echo AUTH_FAILED
                exit /b 1
                """);
        try {
            VpnLoginTestResult result = vpnServices.testLogin("manual", "us_california", "pia-user", "pia-secret");

            assertThat(result.ok()).isFalse();
            assertThat(result.message()).contains("Login test failed");
            verify(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        } finally {
            Files.deleteIfExists(fakeOpenVpn);
        }
    }

    @Test
    void getStatusUsesConfiguredRegionWhileOpenVpnIsStillConnecting() throws Exception {
        VPNServices vpnServices = new VPNServices(settingsService, downloadService, loggerService);
        Process openVpnProcess = mock(Process.class);

        when(settingsService.getDownloadVpnSettingsFresh()).thenReturn(enabledVpnSettings("us_texas"));
        ReflectionTestUtils.setField(vpnServices, "openVpnProcess", openVpnProcess);
        ReflectionTestUtils.setField(vpnServices, "connectionState", "connecting");
        ReflectionTestUtils.setField(vpnServices, "currentRegion", "us_california");

        assertThat(vpnServices.getStatus().isConnected()).isFalse();
        assertThat(vpnServices.getStatus().getRegion()).isEqualTo("us_texas");
    }

    @Test
    void listRegionsDiscoversNestedProfilesFromArchive() throws Exception {
        when(loggerService.getDownloadsRoot()).thenReturn(tempDir);

        HttpServer server = startZipServer(200, createZipArchive(Map.of(
                "openvpn/us_california.ovpn", ovpnProfile("198.51.100.10"),
                "openvpn/us_texas.ovpn", ovpnProfile("203.0.113.22")
        )));

        try {
            VPNServices vpnServices = new VPNServices(settingsService, downloadService, loggerService);
            ReflectionTestUtils.setField(vpnServices, "piaOpenVpnZipUrl", profileServerUrl(server));

            List<VpnRegionOption> regions = vpnServices.listRegions();

            assertThat(regions).extracting(VpnRegionOption::id)
                    .containsExactly("us_california", "us_texas");
            assertThat(regions).extracting(VpnRegionOption::endpoint)
                    .containsExactly("198.51.100.10", "203.0.113.22");
            assertThat(vpnServices.getStatus().getLastError()).isNull();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void failedRefreshPreservesExistingProfiles() throws Exception {
        when(loggerService.getDownloadsRoot()).thenReturn(tempDir);

        Path existingProfile = tempDir.resolve("vpn").resolve("pia").resolve("profiles")
                .resolve("legacy").resolve("us_california.ovpn");
        writeProfile(existingProfile, "198.51.100.44");
        markArchiveStale(tempDir.resolve("vpn").resolve("pia").resolve("openvpn-ip.zip"));

        HttpServer server = startZipServer(500, "upstream failed".getBytes(StandardCharsets.UTF_8));

        try {
            VPNServices vpnServices = new VPNServices(settingsService, downloadService, loggerService);
            ReflectionTestUtils.setField(vpnServices, "piaOpenVpnZipUrl", profileServerUrl(server));

            List<VpnRegionOption> regions = vpnServices.listRegions();

            assertThat(regions).extracting(VpnRegionOption::id).containsExactly("us_california");
            assertThat(Files.exists(existingProfile)).isTrue();
            assertThat(vpnServices.getStatus().getLastError()).contains("Keeping last known-good PIA profiles.");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void resolveProfilePathFindsNestedProfileByBasename() throws Exception {
        when(loggerService.getDownloadsRoot()).thenReturn(tempDir);

        Path archivePath = tempDir.resolve("vpn").resolve("pia").resolve("openvpn-ip.zip");
        Files.createDirectories(archivePath.getParent());
        Files.writeString(archivePath, "cached", StandardCharsets.UTF_8);
        Path nestedProfile = tempDir.resolve("vpn").resolve("pia").resolve("profiles")
                .resolve("regions").resolve("us_texas.ovpn");
        writeProfile(nestedProfile, "203.0.113.22");

        VPNServices vpnServices = new VPNServices(settingsService, downloadService, loggerService);

        Path resolved = ReflectionTestUtils.invokeMethod(vpnServices, "resolveProfilePath", "us_texas");

        assertThat(resolved).isEqualTo(nestedProfile);
    }

    @Test
    void refreshedArchiveWithoutProfilesSetsClearFailure() throws Exception {
        when(loggerService.getDownloadsRoot()).thenReturn(tempDir);

        HttpServer server = startZipServer(200, createZipArchive(Map.of(
                "README.txt", "not a profile"
        )));

        try {
            VPNServices vpnServices = new VPNServices(settingsService, downloadService, loggerService);
            ReflectionTestUtils.setField(vpnServices, "piaOpenVpnZipUrl", profileServerUrl(server));

            List<VpnRegionOption> regions = vpnServices.listRegions();

            assertThat(regions).isEmpty();
            assertThat(vpnServices.getStatus().getLastError()).contains("did not contain any .ovpn files");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void successfulRefreshClearsStaleProfileError() throws Exception {
        when(loggerService.getDownloadsRoot()).thenReturn(tempDir);

        Path archivePath = tempDir.resolve("vpn").resolve("pia").resolve("openvpn-ip.zip");
        Path existingProfile = tempDir.resolve("vpn").resolve("pia").resolve("profiles")
                .resolve("legacy").resolve("us_california.ovpn");
        writeProfile(existingProfile, "198.51.100.44");
        markArchiveStale(archivePath);

        VPNServices vpnServices = new VPNServices(settingsService, downloadService, loggerService);

        HttpServer failureServer = startZipServer(500, "upstream failed".getBytes(StandardCharsets.UTF_8));
        try {
            ReflectionTestUtils.setField(vpnServices, "piaOpenVpnZipUrl", profileServerUrl(failureServer));
            vpnServices.listRegions();
        } finally {
            failureServer.stop(0);
        }

        assertThat(vpnServices.getStatus().getLastError()).contains("Keeping last known-good PIA profiles.");

        HttpServer successServer = startZipServer(200, createZipArchive(Map.of(
                "nested/us_texas.ovpn", ovpnProfile("203.0.113.55")
        )));

        try {
            ReflectionTestUtils.setField(vpnServices, "piaOpenVpnZipUrl", profileServerUrl(successServer));
            ReflectionTestUtils.setField(vpnServices, "cachedRegions", List.of());
            ReflectionTestUtils.setField(vpnServices, "cachedRegionsAtMs", 0L);
            markArchiveStale(archivePath);

            List<VpnRegionOption> regions = vpnServices.listRegions();

            assertThat(regions).extracting(VpnRegionOption::id).containsExactly("us_texas");
            assertThat(vpnServices.getStatus().getLastError()).isNull();
        } finally {
            successServer.stop(0);
        }
    }

    /**
     * Creates the default VPN settings snapshot used by status assertions in tests.
     *
     * @return The default VPN settings document.
     */
    private DownloadVpnSettings defaultVpnSettings() {
        return new DownloadVpnSettings(
                "downloads.vpn",
                "pia",
                false,
                false,
                false,
                30,
                "us_california",
                "",
                ""
        );
    }

    /**
     * Creates an enabled Raven VPN settings snapshot with credentials for rotation and login tests.
     *
     * @param region The configured Raven VPN region.
     * @return The enabled VPN settings snapshot.
     */
    private DownloadVpnSettings enabledVpnSettings(String region) {
        return enabledVpnSettings(region, false, false);
    }

    /**
     * Creates an enabled Raven VPN settings snapshot with configurable download gating and auto-rotation flags.
     *
     * @param region                The configured Raven VPN region.
     * @param onlyDownloadWhenVpnOn Whether Raven should block downloads until the VPN is connected.
     * @param autoRotate            Whether Raven should schedule periodic rotations.
     * @return The enabled VPN settings snapshot.
     */
    private DownloadVpnSettings enabledVpnSettings(String region, boolean onlyDownloadWhenVpnOn, boolean autoRotate) {
        return new DownloadVpnSettings(
                "downloads.vpn",
                "pia",
                true,
                onlyDownloadWhenVpnOn,
                autoRotate,
                30,
                region,
                "pia-user",
                "pia-secret"
        );
    }

    /**
     * Writes a cached archive marker plus a matching profile so Raven resolves the requested region without refreshing.
     *
     * @param region   The region id Raven should resolve.
     * @param endpoint The remote endpoint to embed in the profile.
     * @throws Exception When the cache marker or profile cannot be written.
     */
    private void writeCachedProfile(String region, String endpoint) throws Exception {
        Path archivePath = tempDir.resolve("vpn").resolve("pia").resolve("openvpn-ip.zip");
        Files.createDirectories(archivePath.getParent());
        Files.writeString(archivePath, "cached", StandardCharsets.UTF_8);
        Path profilePath = tempDir.resolve("vpn").resolve("pia").resolve("profiles").resolve(region + ".ovpn");
        writeProfile(profilePath, endpoint);
    }

    /**
     * Writes a temporary fake OpenVPN command into the Gradle working directory so probe tests stay deterministic.
     *
     * @param scriptBody The Windows batch script contents.
     * @return The created command path.
     * @throws Exception When the command file cannot be written.
     */
    private Path writeFakeOpenVpnCommand(String scriptBody) throws Exception {
        Path commandPath = Path.of("openvpn.cmd").toAbsolutePath();
        Files.writeString(
                commandPath,
                scriptBody.replace("\n", "\r\n"),
                StandardCharsets.UTF_8
        );
        return commandPath;
    }

    /**
     * Polls a condition until it becomes true or the test times out.
     *
     * @param failureMessage The failure message to surface on timeout.
     * @param condition      The condition to evaluate.
     * @throws InterruptedException When the wait is interrupted.
     */
    private void waitForCondition(String failureMessage, BooleanSupplier condition) throws InterruptedException {
        for (int attempt = 0; attempt < 50; attempt++) {
            if (condition.getAsBoolean()) {
                return;
            }
            Thread.sleep(100L);
        }
        throw new AssertionError(failureMessage);
    }

    /**
     * Starts a lightweight HTTP server that serves a deterministic archive download response.
     *
     * @param statusCode   The HTTP status to return.
     * @param responseBody The response body bytes.
     * @return The started test server.
     * @throws Exception When the server cannot be started.
     */
    private HttpServer startZipServer(int statusCode, byte[] responseBody) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/profiles.zip", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/zip");
            exchange.sendResponseHeaders(statusCode, responseBody.length);
            try (OutputStream outputStream = exchange.getResponseBody()) {
                outputStream.write(responseBody);
            }
        });
        server.start();
        return server;
    }

    /**
     * Builds the archive download URL for a started test server.
     *
     * @param server The started HTTP server.
     * @return The archive URL consumed by VPNServices.
     */
    private String profileServerUrl(HttpServer server) {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/profiles.zip";
    }

    /**
     * Creates a zip archive from path-to-content entries for profile refresh tests.
     *
     * @param entries The archive entries to include.
     * @return The encoded zip bytes.
     * @throws Exception When archive creation fails.
     */
    private byte[] createZipArchive(Map<String, String> entries) throws Exception {
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        try (ZipOutputStream zipOutputStream = new ZipOutputStream(outputStream, StandardCharsets.UTF_8)) {
            for (Map.Entry<String, String> entry : new TreeMap<>(entries).entrySet()) {
                zipOutputStream.putNextEntry(new ZipEntry(entry.getKey()));
                zipOutputStream.write(entry.getValue().getBytes(StandardCharsets.UTF_8));
                zipOutputStream.closeEntry();
            }
        }
        return outputStream.toByteArray();
    }

    /**
     * Creates a minimal OpenVPN profile body for endpoint parsing assertions.
     *
     * @param endpoint The `remote` host to embed.
     * @return The profile body.
     */
    private String ovpnProfile(String endpoint) {
        return "client\nremote " + endpoint + " 1198\n";
    }

    /**
     * Writes a minimal OpenVPN profile to disk for profile discovery tests.
     *
     * @param profilePath The profile path to create.
     * @param endpoint    The `remote` host to embed.
     * @throws Exception When the file cannot be written.
     */
    private void writeProfile(Path profilePath, String endpoint) throws Exception {
        Files.createDirectories(profilePath.getParent());
        Files.writeString(profilePath, ovpnProfile(endpoint), StandardCharsets.UTF_8);
    }

    /**
     * Marks the cached archive as stale so Raven is forced to attempt a refresh.
     *
     * @param archivePath The cached archive path.
     * @throws Exception When the archive timestamp cannot be updated.
     */
    private void markArchiveStale(Path archivePath) throws Exception {
        Files.createDirectories(archivePath.getParent());
        if (!Files.exists(archivePath)) {
            Files.writeString(archivePath, "cached", StandardCharsets.UTF_8);
        }
        Files.setLastModifiedTime(
                archivePath,
                FileTime.fromMillis(System.currentTimeMillis() - STALE_PROFILE_AGE.toMillis())
        );
    }

    static class TestableVPNServices extends VPNServices {
        private int scheduleCount;

        TestableVPNServices(SettingsService settingsService, DownloadService downloadService, LoggerService loggerService) {
            super(settingsService, downloadService, loggerService);
        }

        @Override
        protected void scheduleTickLoop() {
            scheduleCount++;
        }
    }
}
