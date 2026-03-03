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
    private static final long CACHE_TTL_MS = 5000L;
    private final VaultService vaultService;
    private final LoggerService logger;
    private volatile DownloadNamingSettings cachedNaming;
    private volatile DownloadWorkerSettings cachedWorkerSettings;
    private volatile long cachedAtMs;
    private volatile long cachedWorkerSettingsAtMs;

    public DownloadNamingSettings getDownloadNamingSettings() {
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

    public DownloadWorkerSettings getDownloadWorkerSettings(int threadCount) {
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

    private DownloadNamingSettings loadNamingSettings() {
        try {
            Map<String, Object> doc = vaultService.findOne(SETTINGS_COLLECTION, Map.of("key", NAMING_KEY));
            DownloadNamingSettings parsed = doc != null ? vaultService.parseJson(doc, DownloadNamingSettings.class) : null;
            return mergeWithDefaults(parsed);
        } catch (Exception e) {
            logger.warn("SETTINGS", "⚠️ Failed to load naming settings, using defaults: " + e.getMessage());
            return mergeWithDefaults(null);
        }
    }

    private DownloadWorkerSettings loadWorkerSettings(int threadCount) {
        try {
            Map<String, Object> doc = vaultService.findOne(SETTINGS_COLLECTION, Map.of("key", WORKERS_KEY));
            DownloadWorkerSettings parsed = doc != null ? vaultService.parseJson(doc, DownloadWorkerSettings.class) : null;
            return mergeWorkerSettings(parsed, threadCount);
        } catch (Exception e) {
            logger.warn("SETTINGS", "⚠️ Failed to load download worker settings, using defaults: " + e.getMessage());
            return mergeWorkerSettings(null, threadCount);
        }
    }

    private DownloadNamingSettings mergeWithDefaults(DownloadNamingSettings input) {
        DownloadNamingSettings out = input != null ? input : new DownloadNamingSettings();

        out.setKey(NAMING_KEY);

        if (out.getTitleTemplate() == null || out.getTitleTemplate().isBlank()) {
            out.setTitleTemplate("{title}");
        }

        if (out.getChapterTemplate() == null || out.getChapterTemplate().isBlank()) {
            out.setChapterTemplate("Chapter {chapter} [Pages {pages} {domain} - Noona].cbz");
        }

        if (out.getPageTemplate() == null || out.getPageTemplate().isBlank()) {
            out.setPageTemplate("{page_padded}{ext}");
        }

        if (out.getPagePad() == null || out.getPagePad() < 1) {
            out.setPagePad(3);
        }

        if (out.getChapterPad() == null || out.getChapterPad() < 1) {
            out.setChapterPad(4);
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
}
