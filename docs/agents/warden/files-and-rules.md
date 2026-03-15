# Warden Files And Rules

## Important Files

## Entrypoint And Server

- [../../../services/warden/initWarden.mjs](../../../services/warden/initWarden.mjs)
  Bootstraps the Warden instance, starts the HTTP server, and owns fatal-error shutdown handling.
- [../../../services/warden/api/startWardenServer.mjs](../../../services/warden/api/startWardenServer.mjs)
  Live HTTP route implementation, request-size/timeouts, token auth, and response redaction.
- [../../../services/warden/api/requestAuth.mjs](../../../services/warden/api/requestAuth.mjs)
  More explicit permission mapping for Warden API requests. Keep it aligned with `startWardenServer.mjs` if auth rules
  change.

## Lifecycle And Service Management

- [../../../services/warden/core/createWarden.mjs](../../../services/warden/core/createWarden.mjs)
  Main factory. Defines boot order, runtime state, storage roots, snapshot paths, token stores, and the API context.
- [../../../services/warden/core/registerBootApi.mjs](../../../services/warden/core/registerBootApi.mjs)
  Minimal/full boot, restore staging, startup auto-updates, and ecosystem start logic.
- [../../../services/warden/core/registerServiceManagementApi.mjs](../../../services/warden/core/registerServiceManagementApi.mjs)
  Install, config, restart, stop, factory reset, managed Kavita provisioning, and service history access.
- [../../../services/warden/core/registerDiagnosticsApi.mjs](../../../services/warden/core/registerDiagnosticsApi.mjs)
  Update snapshots, image refreshes, and Raven/Kavita detection helpers.
- [../../../services/warden/core/wardenErrors.mjs](../../../services/warden/core/wardenErrors.mjs)
  Typed HTTP-safe errors used by the server layer.

## Setup And Persistence

- [../../../services/warden/core/setupProfile.mjs](../../../services/warden/core/setupProfile.mjs)
  Normalizes legacy setup payloads to the v3 public profile, restores masked secrets, and derives `selected` plus
  `values`.
- [../../../services/warden/docker/storageLayout.mjs](../../../services/warden/docker/storageLayout.mjs)
  Canonical `NOONA_DATA_ROOT` resolution and the expected per-service folder layout.
- [../../../services/warden/docker/vaultTls.mjs](../../../services/warden/docker/vaultTls.mjs)
  Managed Vault CA and leaf-certificate generation, validation, and reuse rules.
- [../../../services/warden/docker/mongoCredentials.mjs](../../../services/warden/docker/mongoCredentials.mjs)
  Persistent generated Mongo root credentials for managed installs.
- [../../../services/warden/docker/komfConfigTemplate.mjs](../../../services/warden/docker/komfConfigTemplate.mjs)
  Default managed Komf `application.yml` handling.

## Descriptor And Token Plumbing

- [../../../services/warden/docker/noonaDockers.mjs](../../../services/warden/docker/noonaDockers.mjs)
  Core Noona service descriptors.
- [../../../services/warden/docker/addonDockers.mjs](../../../services/warden/docker/addonDockers.mjs)
  Optional/addon and managed helper descriptors.
- [../../../services/warden/docker/dockerUtilties.mjs](../../../services/warden/docker/dockerUtilties.mjs)
  Dockerode operations, network attach, pull progress, and bind-mount preparation.
- [../../../services/warden/docker/imageRegistry.mjs](../../../services/warden/docker/imageRegistry.mjs)
  Managed registry/namespace/tag resolution.
- [../../../services/warden/docker/serviceAuthRegistry.mjs](../../../services/warden/docker/serviceAuthRegistry.mjs)
  Shared persistent token store implementation.
- [../../../services/warden/docker/wardenApiTokens.mjs](../../../services/warden/docker/wardenApiTokens.mjs)
  Warden API caller token namespace.
- [../../../services/warden/docker/vaultTokens.mjs](../../../services/warden/docker/vaultTokens.mjs)
  Vault token namespace.
- [../../../services/warden/docker/hostServiceUrl.mjs](../../../services/warden/docker/hostServiceUrl.mjs)
  Host URL resolution based on `HOST_SERVICE_URL` / `SERVER_IP`.

## Rules

## Service Identity And Descriptor Rules

- Canonical service names are the descriptor names such as `noona-moon` and `noona-kavita`.
  Do not invent alternate names in snapshots, runtime config, or route logic.
- Always start from `buildEffectiveServiceDescriptor*` when you need the real runtime descriptor.
  That is where runtime overrides, host-port rewrites, `SERVER_IP`, Moon URL behavior, and managed Kavita defaults are
  applied.
- `noona-warden` is a pseudo-service config target, not a normal Docker descriptor.
  Its editable fields are `SERVER_IP` and `AUTO_UPDATES`.

## Persistence Rules

- The setup snapshot is the source of truth for the persisted install selection and user-facing setup choices.
- Runtime overrides are persisted separately from the setup snapshot.
  Warden writes them to the settings store when available and also mirrors them to the local runtime snapshot file.
- Do not bypass the snapshot helpers in `createWarden.mjs` and `setupProfile.mjs`.
  The path mirroring and legacy-compatibility behavior is intentional.

## Security And Redaction Rules

- Sensitive values must be redacted as `********` in browser-adjacent responses.
- Masked values are not "empty"; they mean "preserve the existing secret" during snapshot or service-config updates.
- Portal must stay read-only against the Warden API.
  If route permissions change, keep `startWardenServer.mjs` and `requestAuth.mjs` aligned.
- Managed Mongo and Redis are internal-only services.
  Do not re-add host port publishing or attach non-Vault services to `noona-data-network` without an explicit design
  change.
- Portal's managed runtime namespaces `PORTAL_REDIS_NAMESPACE` and `PORTAL_DM_QUEUE_NAMESPACE` should stay under
  `portal:` so Vault policy continues to authorize them.
- Managed Vault TLS is fail-closed.
  Clients should trust the CA through explicit `VAULT_CA_CERT_PATH` wiring instead of global TLS disables or silent HTTP
  fallback.
- Phase 1 did not change filesystem brokering.
  Keep existing bind-mount and Raven file-access behavior unless the change also updates the broader Vault/file design.

## Lifecycle Rules

- Minimal mode is only `noona-sage` and `noona-moon`.
- Full lifecycle always includes the required core data services: `noona-mongo`, `noona-redis`, and `noona-vault`.
- Docker health is the readiness contract for managed Mongo and Redis.
  Warden should not need direct HTTP probes into the private data network just to decide whether boot can continue.
- Use `orderServicesForLifecycle`, `resolveInstallOrder`, and the dependency graph instead of adding ad hoc startup
  sorting.
- Factory reset is intentionally destructive and must clear persisted boot state, not just stop containers.

## Test Map

- [../../../services/warden/tests/wardenCore.test.mjs](../../../services/warden/tests/wardenCore.test.mjs)
  Largest coverage surface for startup, runtime config, and lifecycle behavior.
- [../../../services/warden/tests/wardenServer.test.mjs](../../../services/warden/tests/wardenServer.test.mjs)
  HTTP server routes, auth, and response behavior.
- [../../../services/warden/tests/setupProfile.test.mjs](../../../services/warden/tests/setupProfile.test.mjs)
  Setup profile normalization and secret masking rules.
- [../../../services/warden/tests/setupLifecycle.test.mjs](../../../services/warden/tests/setupLifecycle.test.mjs)
  Setup apply/restore/reset behavior.
- [../../../services/warden/tests/dockerUtilities.test.mjs](../../../services/warden/tests/dockerUtilities.test.mjs)
  Docker helper behavior.
- [../../../services/warden/tests/vaultTokens.test.mjs](../../../services/warden/tests/vaultTokens.test.mjs)
  Token registry and descriptor token exposure.
- [../../../services/warden/tests/mongoCredentials.test.mjs](../../../services/warden/tests/mongoCredentials.test.mjs)
  Managed Mongo credential persistence and override precedence.
- [../../../services/warden/tests/vaultTls.test.mjs](../../../services/warden/tests/vaultTls.test.mjs)
  Managed Vault TLS path and asset generation behavior.
- [../../../services/warden/tests/securityHardening.test.mjs](../../../services/warden/tests/securityHardening.test.mjs)
  Runtime network placement and internal-only data-service expectations.
