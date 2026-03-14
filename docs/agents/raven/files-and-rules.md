# Raven Files And Rules

## Important Files

- [build.gradle](../../../services/raven/build.gradle): Java 21, Spring Boot packaging, Selenium/WebDriver, and test
  profile setup.
- [src/main/resources/application.properties](../../../services/raven/src/main/resources/application.properties):
  Spring Boot defaults, including local Docker Compose auto-start behavior.
- [src/main/java/com/paxkun/raven/controller/DownloadController.java](../../../services/raven/src/main/java/com/paxkun/raven/controller/DownloadController.java):
  search, queue, status, summary, pause, and history HTTP contracts.
- [src/main/java/com/paxkun/raven/controller/LibraryController.java](../../../services/raven/src/main/java/com/paxkun/raven/controller/LibraryController.java):
  title CRUD, file listing/deletion, volume-map, sync, and import-check routes.
- [src/main/java/com/paxkun/raven/controller/VpnController.java](../../../services/raven/src/main/java/com/paxkun/raven/controller/VpnController.java):
  VPN status, regions, rotate-now, and login-test routes.
- [src/main/java/com/paxkun/raven/controller/DebugController.java](../../../services/raven/src/main/java/com/paxkun/raven/controller/DebugController.java):
  Raven debug toggle.
- [src/main/java/com/paxkun/raven/service/DownloadService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/DownloadService.java):
  search sessions, queueing, download execution, task recovery, worker supervision, and disk writes.
- [src/main/java/com/paxkun/raven/service/LibraryService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/LibraryService.java):
  library persistence, `.noona` manifest writes, import recovery, volume-map rename logic, and Kavita scans.
- [src/main/java/com/paxkun/raven/service/VPNServices.java](../../../services/raven/src/main/java/com/paxkun/raven/service/VPNServices.java):
  PIA profile management, OpenVPN connect/rotate, and route preservation.
- [src/main/java/com/paxkun/raven/service/KavitaSyncService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/KavitaSyncService.java):
  Kavita library ensure/scan fallback through Portal or direct Kavita APIs.
- [src/main/java/com/paxkun/raven/service/VaultService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/VaultService.java):
  authenticated Vault packet client for Mongo and Redis, including explicit HTTPS CA trust wiring.
- [src/main/java/com/paxkun/raven/service/LoggerService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/LoggerService.java):
  downloads root, log root, and debug flag wiring.
- [src/main/java/com/paxkun/raven/service/RavenWorkerLauncher.java](../../../services/raven/src/main/java/com/paxkun/raven/service/RavenWorkerLauncher.java),
  [RavenWorkerRunner.java](../../../services/raven/src/main/java/com/paxkun/raven/service/RavenWorkerRunner.java), and
  [RavenRuntimeProperties.java](../../../services/raven/src/main/java/com/paxkun/raven/service/RavenRuntimeProperties.java):
  process-worker boot contract.
- [src/main/java/com/paxkun/raven/service/settings/SettingsService.java](../../../services/raven/src/main/java/com/paxkun/raven/service/settings/SettingsService.java):
  cached Vault-backed naming, worker, and VPN settings.
- [src/test/java/com/paxkun/raven/controller/](../../../services/raven/src/test/java/com/paxkun/raven/controller/):
  HTTP contract coverage.
- [src/test/java/com/paxkun/raven/service/](../../../services/raven/src/test/java/com/paxkun/raven/service/):
  worker, library, VPN, Vault, and logger behavior coverage.

## Rules

- Preserve `.noona` manifest compatibility unless a migration is part of the change.
- First-party Raven `.java` files should keep the standard top Javadoc header with file purpose, related-file pointers,
  and `Times this file has been edited: N`.
- Refresh the edit counter from git history when you touch a Raven `.java` file, then add `1` for the in-flight edit.
- Add or update Javadocs for public types, public methods, and non-trivial helpers you change so the code stays
  navigable.
- Preserve the managed folder contract: Raven stages work under `downloads/downloading` and promotes finished content
  into `downloads/downloaded`.
- Keep the legacy GET search/queue endpoints working unless the change explicitly removes backward compatibility and
  updates callers. Raven currently supports newer JSON POST endpoints alongside those GET routes.
- Treat these storage contracts as durable:
  `manga_library`, `raven_download_tasks`, `noona_settings`, and `raven:download:current-task`.
- Treat these settings keys as durable:
  `downloads.naming`, `downloads.workers`, and `downloads.vpn`.
- Thread mode and Linux process mode must keep using the same persisted task model so recovery works after restarts.
- Status/history/summary payloads are admin-facing contracts. Moon and Sage rely on them for Raven monitoring and
  repair flows.
- Raven's disk layout, file naming, import behavior, and manifest writes are admin-visible and belong in public/admin
  docs when changed.
- VPN rotation is not isolated networking code. It pauses downloads, waits for drain, reconnects OpenVPN, restores
  local routes, and resumes paused tasks.
- Kavita library ensure/scan behavior is cross-service. Raven may call Portal first and direct Kavita second.
- Vault-backed worker, naming, or VPN settings need cross-service thinking because Moon and Sage surface them.
- If Raven talks to Vault over HTTPS, `vault.caCertPath` / `VAULT_CA_CERT_PATH` is part of the runtime contract.
  Do not bypass certificate validation globally just to make local calls pass.
