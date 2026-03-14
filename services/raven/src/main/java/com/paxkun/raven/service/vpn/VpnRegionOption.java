/**
 * Represents a Raven vpn region option.
 * Related files:
 * - src/main/java/com/paxkun/raven/controller/VpnController.java
 * - src/main/java/com/paxkun/raven/service/VPNServices.java
 * - src/test/java/com/paxkun/raven/controller/VpnControllerTest.java
 * Times this file has been edited: 2
 */
package com.paxkun.raven.service.vpn;

/**
 * Selectable VPN region option backed by a PIA OpenVPN profile.
 */
public record VpnRegionOption(
        String id,
        String label,
        String endpoint
) {
}
