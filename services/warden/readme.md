# Warden

Warden is Noona's Docker control plane. It starts the stack, applies the saved setup profile, tracks service state, and
exposes the management APIs that the rest of Noona uses.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Warden AI docs](../../docs/agents/warden/README.md)
- [Entrypoint](initWarden.mjs)
- [Core modules](core/)
- [Docker descriptors](docker/)
- [Tests](tests/)

## What Warden Does

- pulls and starts managed Noona containers
- stores and restores the active setup profile, with `storageRoot` persisted separately from per-service runtime
  overrides
- keeps the saved setup profile in `wardenm/noona-settings.json` under `NOONA_DATA_ROOT` and auto-migrates older
  duplicate snapshot files into that canonical location
- keeps normal post-setup boot in minimal mode so Sage and Moon return first, while full ecosystem startup stays on the
  explicit `bootFull()` / `startEcosystem()` lifecycle path
- still restores the full managed lifecycle automatically when setup is incomplete and installed managed services imply
  an interrupted install
- normalizes older setup JSON uploads for Moon review without persisting them until an explicit save or install
- tracks install progress, service health, and logs
- returns structured service-health payloads with `success` / `supported` metadata so Moon and Sage can distinguish a
  real failed probe from a running service that simply does not expose a dedicated health endpoint
- reports `installed` and `running` separately in the service catalog so callers can tell the difference between a
  present stopped container and a live service
- exposes `/health` readiness metadata so callers can tell the difference between "Warden is listening" and "bootstrap
  finished"
- publishes managed Moon runtime fields such as `WEBGUI_PORT`, `MOON_EXTERNAL_URL`, and optional `SAGE_BASE_URL`
  overrides so admins can repair Moon-facing routing without hand-editing containers
- keeps runtime env changes in memory and in `warden/service-runtime-config.json` even when Vault-backed settings are
  still warming up during first boot
- keeps service-config secrets redacted by default while still letting trusted Sage reuse the already-installed managed
  Kavita API key during setup summary sync
- coordinates updates, restarts, and factory-reset behavior
- bootstraps managed host log folders so supported services can write logs to `NOONA_DATA_ROOT` without manual host-side
  permission prep
- keeps Mongo and Redis on a private Docker data network, with Vault as the only managed bridge to that network
- generates and mounts the internal Vault HTTPS certificate bundle used by the stack
- treats a missing `noona-warden` self-container as a real boot error when Warden is supposed to be running inside
  Docker, instead of silently skipping the control-network attach step
- refuses to start managed Vault from a Linux Warden container when `NOONA_DATA_ROOT` is not bind-mounted into Warden at
  the same absolute path as the host

## Who It Is For

- Server admins installing or operating Noona
- Contributors working on stack orchestration and setup behavior

## When An Admin Needs To Care

- during the initial Docker + Warden install
- when changing storage, update, or restart behavior
- when Moon reports service-management or restore problems

## How It Fits Into Noona

Warden is the first service you start. Moon, Sage, Portal, and the rest of the managed stack rely on Warden for service
lifecycle and setup state. In managed installs it also owns the internal Vault trust bundle and routes shared data
through Vault, including Portal's short-lived onboarding and Discord DM queue state.

`GET /health` reports `ready: false` until `warden.init()` finishes. During that window Moon and Sage may already be
reachable, but first-run setup calls should treat Warden as still warming up rather than as fully initialized.
After setup is complete, that normal init path still only restores Sage and Moon.
Warden keeps `manualBootRequired` as an in-memory runtime flag for the current Warden session and only sets it when the
saved selected ecosystem is waiting behind that minimal post-setup boot path.
Moon's `/bootScreen` uses Warden's existing lifecycle ordering to start the saved ecosystem when an admin explicitly
requests it, and later service outages or failed probes do not flip the system back into manual-boot mode.

For the supported install path, use [ServerAdmin.md](../../ServerAdmin.md) instead of treating Warden as a standalone
app.

## Next Steps

- Install or operate Noona: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/warden/README.md](../../docs/agents/warden/README.md)
