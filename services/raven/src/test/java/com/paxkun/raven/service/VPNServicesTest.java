package com.paxkun.raven.service;

import com.paxkun.raven.service.settings.DownloadVpnSettings;
import com.paxkun.raven.service.settings.SettingsService;
import com.paxkun.raven.service.vpn.VpnRotationResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class VPNServicesTest {

    @Mock
    private SettingsService settingsService;

    @Mock
    private DownloadService downloadService;

    @Mock
    private LoggerService loggerService;

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
    void rotateNowRestoresLocalRoutesBeforeResumingDownloads() throws Exception {
        VPNServices vpnServices = spy(new VPNServices(settingsService, downloadService, loggerService));
        List<String> preservedRoutes = List.of("172.18.0.0/16 dev eth0 proto kernel scope link src 172.18.0.2");

        when(settingsService.getDownloadVpnSettings()).thenReturn(new DownloadVpnSettings(
                "downloads.vpn",
                "pia",
                true,
                false,
                false,
                30,
                "us_california",
                "pia-user",
                "pia-secret"
        ));
        doNothing().when(downloadService).beginMaintenancePause(anyString());
        when(downloadService.requestPauseActiveDownloads()).thenReturn(new DownloadService.PauseRequestResult(List.of("Solo Leveling"), List.of()));
        when(downloadService.waitForNoActiveDownloads(any())).thenReturn(true);
        when(downloadService.resumePausedDownloads()).thenReturn(1);
        doReturn(preservedRoutes).when(vpnServices).captureLocalRouteSpecs();
        doNothing().when(vpnServices).connectOpenVpn("us_california", "pia-user", "pia-secret");
        doNothing().when(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        doReturn("198.51.100.12").when(vpnServices).resolvePublicIp();

        VpnRotationResult result = vpnServices.rotateNow("manual");

        assertThat(result.ok()).isTrue();
        assertThat(result.currentIp()).isEqualTo("198.51.100.12");

        InOrder inOrder = inOrder(vpnServices, downloadService);
        inOrder.verify(downloadService).beginMaintenancePause("VPN rotation");
        inOrder.verify(downloadService).requestPauseActiveDownloads();
        inOrder.verify(downloadService).waitForNoActiveDownloads(any());
        inOrder.verify(vpnServices).captureLocalRouteSpecs();
        inOrder.verify(vpnServices).connectOpenVpn("us_california", "pia-user", "pia-secret");
        inOrder.verify(vpnServices).restoreLocalRouteSpecs(preservedRoutes);
        inOrder.verify(downloadService).resumePausedDownloads();
    }
}
