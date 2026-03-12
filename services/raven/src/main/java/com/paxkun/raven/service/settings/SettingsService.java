package com.paxkun.raven.service.settings;

import com.paxkun.raven.service.LoggerService;
import com.paxkun.raven.service.VaultService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * Reads and caches settings stored in Vault.
 */
@Service
@RequiredArgsConstructor
public class SettingsService {

    private static final String SETTINGS_COLLECTION = "noona_settings";
    private static final String NAMING_KEY = "downloads.naming";
    private static final String WORKERS_KEY = "downloads.workers";
    private static final String VPN_KEY = "downloads.vpn";
    private static final long CACHE_TTL_MS = 5000L;
    private static final long WARNING_COOLDOWN_MS = 30000L;
    private final VaultService vaultService;
    private final LoggerService logger;
    private volatile DownloadNamingSettings cachedNaming;
    private volatile DownloadWorkerSettings cachedWorkerSettings;
    private volatile DownloadVpnSettings cachedVpnSettings;
    private volatile long cachedAtMs;
    private volatile long cachedWorkerSettingsAtMs;
    private volatile long cachedVpnSettingsAtMs;
    private volatile long lastNamingWarningAtMs;
    private volatile long lastWorkerWarningAtMs;
    private volatile long lastVpnWarningAtMs;

    public synchronized DownloadNamingSettings getDownloadNamingSettings() {
        long now = System.currentTimeMillis();
        DownloadNamingSettings current = cachedNaming;
        if (current != null && now - cachedAtMs < CACHE_TTL_MS) {
            return current;
        }

        DownloadNamingSettings loaded = loadNamingSettings();
        cachedNaming = loaded;
        cachedAtMs = now;
        return loaded;
    }

    public synchronized DownloadWorkerSettings getDownloadWorkerSettings(int threadCount) {
        long now = System.currentTimeMillis();
        DownloadWorkerSettings current = cachedWorkerSettings;
        if (current != null && now - cachedWorkerSettingsAtMs < CACHE_TTL_MS) {
            return mergeWorkerSettings(current, threadCount);
        }

        DownloadWorkerSettings loaded = loadWorkerSettings(threadCount);
        cachedWorkerSettings = loaded;
        cachedWorkerSettingsAtMs = now;
        return loaded;
    }

    public synchronized DownloadVpnSettings getDownloadVpnSettings() {
        long now = System.currentTimeMillis();
        DownloadVpnSettings current = cachedVpnSettings;
        if (current != null && now - cachedVpnSettingsAtMs < CACHE_TTL_MS) {
            return current;
        }

        DownloadVpnSettings loaded = loadVpnSettings();
        cachedVpnSettings = loaded;
        cachedVpnSettingsAtMs = now;
        return loaded;
    }

    private DownloadNamingSettings loadNamingSettings() {
        try {
            Map<String, Object> doc = vaultService.findOne(SETTINGS_COLLECTION, Map.of("key", NAMING_KEY));
            DownloadNamingSettings parsed = doc != null ? vaultService.parseJson(doc, DownloadNamingSettings.class) : null;
            return mergeWithDefaults(parsed);
        } catch (Exception e) {
            if (shouldLogNamingWarning()) {
                logger.warn("SETTINGS", "⚠️ Failed to load naming settings, using defaults: " + e.getMessage());
            }
            return mergeWithDefaults(null);
        }
    }

    private DownloadWorkerSettings loadWorkerSettings(int threadCount) {
        try {
            Map<String, Object> doc = vaultService.findOne(SETTINGS_COLLECTION, Map.of("key", WORKERS_KEY));
            DownloadWorkerSettings parsed = doc != null ? vaultService.parseJson(doc, DownloadWorkerSettings.class) : null;
            return mergeWorkerSettings(parsed, threadCount);
        } catch (Exception e) {
            if (shouldLogWorkerWarning()) {
                logger.warn("SETTINGS", "⚠️ Failed to load download worker settings, using defaults: " + e.getMessage());
            }
            return mergeWorkerSettings(null, threadCount);
        }
    }

    private DownloadVpnSettings loadVpnSettings() {
        try {
            Map<String, Object> doc = vaultService.findOne(SETTINGS_COLLECTION, Map.of("key", VPN_KEY));
            DownloadVpnSettings parsed = doc != null ? vaultService.parseJson(doc, DownloadVpnSettings.class) : null;
            return mergeVpnSettingsWithDefaults(parsed);
        } catch (Exception e) {
            if (shouldLogVpnWarning()) {
                logger.warn("SETTINGS", "⚠️ Failed to load VPN settings, using defaults: " + e.getMessage());
            }
            return mergeVpnSettingsWithDefaults(null);
        }
    }

    private boolean shouldLogNamingWarning() {
        long now = System.currentTimeMillis();
        if (now - lastNamingWarningAtMs < WARNING_COOLDOWN_MS) {
            return false;
        }

        lastNamingWarningAtMs = now;
        return true;
    }

    private boolean shouldLogWorkerWarning() {
        long now = System.currentTimeMillis();
        if (now - lastWorkerWarningAtMs < WARNING_COOLDOWN_MS) {
            return false;
        }

        lastWorkerWarningAtMs = now;
        return true;
    }

    private boolean shouldLogVpnWarning() {
        long now = System.currentTimeMillis();
        if (now - lastVpnWarningAtMs < WARNING_COOLDOWN_MS) {
            return false;
        }

        lastVpnWarningAtMs = now;
        return true;
    }

    private DownloadNamingSettings mergeWithDefaults(DownloadNamingSettings input) {
        DownloadNamingSettings out = input != null ? input : new DownloadNamingSettings();

        out.setKey(NAMING_KEY);

        if (out.getTitleTemplate() == null || out.getTitleTemplate().isBlank()) {
            out.setTitleTemplate("{title}");
        }

        if (out.getChapterTemplate() == null || out.getChapterTemplate().isBlank()) {
            out.setChapterTemplate("{title} c{chapter} (v01) [Noona].cbz");
        }

        if (out.getPageTemplate() == null || out.getPageTemplate().isBlank()) {
            out.setPageTemplate("{page_padded}{ext}");
        }

        if (out.getPagePad() == null || out.getPagePad() < 1) {
            out.setPagePad(3);
        }

        if (out.getChapterPad() == null || out.getChapterPad() < 1) {
            out.setChapterPad(3);
        }

        return out;
    }

    private DownloadWorkerSettings mergeWorkerSettings(DownloadWorkerSettings input, int threadCount) {
        DownloadWorkerSettings out = input != null ? input : new DownloadWorkerSettings();
        out.setKey(WORKERS_KEY);

        int normalizedThreadCount = Math.max(1, threadCount);
        List<Integer> nextRateLimits = new java.util.ArrayList<>();
        List<Integer> currentRateLimits = out.getThreadRateLimitsKbps();

        for (int index = 0; index < normalizedThreadCount; index++) {
            Integer current = currentRateLimits != null && index < currentRateLimits.size()
                    ? currentRateLimits.get(index)
                    : 0;
            nextRateLimits.add(current != null && current > 0 ? current : 0);
        }

        out.setThreadRateLimitsKbps(nextRateLimits);
        return out;
    }

    private DownloadVpnSettings mergeVpnSettingsWithDefaults(DownloadVpnSettings input) {
        DownloadVpnSettings out = input != null ? input : new DownloadVpnSettings();
        out.setKey(VPN_KEY);

        if (out.getProvider() == null || out.getProvider().isBlank()) {
            out.setProvider("pia");
        } else {
            out.setProvider(out.getProvider().trim().toLowerCase());
        }

        if (out.getEnabled() == null) {
            out.setEnabled(false);
        }

        if (out.getOnlyDownloadWhenVpnOn() == null) {
            out.setOnlyDownloadWhenVpnOn(false);
        }

        if (out.getAutoRotate() == null) {
            out.setAutoRotate(true);
        }

        if (out.getRotateEveryMinutes() == null || out.getRotateEveryMinutes() < 1) {
            out.setRotateEveryMinutes(30);
        }

        if (out.getRegion() == null || out.getRegion().isBlank()) {
            out.setRegion("us_california");
        } else {
            out.setRegion(out.getRegion().trim().toLowerCase());
        }

        if (out.getPiaUsername() == null) {
            out.setPiaUsername("");
        } else {
            out.setPiaUsername(out.getPiaUsername().trim());
        }

        if (out.getPiaPassword() == null) {
            out.setPiaPassword("");
        } else {
            out.setPiaPassword(out.getPiaPassword().trim());
        }

        return out;
    }
}
