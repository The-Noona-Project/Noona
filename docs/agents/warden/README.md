# Warden AI Notes

Warden owns Docker orchestration, setup persistence, runtime service config, and restore behavior for the stack.

## Read In This Order

- [files-and-rules.md](files-and-rules.md)
- [boot-and-restore-flows.md](boot-and-restore-flows.md)
- [howWardenPullsDockers.md](howWardenPullsDockers.md)

## Key Files

- [initWarden.mjs](../../../services/warden/initWarden.mjs)
- [core/createWarden.mjs](../../../services/warden/core/createWarden.mjs)
- [core/registerBootApi.mjs](../../../services/warden/core/registerBootApi.mjs)
- [core/registerServiceManagementApi.mjs](../../../services/warden/core/registerServiceManagementApi.mjs)
- [core/setupProfile.mjs](../../../services/warden/core/setupProfile.mjs)
- [docker/noonaDockers.mjs](../../../services/warden/docker/noonaDockers.mjs)
- [docker/addonDockers.mjs](../../../services/warden/docker/addonDockers.mjs)
- [docker/storageLayout.mjs](../../../services/warden/docker/storageLayout.mjs)

## Change Map

- service catalog or env metadata: descriptor files
- setup snapshot or install selection logic: `core/setupProfile.mjs`
- startup, restore, auto-update, or restart behavior: `core/registerBootApi.mjs`
- service config reads or writes: `core/registerServiceManagementApi.mjs`
- storage path expectations: `docker/storageLayout.mjs`

If the change affects install, restore, storage, or admin operations,
update [../../../ServerAdmin.md](../../../ServerAdmin.md) too.
