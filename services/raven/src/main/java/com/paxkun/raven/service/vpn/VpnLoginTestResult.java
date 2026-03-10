package com.paxkun.raven.service.vpn;

/**
 * Result payload for VPN credential validation attempts.
 */
public record VpnLoginTestResult(
        boolean ok,
        String message,
        String region,
        String endpoint,
        String reportedIp,
        String testedAt
) {
}
