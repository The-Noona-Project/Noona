/**
 * Represents the result of vpn rotation.
 * Related files:
 * - src/main/java/com/paxkun/raven/controller/VpnController.java
 * - src/main/java/com/paxkun/raven/service/VPNServices.java
 * - src/test/java/com/paxkun/raven/controller/VpnControllerTest.java
 * - src/test/java/com/paxkun/raven/service/VPNServicesTest.java
 * Times this file has been edited: 2
 */
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
