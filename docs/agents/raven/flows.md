# Raven Flows

## Boot And Runtime Mode

- [RavenApplication.java](../../../services/raven/src/main/java/com/paxkun/raven/RavenApplication.java) starts the
  Spring Boot app for both the main server and one-shot worker processes.
- [RavenRuntimeProperties.java](../../../services/raven/src/main/java/com/paxkun/raven/service/RavenRuntimeProperties.java)
  decides whether Raven is the main server or a child worker.
- Main-process Raven uses thread workers by default on non-Linux hosts and process workers on Linux hosts.
- Child workers are launched by
  [RavenWorkerLauncher.java](../../../services/raven/src/main/java/com/paxkun/raven/service/RavenWorkerLauncher.java)
  and execute a single persisted task through
  [RavenWorkerRunner.java](../../../services/raven/src/main/java/com/paxkun/raven/service/RavenWorkerRunner.java).

## Search To Queue To Download

- Search starts in `GET /v1/download/search/{titleName}` or `POST /v1/download/search`.
- Raven stores search results in an in-memory search session with a 10-minute TTL.
- Queueing happens through the legacy `GET /v1/download/select/{searchId}/{optionIndex}` route or the newer
  `POST /v1/download/select` JSON route.
- The JSON queue route returns structured status values instead of only a message. The controller maps:
  invalid selection to `400`, expired search to `410`, already-active or maintenance-pause states to `409`, and
  accepted queues to `202`.
- Download execution and status persistence live in
  [DownloadService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/DownloadService.java).

## Task Persistence And Recovery

- Raven persists task snapshots in the Vault Mongo collection `raven_download_tasks`.
- Raven also writes the current task snapshot to Redis key `raven:download:current-task`.
- On boot, Raven restores queued, downloading, recovering, and interrupted tasks from Vault.
- Pause requests are persisted so Raven can cleanly stop after the current chapter and later resume the task.
- Thread mode and process mode use different executors/supervisors, but both depend on the same persisted
  `DownloadProgress` contract.

## Library, Sync, And Import Flow

- Raven stores title metadata in Vault collection `manga_library`.
- [LibraryService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/LibraryService.java) updates
  title metadata, chapter indexes, file maps, and `downloadPath` whenever new work lands.
- Raven writes a `.noona` manifest beside managed title content so imports and restores can reconstruct the title.
- `POST /v1/library/checkForNew` checks the full library for new or missing chapters.
- `POST /v1/library/title/{uuid}/checkForNew` checks one title.
- `POST /v1/library/imports/check` scans managed folders for `.noona` manifests, imports missing titles, and can queue
  missing or new chapters afterward.
- `POST /v1/library/title/{uuid}/volume-map` stores provider metadata and can auto-rename existing files to match the
  configured volume map.

## Kavita Sync Flow

- Library updates call
  [KavitaSyncService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/KavitaSyncService.java) to
  ensure the right Kavita library exists for the title type.
- Raven prefers Portal-backed Kavita helpers when `PORTAL_BASE_URL` is configured.
- If Portal is unavailable, Raven can talk to Kavita directly using `KAVITA_BASE_URL` and `KAVITA_API_KEY`.
- Import checks and title syncs request Kavita scans after Raven writes or repairs content.

## VPN Rotation Flow

- `VPNServices` manages PIA region lists, login tests, active OpenVPN state, and scheduled rotation.
- When VPN is enabled and Raven is disconnected, the scheduler now runs an auto-connect path even if `autoRotate` is
  false.
  That establishes the baseline tunnel for VPN-gated downloads without waiting for a manual rotate.
- `POST /v1/vpn/rotate` triggers the manual path.
  Raven reserves `rotationInProgress`, validates enabled PIA settings immediately, and only then returns the async
  accepted response.
- Raven uses a fresh VPN settings read for manual-rotate validation and for the scheduler's auto-connect path, so a
  save in Moon or Sage is visible to Raven right away instead of after the normal settings cache TTL.
- Auto-connect and manual rotation both use the same maintenance-pause flow:
  pause active downloads, wait for in-flight work to drain, reconnect OpenVPN, restore preserved local routes, then
  resume only the titles paused by that VPN transition.
- Stage-specific failures are recorded at the point they happen.
  `VpnRuntimeStatus.lastError` and the manual rotation result now keep the primary failure stage detail, and follow-up
  cleanup problems are appended instead of replacing the original cause.
- Failed auto-connect attempts record `VpnRuntimeStatus.lastError` and back off for one minute before the scheduler
  retries again.
- If rotation fails after OpenVPN connected, Raven disconnects the tunnel, restores preserved local routes, clears
  maintenance pause, and only then resumes the rotation-owned downloads.
- `POST /v1/vpn/test-login` is a lighter probe path that validates credentials and region connectivity without taking
  over Raven's long-running VPN session.
  The login test now returns the final probe result synchronously and restores preserved local routes on both success
  and failure paths.

## Debug And Status Flow

- `GET /v1/debug` and `POST /v1/debug` toggle the `LoggerService` debug flag.
- `GET /v1/download/status/summary` blends download progress with library-check activity so Moon can show a task-based
  current state instead of raw worker internals.
- The summary payload now also includes `vpn` runtime details from `VPNServices` so Moon can explain queued tasks that
  are blocked on VPN startup or failure.
- `DownloadService` also fresh-reads VPN settings for queue gating checks, so disabling `onlyDownloadWhenVpnOn` or
  otherwise removing the wait condition releases queued work without waiting for the old 5-second VPN settings cache.
- If the summary shape changes, update controller tests and any Moon/Sage code that renders Raven state.
