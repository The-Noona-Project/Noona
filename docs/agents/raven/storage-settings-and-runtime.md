# Raven Storage, Settings, And Runtime

## Build And Runtime Baseline

- Raven is a Java 21 Spring Boot service defined in [build.gradle](../../../services/raven/build.gradle).
- It uses `spring-boot-starter-web` and `spring-boot-starter-webflux`, Selenium, WebDriverManager, Gson, Jsoup, and
  JNA.
- Tests run with JUnit. Live scrape tests are excluded unless `RAVEN_LIVE_SCRAPE` or the Gradle `liveScrape` property
  enables them.

## Managed Disk Layout

- Raven resolves its downloads root through
  [LoggerService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/LoggerService.java).
- Preferred root order is:
  `APPDATA/Noona/raven/downloads`, then `~/.noona/raven/downloads`, then `/app/downloads`.
- Managed downloads are split into:
  `downloads/downloading` for work in progress and `downloads/downloaded` for completed content.
- Title folders are grouped under media-type segments when Raven knows the type, for example `manga` or `manhwa`.
- Raven also keeps logs under `NOONA_LOG_DIR` if set, otherwise under `downloads/logs` or `/app/logs`.

## Manifest And File Naming Contract

- Raven writes `.noona` manifests next to downloaded content so imports and restores can rebuild the library record.
- Naming templates come from Vault key `downloads.naming`.
- Default template values are:
  title folder: `{title}`
  chapter archive: `{title} c{chapter} (v{volume}) [Noona].cbz`
  page file: `{page_padded}{ext}`
- Placeholder support lives in
  [DownloadNamingSettings.java](../../../services/raven/src/main/java/com/paxkun/raven/service/settings/DownloadNamingSettings.java).
- File naming and manifest compatibility are admin-visible contracts. Do not change them casually.

## Vault Contracts

- Raven talks to Vault through
  [VaultService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/VaultService.java).
- Expected Mongo collections:
  `manga_library`, `raven_download_tasks`, `noona_settings`
- Expected Redis keys/prefixes:
  `raven:download:current-task`
- If Vault policy or collection names change, Raven will fail at runtime with authorization or lookup errors rather
  than compile-time errors.

## Settings Model

- [SettingsService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/settings/SettingsService.java)
  caches Vault-backed settings for 5 seconds.
- Naming settings live under key `downloads.naming`.
- Worker settings live under key `downloads.workers`.
- VPN settings live under key `downloads.vpn`.
- Missing or unreadable settings fall back to defaults and log warnings with cooldowns instead of failing startup.

## Worker Settings

- Worker settings store:
  `threadRateLimitsKbps` and `cpuCoreIds`
- The lists are normalized to match the configured download thread count.
- `0` disables per-thread rate limiting and `-1` means no CPU pinning for that worker slot.

## VPN Settings

- VPN settings store:
  `provider`, `enabled`, `onlyDownloadWhenVpnOn`, `autoRotate`, `rotateEveryMinutes`, `region`, `piaUsername`,
  `piaPassword`
- Raven currently only supports the `pia` provider.
- The VPN root lives under `downloads/vpn/pia`.
- Raven downloads and refreshes PIA OpenVPN profiles automatically, then uses the `openvpn` binary at runtime.

## Kavita Sync Inputs

- Raven prefers Portal-backed Kavita helpers when `PORTAL_BASE_URL` is set.
- Direct Kavita fallback uses:
  `KAVITA_BASE_URL`, `KAVITA_API_KEY`, and `KAVITA_LIBRARY_ROOT`
- `KAVITA_LIBRARY_ROOT` is important because Raven uses it to build expected library folder paths and merge current and
  legacy folder conventions.

## Useful Editing Reminders

- Search sessions are in-memory only. Persisted recovery applies to download tasks, not open search results.
- If you touch file movement, promotion, rename logic, or title-folder resolution, read both
  [DownloadService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/DownloadService.java) and
  [LibraryService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/LibraryService.java).
- If you touch status payloads, worker mode, or VPN flow, check Moon/Sage usage because those services surface Raven
  state to admins.
