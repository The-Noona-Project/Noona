package com.paxkun.raven.service.vpn;

/**
 * Rotation action result payload.
 */
public record VpnRotationResult(
        boolean ok,
        String message,
        String previousIp,
        String currentIp,
        String region,
        int pausedTasks,
        int resumedTasks,
        String triggeredBy,
        String rotatedAt
) {
}
