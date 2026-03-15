# Raven AI Notes

Raven is Noona's downloader, scraper, library worker, and VPN-aware acquisition service. Most edits fall into one of
five areas: HTTP contracts, download orchestration, library/manifests, runtime workers, or VPN/settings behavior.

## Start Here

- [files-and-rules.md](files-and-rules.md)
- [flows.md](flows.md)
- [storage-settings-and-runtime.md](storage-settings-and-runtime.md)
- [Public README](../../../services/raven/readme.md)
- [Controllers](../../../services/raven/src/main/java/com/paxkun/raven/controller/)
- [Core services](../../../services/raven/src/main/java/com/paxkun/raven/service/)
- [Tests](../../../services/raven/src/test/java/com/paxkun/raven/)

## Service Shape

- Boot starts in [RavenApplication.java](../../../services/raven/src/main/java/com/paxkun/raven/RavenApplication.java).
- HTTP routes live in the controller layer:
  [DownloadController.java](../../../services/raven/src/main/java/com/paxkun/raven/controller/DownloadController.java),
  [LibraryController.java](../../../services/raven/src/main/java/com/paxkun/raven/controller/LibraryController.java),
  [VpnController.java](../../../services/raven/src/main/java/com/paxkun/raven/controller/VpnController.java), and
  [DebugController.java](../../../services/raven/src/main/java/com/paxkun/raven/controller/DebugController.java).
- Download orchestration and persisted task recovery live in
  [DownloadService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/DownloadService.java).
- Source search, browse scraping, title-details parsing, and chapter list extraction live in
  [TitleScraper.java](../../../services/raven/src/main/java/com/paxkun/raven/service/download/TitleScraper.java).
- Library metadata, `.noona` manifests, import checks, and repair flows live in
  [LibraryService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/LibraryService.java).
- VPN rotation and PIA/OpenVPN integration live in
  [VPNServices.java](../../../services/raven/src/main/java/com/paxkun/raven/service/VPNServices.java).
- Vault and settings integration live in
  [VaultService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/VaultService.java) and
  [SettingsService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/settings/SettingsService.java).

## Common Task Map

- Search, queue, and status payload changes:
  [DownloadController.java](../../../services/raven/src/main/java/com/paxkun/raven/controller/DownloadController.java)
- Queue/pause/recovery behavior, bulk queue orchestration, or task persistence:
  [DownloadService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/DownloadService.java)
- Search browsing, title-detail parsing, or chapter identity behavior:
  [TitleScraper.java](../../../services/raven/src/main/java/com/paxkun/raven/service/download/TitleScraper.java)
- Title metadata, imported manifests, file listing, delete, rename, or sync logic:
  [LibraryService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/LibraryService.java)
- Vault packet contracts or settings reads:
  [VaultService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/VaultService.java) and
  [SettingsService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/settings/SettingsService.java)
- Child worker boot, CPU pinning, or Linux-only process-mode behavior:
  [RavenWorkerLauncher.java](../../../services/raven/src/main/java/com/paxkun/raven/service/RavenWorkerLauncher.java),
  [RavenWorkerRunner.java](../../../services/raven/src/main/java/com/paxkun/raven/service/RavenWorkerRunner.java), and
  [RavenRuntimeProperties.java](../../../services/raven/src/main/java/com/paxkun/raven/service/RavenRuntimeProperties.java)
- Kavita auto-library creation or scan behavior:
  [KavitaSyncService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/KavitaSyncService.java)
- PIA profiles, login tests, and rotation flow:
  [VPNServices.java](../../../services/raven/src/main/java/com/paxkun/raven/service/VPNServices.java)

## Editing Convention

- First-party Raven `.java` files carry a top Javadoc header with a short file purpose, a few related Raven files, and a
  `Times this file has been edited: N` counter.
- Refresh that counter from git history when you materially edit the file, then add `1` for the current change.
- Add or update Javadocs for public types, public methods, and any non-trivial helpers touched in the same edit.

## Cross-Service Impact

- [Moon](../moon/README.md) and [Sage](../sage/README.md) surface Raven settings, queue state, and repair flows, so
  admin-facing payload changes ripple upward quickly.
- [Vault](../vault/README.md) enforces Raven's allowed collections and Redis keys. Collection or key changes are not
  local-only edits.
- [Portal](../portal/README.md) can broker Kavita library ensure/scan requests for Raven and now proxies bulk queue
  requests for the DM-only `downloadall` command.
- Warden/admin docs care about Raven's on-disk layout because backups, restores, and setup flows depend on it.

## Current Invariants

- Fractional chapters are exact chapter identities now.
  `101`, `101.1`, and `101.5` must remain distinct through scrape, queue, persistence, sync, and missing-chapter
  detection.
- Only trivial numeric normalization is allowed for chapter numbers.
  `101.0` may normalize to `101`, but `101.1` must never collapse into `101`.
- Bulk alphabetic browse for Portal's DM admin flow currently comes from WeebCentral `search/data` with explicit
  `included_type`, `adult`, `limit`, and `offset` parameters.

## Update Triggers

- If naming, folder layout, `.noona` manifests, import checks, or VPN behavior change, update admin-facing docs too.
- If you change route payloads or status summaries, update the controller tests in the same change.
- If you change worker mode assumptions, read the runtime and worker docs first. Thread mode and process mode share the
  same persisted task contract.
