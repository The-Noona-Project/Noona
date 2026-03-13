package com.paxkun.raven.service.settings;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * Per-worker download settings stored in Vault (Mongo).
 * Rate limits are expressed in KB/s, where 0 disables throttling.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class DownloadWorkerSettings {
    private String key;
    private List<Integer> threadRateLimitsKbps = new ArrayList<>();
    private List<Integer> cpuCoreIds = new ArrayList<>();
}
