# Warden Boot And Restore Flows

## Cold Start

- `initWarden.mjs` creates the Warden instance and starts the HTTP API.
- Warden resolves the service catalog, storage layout, and startup environment before it starts managed services.
- The supported public entrypoint is a Dockerized Warden container, not ad hoc per-service startup.

## Setup Apply

- Browser-facing setup data is the masked minimal profile.
- Warden normalizes imported setup payloads in [core/setupProfile.mjs](../../../services/warden/core/setupProfile.mjs).
- Applying setup persists the profile, persists runtime overrides, and then restarts the ecosystem once.

## Normal Restore

- Warden prefers the canonical setup snapshot under `wardenm/noona-settings.json`.
- It also considers persisted runtime service config when rebuilding the stack state.
- Restore chooses the managed-service set from the saved profile instead of expecting Moon to recompute the stack
  client-side.

## Factory Reset

- Reset clears persisted setup snapshots and local runtime override snapshots before the ecosystem comes back.
- Any reset-related behavior change must update [../../../ServerAdmin.md](../../../ServerAdmin.md).
