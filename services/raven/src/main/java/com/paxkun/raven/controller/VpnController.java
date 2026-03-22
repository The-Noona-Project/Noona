/**
 * Exposes Raven VPN status, region, rotation, and login-test endpoints.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/LoggerService.java
 * - src/main/java/com/paxkun/raven/service/VPNServices.java
 * - src/main/java/com/paxkun/raven/service/vpn/VpnLoginTestResult.java
 * - src/main/java/com/paxkun/raven/service/vpn/VpnRegionOption.java
 * Times this file has been edited: 4
 */
package com.paxkun.raven.controller;

import com.paxkun.raven.service.LoggerService;
import com.paxkun.raven.service.VPNServices;
import com.paxkun.raven.service.vpn.VpnLoginTestResult;
import com.paxkun.raven.service.vpn.VpnRegionOption;
import com.paxkun.raven.service.vpn.VpnRotationResult;
import com.paxkun.raven.service.vpn.VpnRuntimeStatus;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
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
        return ResponseEntity.status(resolveRotationStatus(result)).body(result);
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
        return ResponseEntity.status(resolveLoginTestStatus(result)).body(result);
    }

    /**
     * Resolves the HTTP status for a Raven VPN rotation response.
     *
     * @param result The Raven VPN rotation payload.
     * @return The HTTP status Raven should return.
     */
    private HttpStatus resolveRotationStatus(VpnRotationResult result) {
        if (result != null && result.ok()) {
            return HttpStatus.ACCEPTED;
        }
        return resolveFailureStatus(result == null ? "" : result.message());
    }

    /**
     * Resolves the HTTP status for a Raven VPN login-test response.
     *
     * @param result The Raven VPN login-test payload.
     * @return The HTTP status Raven should return.
     */
    private HttpStatus resolveLoginTestStatus(VpnLoginTestResult result) {
        if (result != null && result.ok()) {
            return HttpStatus.OK;
        }
        return resolveFailureStatus(result == null ? "" : result.message());
    }

    /**
     * Maps known Raven VPN validation, conflict, and operational failures to HTTP status codes.
     *
     * @param message The VPN action failure message.
     * @return The matching HTTP status.
     */
    private HttpStatus resolveFailureStatus(String message) {
        String normalized = sanitizeForLog(message).toLowerCase(Locale.ROOT);
        if (normalized.contains("already in progress")
                || normalized.contains("while a rotation is in progress")
                || normalized.contains("while raven vpn is already active")) {
            return HttpStatus.CONFLICT;
        }
        if (normalized.contains("disabled")
                || normalized.contains("required")
                || normalized.contains("supported")
                || normalized.contains("unable to validate")
                || normalized.contains("not found")) {
            return HttpStatus.BAD_REQUEST;
        }
        return HttpStatus.BAD_GATEWAY;
    }

    private String sanitizeForLog(String value) {
        if (value == null) {
            return "";
        }
        return value.replaceAll("[\\r\\n]", "").replaceAll("[^\\p{Alnum}\\s_:-]", "").trim();
    }
}
