/**
 * Represents the result of vpn login test.
 * Related files:
 * - src/main/java/com/paxkun/raven/controller/VpnController.java
 * - src/main/java/com/paxkun/raven/service/VPNServices.java
 * - src/test/java/com/paxkun/raven/controller/VpnControllerTest.java
 * Times this file has been edited: 2
 */
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
