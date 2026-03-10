# Raven (Noona Stack 2.2)

Raven is Noona's downloader and library worker service. It searches supported sources, queues chapter jobs, builds
`.cbz` files, and reports live/ historical download status.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Spring entrypoint](src/main/java/com/paxkun/raven/RavenApplication.java)
- [Controllers](src/main/java/com/paxkun/raven/controller/)
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
5. Track progress/status, persist the current task into Vault-backed Mongo plus the Redis current-task cache, and
   update local library metadata.
6. Ask Portal/Kavita to scan the matching library after successful imports so new titles appear in Kavita.

## API Surface (Direct Raven)

- `GET /v1/download/health`
- `GET /v1/download/search/{titleName}`
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

## Build & Test
```bash
cd services/raven
./gradlew clean build
./gradlew test
```

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
- Raven writes `latest.log` under `NOONA_LOG_DIR` when that environment variable is set. Warden-managed installs mount
  Raven logs at `/app/logs`.
- Raven now supports PIA OpenVPN rotation controls through `/v1/vpn/*`. It reads Vault key `downloads.vpn`,
  pauses active downloads at chapter boundaries, rotates to the selected PIA region, then resumes paused tasks.
  Scheduled rotation is driven by the configured interval (default 30 minutes).
- `POST /v1/vpn/test-login` validates provided PIA credentials against a selected region profile without triggering
  the download pause/rotate/resume flow, and returns Raven's `https://api64.ipify.org?format=json` reported IP for
  that login test.
- Raven's container now includes `openvpn`. For managed Docker installs, keep Warden's Raven tunnel capability enabled
  (`NET_ADMIN` + `/dev/net/tun`) so OpenVPN can establish the tunnel.
- Raven now persists the latest tracked download/sync task into Vault collection `raven_download_tasks` and mirrors the
  current snapshot into Redis key `raven:download:current-task`. Interrupted tasks are resumed on startup when Raven
  comes back after a crash or power loss.
- Raven now retries transient Vault read failures (for persisted task restore, current-task snapshot reads, and
  settings fetches) so startup races where Vault is still warming up do not immediately fail Raven recovery/state
  loading.
- Raven pause requests now stop active downloads at chapter boundaries: the chapter currently in progress is allowed to
  finish, then Raven marks the task `paused` and keeps remaining chapters in the persisted task snapshot for later
  resume.
- Raven reads `downloads.naming` and `downloads.workers` from Vault so Moon can control chapter naming plus per-thread
  speed limits without editing container env.
- In Raven naming templates, `{chapter}` now uses the configured chapter padding width. `{chapter_padded}` remains as a
  compatible alias for the same padded value.
- Missing-chapter detection now prefers the stored `downloadedChapterNumbers` index on each library title instead of
  depending only on archive file-name parsing, which avoids false positives for series names that contain digits or
  custom chapter naming templates.
- Raven title metadata patching now also accepts `coverUrl`, which lets Portal backfill missing Noona library cover
  art from a selected metadata match before locking that same cover into Kavita.
- When `KAVITA_LIBRARY_ROOT` is configured, Raven now auto-creates matching Kavita libraries for new media-type
  folders it writes into the shared downloads tree. It prefers Portal's
  `POST /api/portal/kavita/libraries/ensure` flow when `PORTAL_BASE_URL` is available, then falls back to direct
  `KAVITA_BASE_URL` / `KAVITA_API_KEY` access. Managed-library sync now also adds Raven's current
  `downloaded/<type>` folders plus legacy roots so existing Kavita libraries can recover from older Noona path bugs
  without manual folder edits.
- After Raven finishes moving a title into `downloaded/`, it asks Portal to run
  `POST /api/portal/kavita/libraries/scan` for that media-type library so Kavita picks up the new files. If Portal is
  unavailable, Raven falls back to a direct Kavita library scan when `KAVITA_BASE_URL` and `KAVITA_API_KEY` are set.
- `GET /v1/download/status/summary` exposes the active download title, current library-check title, idle state, and
  the effective worker rate-limit array plus the current persisted task snapshot so Portal and Moon can surface live
  activity and recovery state after restarts.

## Documentation Rule

If you change endpoint contracts, chapter naming, or scraper source behavior, update this README and the linked
controller/service files in the same PR.
