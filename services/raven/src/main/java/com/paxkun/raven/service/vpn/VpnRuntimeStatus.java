/**
 * Represents Raven vpn runtime status.
 * Related files:
 * - src/main/java/com/paxkun/raven/controller/VpnController.java
 * - src/main/java/com/paxkun/raven/service/DownloadService.java
 * - src/main/java/com/paxkun/raven/service/VPNServices.java
 * - src/test/java/com/paxkun/raven/controller/VpnControllerTest.java
 * Times this file has been edited: 2
 */
package com.paxkun.raven.service.vpn;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Live Raven VPN runtime status.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class VpnRuntimeStatus {
    private boolean enabled;
    private boolean autoRotate;
    private boolean rotating;
    private boolean connected;
    private String provider;
    private String region;
    private Integer rotateEveryMinutes;
    private String publicIp;
    private String lastRotationAt;
    private String nextRotationAt;
    private String lastError;
    private String connectionState;
}
