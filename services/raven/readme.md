# Raven (Noona Stack 2.2)

Raven is Noona's downloader and library worker service. It searches supported sources, queues chapter jobs, builds
`.cbz` files, and reports live/ historical download status.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Spring entrypoint](src/main/java/com/paxkun/raven/RavenApplication.java)
- [Controllers](src/main/java/com/paxkun/raven/controller/)
- [Download orchestrator](src/main/java/com/paxkun/raven/service/DownloadService.java)
- [Worker launcher](src/main/java/com/paxkun/raven/service/RavenWorkerLauncher.java)
- [Worker runtime switches](src/main/java/com/paxkun/raven/service/RavenRuntimeProperties.java)
- [Linux CPU affinity helper](src/main/java/com/paxkun/raven/service/LinuxCpuAffinity.java)
- [Download services](src/main/java/com/paxkun/raven/service/download/)
- [VPN manager](src/main/java/com/paxkun/raven/service/VPNServices.java)
- [Library services](src/main/java/com/paxkun/raven/service/library/)
- [Gradle build config](build.gradle)
- [Tests](src/test/java/com/paxkun/raven/)

## Download Workflow

1. Search titles.
2. Select a source option.
3. Queue chapter downloads into the `downloading/` workspace under Raven's downloads root.
4. Zip finished chapters there, then move completed title folders into `downloaded/`.
5. Track progress/status in Vault-backed Mongo task documents, mirror the latest snapshot into Redis for compatibility,
   and update local library metadata.
6. Write a `<uuid>.noona` manifest beside the completed title's `.cbz` files so Noona can rebuild that title later if
   the library database needs to be restored.
7. Ask Portal/Kavita to scan the matching library after successful imports so new titles appear in Kavita.

## API Surface (Direct Raven)

- `GET /v1/download/health`
- `GET /v1/download/search/{titleName}`
- `GET /v1/download/title-details?url=<source_url>` - scrape a source title page for summary, media type,
  `Adult Content`, `Associated Name(s)`, `Status`, `Released`, `Official Translation`, `Anime Adaptation`, and
  `Related Series(s)`
- `GET /v1/download/select/{searchId}/{optionIndex}`
- `POST /v1/download/pause` - gracefully pause active tasks after the current chapter finishes and persist pending work
- `GET /v1/download/status`
- `GET /v1/download/status/summary`
- `POST /v1/download/pause`
- `DELETE /v1/download/status/{title}`
- `GET /v1/vpn/status`
- `GET /v1/vpn/regions`
- `POST /v1/vpn/rotate`
- `POST /v1/vpn/test-login`
- `GET /v1/library/health`
- `GET /v1/library/getall`
- `GET /v1/library/get/{titleName}`
- `PATCH /v1/library/title/{uuid}` - update stored library metadata for an existing title (`title`, `sourceUrl`, and
  now `coverUrl`)
- `POST /v1/library/title/{uuid}/volume-map` - store provider-backed chapter-to-volume assignments, persist the
  matched metadata ids on the Raven title, and optionally auto-rename existing chapter archives to the current naming
  template
- `POST /v1/library/imports/check` - scan `downloaded/` for `.noona` manifests, rebuild missing Noona library rows,
  sync missing/new chapters from the source, and trigger Kavita scans for affected libraries

## Build & Test
```bash
cd services/raven
./gradlew clean build
./gradlew test
```

## Manual Scraper Inspection

To capture the current live fields Raven extracts for `Solo Leveling` from WeebCentral, run:

```bash
cd services/raven
./gradlew -PliveScrape=true test --tests com.paxkun.raven.service.download.TitleScraperSoloLevelingInspectionTest
```

The test writes a pretty-printed JSON snapshot to `build/test-results/live-scrape/solo-leveling-inspection.json`.

## Docker (from repository root)
```bash
docker build --no-cache -f raven.Dockerfile -t captainpax/noona-raven .
docker run -p 8080:8080 -v <host_downloads_dir>:/app/downloads -v <host_logs_dir>:/app/logs captainpax/noona-raven
```

## Runtime Notes

- Java toolchain targets Java 21.
- Selenium + headless Chrome are required for scraping flows.
- Persist downloads by mounting a host directory to `/app/downloads`.
- Raven now uses `/app/downloads/downloading` for active work and `/app/downloads/downloaded` for completed title
  folders.
- Raven writes a `<uuid>.noona` JSON manifest into each completed title folder. The manifest stores the Raven/Noona
  title metadata needed to re-import that title into the library database after a reset. Raven now also persists each
  title's `chapterVolumeMap`, `downloadedChapterFiles`, and matched metadata provider ids there so import checks and
  later volume-map reapplications can rebuild the exact chapter/file index without guessing from filenames.
- Raven writes `latest.log` under `NOONA_LOG_DIR` when that environment variable is set. Warden-managed installs mount
  Raven logs at `/app/logs`.
- Raven now supports PIA OpenVPN rotation controls through `/v1/vpn/*`. It reads Vault key `downloads.vpn`,
  pauses active downloads at chapter boundaries, rotates to the selected PIA region, then resumes paused tasks.
  Scheduled rotation is driven by the configured interval (default 30 minutes). When `onlyDownloadWhenVpnOn` is
  enabled in that same settings document, queued Raven downloads wait until the VPN reports a live connection before
  starting.
- After Raven connects OpenVPN, it now replays the pre-VPN non-default IPv4 routes back onto the container's local
  interface so Docker-local traffic to services like Vault, Portal, and managed Kavita stays on the Noona bridge
  network while Raven's internet-bound download traffic continues using the VPN default route.
- `POST /v1/vpn/test-login` validates provided PIA credentials against a selected region profile without triggering
  the download pause/rotate/resume flow, and returns Raven's `https://api64.ipify.org?format=json` reported IP for
  that login test.
- Raven's container now includes `openvpn`. For managed Docker installs, keep Warden's Raven tunnel capability enabled
  (`NET_ADMIN` + `/dev/net/tun`) so OpenVPN can establish the tunnel.
- On Linux, Raven's main server now acts as the queue/API/VPN coordinator and launches one child Raven worker process
  per active worker slot. Each child can apply `sched_setaffinity` to its configured Linux CPU core, and that process
  affinity is inherited by ChromeDriver/Chrome descendants both on bare metal and inside Docker.
- Raven worker settings now come from Vault key `downloads.workers` with both `threadRateLimitsKbps` and
  `cpuCoreIds`. Raven normalizes both arrays to `RAVEN_DOWNLOAD_THREADS`, and `cpuCoreIds: -1` means the worker stays
  process-isolated but is not affinity-pinned.
- Raven now persists the latest tracked download/sync task into Vault collection `raven_download_tasks` and mirrors the
  current snapshot into Redis key `raven:download:current-task`. Task documents now carry `workerIndex`, `cpuCoreId`,
  `workerPid`, `executionMode`, and `pauseRequested`, and those Mongo documents are the source of truth for
  `/status`, `/history`, restore-on-startup, and main-process worker supervision.
- Raven now retries transient Vault read failures (for persisted task restore, current-task snapshot reads, and
  settings fetches) so startup races where Vault is still warming up do not immediately fail Raven recovery/state
  loading.
- Raven pause requests now use the persisted `pauseRequested` flag on the task document. Workers observe that flag
  before starting and again at chapter boundaries, then mark the task `paused` while keeping remaining chapters in the
  persisted snapshot for later resume.
- Raven reads `downloads.naming` and `downloads.workers` from Vault so Moon can control chapter naming, per-worker
  speed limits, and Linux CPU-core assignments without editing container env.
- New Raven naming defaults now follow a Kavita-style manga chapter pattern:
  `{title} c{chapter} (v{volume}) [Noona].cbz`, with the default chapter padding set to `3` so chapter `3` becomes
  `c003` and the default volume padding set to `2` so fallback volume `1` renders as `v01`.
- In Raven naming templates, `{chapter}` now uses the configured chapter padding width. `{chapter_padded}` remains as a
  compatible alias for the same padded value. `{volume}` and `{volume_padded}` now use Raven's stored
  `chapterVolumeMap` when Noona has an explicit provider-backed metadata match, and otherwise fall back to volume `1`
  so unmatched/manual downloads keep the legacy `v01` behavior.
- Missing-chapter detection now prefers the stored `downloadedChapterNumbers` index on each library title instead of
  depending only on archive file-name parsing, which avoids false positives for series names that contain digits or
  custom chapter naming templates. When Raven does need to parse legacy archive names, it now prefers explicit
  `c###` chapter markers before trailing digits so `(v02)` is not mistaken for chapter `2`.
- Raven title metadata patching now also accepts `coverUrl`, which lets Portal backfill missing Noona library cover
  art from a selected metadata match before locking that same cover into Kavita.
- When Portal later supplies a usable provider-backed chapter-to-volume map, Raven can idempotently rename existing
  `.cbz` files to the current template, skip collisions without deleting data, update the persisted
  `downloadedChapterFiles` index, and rewrite the adjacent `.noona` manifest after each successful rename batch.
- When `KAVITA_LIBRARY_ROOT` is configured, Raven now auto-creates matching Kavita libraries for new media-type
  folders it writes into the shared downloads tree. It prefers Portal's
  `POST /api/portal/kavita/libraries/ensure` flow when `PORTAL_BASE_URL` is available, then falls back to direct
  `KAVITA_BASE_URL` / `KAVITA_API_KEY` access. Managed-library sync now also adds Raven's current
  `downloaded/<type>` folders plus legacy roots so existing Kavita libraries can recover from older Noona path bugs
  without manual folder edits.
- After Raven finishes moving a title into `downloaded/`, it asks Portal to run
  `POST /api/portal/kavita/libraries/scan` for that media-type library so Kavita picks up the new files. If Portal is
  unavailable, Raven falls back to a direct Kavita library scan when `KAVITA_BASE_URL` and `KAVITA_API_KEY` are set.
- `GET /v1/download/title-details` now scrapes the selected source title page directly so Portal can read fields like
  `Adult Content: yes`, `Associated Name(s)`, `Status`, `Released`, `Official Translation`, `Anime Adaptation`, and
  `Related Series(s)` from the same site Raven later uses for download and Moon title-page metadata.
- `POST /v1/library/imports/check` replays those `.noona` manifests on demand: Raven recreates missing library rows,
  rechecks the source for missing/new chapters using the files already present on disk, downloads anything still
  missing, and then requests Kavita scans for the affected media types.
- `GET /v1/download/status/summary` now exposes the active download title, current library-check title, idle state,
  the effective worker rate-limit array, configured worker CPU-core ids, Raven's currently allowed Linux CPU ids,
  active worker process handles, the service-wide worker execution mode, and the current persisted task snapshot so
  Portal and Moon can surface live activity, affinity layout, and recovery state after restarts.

## Documentation Rule

If you change endpoint contracts, chapter naming, or scraper source behavior, update this README and the linked
controller/service files in the same PR.
