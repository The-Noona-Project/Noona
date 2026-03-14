# Warden Files And Rules

## Important Files

- [initWarden.mjs](../../../services/warden/initWarden.mjs): process bootstrap, HTTP server start, and shutdown
  handling.
- [core/createWarden.mjs](../../../services/warden/core/createWarden.mjs): main factory for catalog state, runtime
  config, logs, histories, and service helpers.
- [core/registerBootApi.mjs](../../../services/warden/core/registerBootApi.mjs): startup, restore, and auto-update
  orchestration.
- [core/registerServiceManagementApi.mjs](../../../services/warden/core/registerServiceManagementApi.mjs): service
  listing, config, install, and log routes.
- [core/setupProfile.mjs](../../../services/warden/core/setupProfile.mjs): setup-profile normalization and browser
  contract mapping.
- [docker/noonaDockers.mjs](../../../services/warden/docker/noonaDockers.mjs)
  and [docker/addonDockers.mjs](../../../services/warden/docker/addonDockers.mjs): canonical managed-service
  descriptors.
- [docker/storageLayout.mjs](../../../services/warden/docker/storageLayout.mjs): shared storage-root resolution and
  folder mapping.
- [api/requestAuth.mjs](../../../services/warden/api/requestAuth.mjs): Warden API bearer-token enforcement.

## Rules

- Warden is the source of truth for the persisted setup profile and runtime service overrides.
- Descriptor `name` values are canonical. Cross-service references should not invent alternate names.
- Storage-root logic belongs in `docker/storageLayout.mjs`; do not scatter path rules across the codebase.
- Setup snapshot compatibility matters. Old imports and fallback paths should only be broken with an explicit migration.
- Admin-facing lifecycle changes must update [../../../ServerAdmin.md](../../../ServerAdmin.md) and the
  public [readme.md](../../../services/warden/readme.md).
