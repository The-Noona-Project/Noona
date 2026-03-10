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
