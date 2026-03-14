/**
 * Represents Raven download vpn settings.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/DownloadService.java
 * - src/main/java/com/paxkun/raven/service/VPNServices.java
 * - src/test/java/com/paxkun/raven/service/DownloadServiceTest.java
 * - src/test/java/com/paxkun/raven/service/VPNServicesTest.java
 * Times this file has been edited: 3
 */
package com.paxkun.raven.service.settings;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * VPN settings persisted in Vault (Mongo).
 * Raven currently supports PIA OpenVPN region switching.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DownloadVpnSettings {
    private String key;
    private String provider;
    private Boolean enabled;
    private Boolean onlyDownloadWhenVpnOn;
    private Boolean autoRotate;
    private Integer rotateEveryMinutes;
    private String region;
    private String piaUsername;
    private String piaPassword;
}
