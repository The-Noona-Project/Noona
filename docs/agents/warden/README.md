# Warden AI Notes

Warden owns Docker orchestration, setup persistence, runtime service config, startup/restore decisions, and the
control-plane HTTP API for the stack.

## Read In This Order

- [files-and-rules.md](files-and-rules.md)
  What files matter, which invariants are easy to break, and what tests cover them.
- [api-surface-and-auth.md](api-surface-and-auth.md)
  The live HTTP routes, service-token model, auth caveats, and redaction rules.
- [setup-profile-and-persistence.md](setup-profile-and-persistence.md)
  How the masked v3 setup profile is normalized, persisted, mirrored, and restored.
- [boot-and-restore-flows.md](boot-and-restore-flows.md)
  How Warden decides between minimal/full boot, restores config, and stages lifecycle startup.
- [howWardenPullsDockers.md](howWardenPullsDockers.md)
  How descriptor images become pull/update actions and when Warden recreates containers.

## Core Concepts

- Warden has a pseudo-service named `noona-warden`.
  This is not a container descriptor. It is the editable control-plane config surface for `SERVER_IP` and
  `AUTO_UPDATES`.
- Effective runtime behavior is descriptor-driven.
  Start from the descriptor, then layer persisted runtime overrides, then let Warden derive host URLs and
  managed-service defaults.
- Managed network placement is part of the security model.
  `noona-mongo` and `noona-redis` stay on `noona-data-network` only, while `noona-vault` is the only managed service
  attached to both `noona-network` and `noona-data-network`.
- The browser-facing setup contract is not raw descriptor state.
  `core/setupProfile.mjs` normalizes legacy payloads into the masked v3 profile and derives `selected` plus `values`
  internally.
- Boot selection is persistence-first, Docker-second.
  Warden prefers the saved setup snapshot when deciding what the managed lifecycle should be, then falls back to
  installed-container detection.
- Critical control-plane state is mirrored locally on disk.
  Even when Vault-backed settings are available, Warden still writes local snapshot files under `NOONA_DATA_ROOT`.
- Warden owns managed Vault TLS material.
  The internal CA and Vault leaf cert live under the shared Vault storage folder and are mounted into Vault clients
  through explicit `VAULT_CA_CERT_PATH` wiring. Missing or invalid TLS material is a boot-time failure, not an HTTP
  fallback.
- Phase 1 only hardens DB traffic.
  Existing bind mounts and Raven file APIs still own filesystem access. Do not assume Vault now brokers cross-service
  file reads or writes.

## Most Common Edit Targets

- Docker catalog or env metadata:
  [../../../services/warden/docker/noonaDockers.mjs](../../../services/warden/docker/noonaDockers.mjs),
  [../../../services/warden/docker/addonDockers.mjs](../../../services/warden/docker/addonDockers.mjs)
- HTTP route or auth behavior:
  [../../../services/warden/api/startWardenServer.mjs](../../../services/warden/api/startWardenServer.mjs),
  [../../../services/warden/api/requestAuth.mjs](../../../services/warden/api/requestAuth.mjs)
- Setup snapshot normalization:
  [../../../services/warden/core/setupProfile.mjs](../../../services/warden/core/setupProfile.mjs)
- Boot, restore, auto-update, or lifecycle staging:
  [../../../services/warden/core/registerBootApi.mjs](../../../services/warden/core/registerBootApi.mjs)
- Service config, install, restart, or factory reset:
  [../../../services/warden/core/registerServiceManagementApi.mjs](../../../services/warden/core/registerServiceManagementApi.mjs)
- Runtime storage paths and mount layout:
  [../../../services/warden/docker/storageLayout.mjs](../../../services/warden/docker/storageLayout.mjs)
- Managed Vault TLS generation and validation:
  [../../../services/warden/docker/vaultTls.mjs](../../../services/warden/docker/vaultTls.mjs)
- Managed Mongo credential generation:
  [../../../services/warden/docker/mongoCredentials.mjs](../../../services/warden/docker/mongoCredentials.mjs)
- Token persistence:
  [../../../services/warden/docker/serviceAuthRegistry.mjs](../../../services/warden/docker/serviceAuthRegistry.mjs),
  [../../../services/warden/docker/wardenApiTokens.mjs](../../../services/warden/docker/wardenApiTokens.mjs),
  [../../../services/warden/docker/vaultTokens.mjs](../../../services/warden/docker/vaultTokens.mjs)

## Cross-Service Touchpoints

- Managed Kavita provisioning uses Sage's client:
  [../../../services/sage/clients/managedKavitaSetupClient.mjs](../../../services/sage/clients/managedKavitaSetupClient.mjs)
- Moon and Sage depend on Warden's setup snapshot and config routes.
- Portal depends on Warden's service list, install progress, and service logs, but should remain read-only.

## Update Checklist

- If install, restore, storage, or lifecycle behavior changes,
  update [../../../ServerAdmin.md](../../../ServerAdmin.md).
- If a public-facing Warden capability changes,
  update [../../../services/warden/readme.md](../../../services/warden/readme.md).
- If route auth changes, check both `startWardenServer.mjs` and `requestAuth.mjs`.
- If setup or runtime persistence changes, update [setup-profile-and-persistence.md](setup-profile-and-persistence.md).
- If Docker network placement or Vault trust wiring changes,
  update [boot-and-restore-flows.md](boot-and-restore-flows.md).
