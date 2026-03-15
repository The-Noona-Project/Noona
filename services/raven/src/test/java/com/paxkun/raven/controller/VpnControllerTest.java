/**
 * Covers vpn controller behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/LoggerService.java
 * - src/main/java/com/paxkun/raven/service/VPNServices.java
 * - src/main/java/com/paxkun/raven/service/vpn/VpnLoginTestResult.java
 * - src/main/java/com/paxkun/raven/service/vpn/VpnRegionOption.java
 * Times this file has been edited: 2
 */
package com.paxkun.raven.controller;

import com.paxkun.raven.service.LoggerService;
import com.paxkun.raven.service.VPNServices;
import com.paxkun.raven.service.vpn.VpnLoginTestResult;
import com.paxkun.raven.service.vpn.VpnRegionOption;
import com.paxkun.raven.service.vpn.VpnRotationResult;
import com.paxkun.raven.service.vpn.VpnRuntimeStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Covers vpn controller behavior.
 */

@ExtendWith(MockitoExtension.class)
class VpnControllerTest {

    @Mock
    private VPNServices vpnServices;

    @Mock
    private LoggerService loggerService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new VpnController(vpnServices, loggerService)).build();
    }

    @Test
    void statusEndpointReturnsVpnRuntimeStatus() throws Exception {
        when(vpnServices.getStatus()).thenReturn(new VpnRuntimeStatus(
                true,
                true,
                false,
                true,
                "pia",
                "us_california",
                30,
                "198.51.100.12",
                "2026-03-08T20:00:00Z",
                "2026-03-08T20:30:00Z",
                null,
                "connected"
        ));

        mockMvc.perform(get("/v1/vpn/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled").value(true))
                .andExpect(jsonPath("$.provider").value("pia"))
                .andExpect(jsonPath("$.region").value("us_california"))
                .andExpect(jsonPath("$.publicIp").value("198.51.100.12"));
    }

    @Test
    void regionsEndpointReturnsProviderAndRegionList() throws Exception {
        when(vpnServices.listRegions()).thenReturn(List.of(
                new VpnRegionOption("us_california", "Us California", "212.56.53.84"),
                new VpnRegionOption("us_texas", "Us Texas", "203.0.113.22")
        ));

        mockMvc.perform(get("/v1/vpn/regions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.provider").value("pia"))
                .andExpect(jsonPath("$.regions[0].id").value("us_california"))
                .andExpect(jsonPath("$.regions[1].endpoint").value("203.0.113.22"));
    }

    @Test
    void rotateEndpointTriggersVpnRotation() throws Exception {
        when(vpnServices.rotateNow(eq("manual"))).thenReturn(new VpnRotationResult(
                true,
                "VPN rotation complete.",
                "198.51.100.10",
                "198.51.100.11",
                "us_california",
                2,
                2,
                "manual",
                "2026-03-08T20:30:00Z"
        ));

        mockMvc.perform(post("/v1/vpn/rotate")
                        .contentType("application/json")
                        .content("{}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.pausedTasks").value(2))
                .andExpect(jsonPath("$.resumedTasks").value(2));

        verify(vpnServices).rotateNow(eq("manual"));
    }

    @Test
    void testLoginEndpointProxiesRequestToVpnService() throws Exception {
        when(vpnServices.testLogin(eq("moon-settings"), eq("us_california"), eq("pia-user"), eq("pia-secret")))
                .thenReturn(new VpnLoginTestResult(
                        true,
                        "PIA login succeeded for region us_california.",
                        "us_california",
                        "212.56.53.84",
                        "198.51.100.42",
                        "2026-03-08T21:00:00Z"
                ));

        mockMvc.perform(post("/v1/vpn/test-login")
                        .contentType("application/json")
                        .content("""
                                {
                                  "triggeredBy": "moon-settings",
                                  "region": "us_california",
                                  "piaUsername": "pia-user",
                                  "piaPassword": "pia-secret"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(jsonPath("$.region").value("us_california"))
                .andExpect(jsonPath("$.endpoint").value("212.56.53.84"))
                .andExpect(jsonPath("$.reportedIp").value("198.51.100.42"));

        verify(vpnServices).testLogin(eq("moon-settings"), eq("us_california"), eq("pia-user"), eq("pia-secret"));
    }
}
