/**
 * Exposes Raven VPN status, region, rotation, and login-test endpoints.
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
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Exposes Raven VPN status, region, rotation, and login-test endpoints.
 */

@RestController
@RequestMapping("/v1/vpn")
@RequiredArgsConstructor
public class VpnController {

    private final VPNServices vpnServices;
    private final LoggerService logger;

    /**
     * Returns status.
     *
     * @return The HTTP response.
     */

    @GetMapping("/status")
    public ResponseEntity<VpnRuntimeStatus> getStatus() {
        logger.debug("VPN_CONTROLLER", "Status request received");
        return ResponseEntity.ok(vpnServices.getStatus());
    }

    /**
     * Returns regions.
     *
     * @return The resulting Object>>.
     */

    @GetMapping("/regions")
    public ResponseEntity<Map<String, Object>> getRegions() {
        logger.debug("VPN_CONTROLLER", "Region list request received");
        List<VpnRegionOption> regions = vpnServices.listRegions();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("provider", "pia");
        payload.put("regions", regions);
        return ResponseEntity.ok(payload);
    }

    @PostMapping("/rotate")
    public ResponseEntity<VpnRotationResult> rotateNow(@RequestBody(required = false) Map<String, Object> body) {
        String trigger = body != null && body.get("triggeredBy") instanceof String raw ? raw : "manual";
        String sanitizedTrigger = sanitizeForLog(trigger);
        logger.info("VPN_CONTROLLER", "Rotate-now request received | trigger=" + sanitizedTrigger);
        VpnRotationResult result = vpnServices.rotateNow(sanitizedTrigger);
        if (result.ok()) {
            return ResponseEntity.accepted().body(result);
        }
        return ResponseEntity.ok(result);
    }

    @PostMapping("/test-login")
    public ResponseEntity<VpnLoginTestResult> testLogin(@RequestBody(required = false) Map<String, Object> body) {
        String trigger = body != null && body.get("triggeredBy") instanceof String raw ? raw : "manual";
        String region = body != null && body.get("region") instanceof String raw ? raw : "";
        String username = body != null && body.get("piaUsername") instanceof String raw ? raw : "";
        String password = body != null && body.get("piaPassword") instanceof String raw ? raw : "";
        String sanitizedTrigger = sanitizeForLog(trigger);
        String sanitizedRegion = sanitizeForLog(region);
        logger.info("VPN_CONTROLLER", "Test-login request received | trigger=" + sanitizedTrigger + " | region=" + sanitizedRegion);
        VpnLoginTestResult result = vpnServices.testLogin(sanitizedTrigger, region, username, password);
        if (result.ok()) {
            return ResponseEntity.accepted().body(result);
        }
        return ResponseEntity.ok(result);
    }

    private String sanitizeForLog(String value) {
        if (value == null) {
            return "";
        }
        return value.replaceAll("[\\r\\n]", "").replaceAll("[^\\p{Alnum}\\s_:-]", "").trim();
    }
}
