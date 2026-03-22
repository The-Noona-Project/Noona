# Raven

Raven is Noona's downloader and library worker. It searches supported sources, builds the downloaded files, tracks job
state, and keeps the managed library in sync.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Raven AI docs](../../docs/agents/raven/README.md)
- [Controllers](src/main/java/com/paxkun/raven/controller/)
- [Core services](src/main/java/com/paxkun/raven/service/)
- [Download controller](src/main/java/com/paxkun/raven/controller/DownloadController.java)
- [Download service](src/main/java/com/paxkun/raven/service/DownloadService.java)
- [Build file](build.gradle)
- [Tests](src/test/java/com/paxkun/raven/)

## What Raven Does

- searches titles and queues downloads
- can crawl alphabetic source listings and bulk-queue matching titles for trusted admin tooling
- supports special-character-safe JSON search and queue requests while keeping the legacy GET endpoints for
  compatibility
- creates the library files Noona serves
- tracks active and historical download state
- preserves exact fractional chapter identifiers like `101.1` and `101.5` instead of collapsing them into `101`
- returns structured queue outcomes so callers can distinguish accepted queues from expired, invalid, or already-active
  selections
- supports import checks and metadata-related library repair flows
- refreshes cached PIA OpenVPN profiles atomically and keeps the last known-good profiles when an upstream archive
  refresh fails
- establishes a baseline PIA tunnel automatically whenever VPN is enabled, even if auto-rotate is off
- accepts manual `Rotate now` requests only after Raven has reserved the rotation and validated the active PIA
  settings, then completes the tunnel change in the background
- fresh-reads VPN settings for manual rotate validation, scheduler auto-connect, and VPN-gated download waits so a
  newly saved region, credential, or download gate change takes effect immediately instead of waiting for the normal
  settings cache window
- keeps phase-specific VPN transition failures in the returned/runtime error text and appends cleanup failures instead
  of overwriting the primary cause with a generic rotation error
- treats auto-rotate as periodic re-rotation only; queued downloads waiting on VPN should start once Raven finishes the
  baseline connection or reports a concrete VPN error
- returns the final `Test login` probe result directly instead of only acknowledging a background job
- stores its shared settings and task state through Vault's internal service API in managed installs

## Who It Is For

- Server admins managing downloads and library sync
- Contributors working on downloader, scraper, or worker logic

## When An Admin Needs To Care

- when downloads, imports, or sync jobs fail
- when a source publishes fractional update chapters or extras and you need to confirm Raven kept them as separate
  entries
- when tuning worker, naming, or VPN-related settings
- when Moon shows a Raven VPN profile refresh or discovery error under the PIA settings card
- when Moon reports that a VPN save/apply or rotation is still settling or a login test failed with a final probe
  result
- when Moon shows a queued download waiting on VPN together with a Raven connection state or last-error hint
- when checking that downloaded content actually landed on disk

## How It Fits Into Noona

Raven runs behind Moon, Sage, Portal, and Warden. Admins usually control it from Moon rather than calling Raven
directly.

## Next Steps

- Admin install and operations: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/raven/README.md](../../docs/agents/raven/README.md)
