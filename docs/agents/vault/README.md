# Vault AI Notes

Vault is Noona's internal auth, user, secret, and packet-storage broker. Most edits land in one of four areas:
service-token auth, service policy rules, user management, or the Mongo/Redis packet bridge.

## Start Here

- [files-and-rules.md](files-and-rules.md)
- [flows.md](flows.md)
- [auth-and-data-models.md](auth-and-data-models.md)
- [App builder](../../../services/vault/app/createVaultApp.mjs)
- [Public README](../../../services/vault/readme.md)
- [Tests](../../../services/vault/tests/)

## Service Shape

- Boot starts in [initVault.mjs](../../../services/vault/initVault.mjs) and hands off to
  [createVaultApp.mjs](../../../services/vault/app/createVaultApp.mjs), then
  [createVaultServer.mjs](../../../services/vault/app/createVaultServer.mjs).
- System routes in [registerSystemRoutes.mjs](../../../services/vault/routes/registerSystemRoutes.mjs) expose
  `/v1/vault/health`, `/v1/vault/debug`, and `/v1/vault/handle`.
- User routes in [registerUserRoutes.mjs](../../../services/vault/routes/registerUserRoutes.mjs) own `/api/users*`
  and are admin-service-only.
- Secret routes in [registerSecretRoutes.mjs](../../../services/vault/routes/registerSecretRoutes.mjs) own
  `/api/secrets/:path` and are gated by prefix-based service policy.
- Storage work ultimately lands in [packetParser.mjs](../../../utilities/database/packetParser.mjs) through
  [defaultHandlePacket.mjs](../../../services/vault/app/defaultHandlePacket.mjs).
- Managed installs expect Vault to serve internal HTTPS.
  When `VAULT_TLS_ENABLED=true`, missing cert or key material is a fatal startup error instead of an HTTP fallback.

## Common Task Map

- Service token parsing or Bearer auth middleware:
  [tokenAuth.mjs](../../../services/vault/auth/tokenAuth.mjs)
- Service allow-lists, admin capability, Mongo/Redis scope:
  [servicePolicy.mjs](../../../services/vault/auth/servicePolicy.mjs)
- User validation, password hashing, permission normalization:
  [userAuth.mjs](../../../services/vault/users/userAuth.mjs)
- User lookup and backward-compatible normalized username repair:
  [createUserStore.mjs](../../../services/vault/users/createUserStore.mjs)
- Secret storage semantics:
  [registerSecretRoutes.mjs](../../../services/vault/routes/registerSecretRoutes.mjs)
- Packet HTTP contract and error mapping:
  [registerSystemRoutes.mjs](../../../services/vault/routes/registerSystemRoutes.mjs)
- Shared database operation shapes:
  [packetParser.mjs](../../../utilities/database/packetParser.mjs)

## Cross-Service Impact

- [Sage](../sage/README.md) is the default admin service for Vault user and debug routes.
- [Portal](../portal/README.md), [Raven](../raven/README.md), and [Warden](../warden/README.md) depend on Vault's
  policy allow-lists staying aligned with their collection names and Redis keys.
- Warden owns the internal CA and Vault leaf certificate.
  Sage, Portal, Raven, and Warden clients are expected to trust Vault through explicit CA-path wiring instead of
  process-wide TLS disables.
- Moon-facing roles and permissions depend on Vault's canonical permission keys, even though Moon owns the UI.

## Update Triggers

- If `DEFAULT_SERVICE_POLICIES` changes, update these notes and any admin-facing docs that describe setup or roles.
- If route payloads or response shapes change, update the Vault README and route tests in the same change.
- If collection names, Redis prefixes, or secret path prefixes move, check every caller before merging because Vault
  enforces those boundaries at runtime.
- If the Vault TLS env contract or startup mode changes, update the Warden, Sage, Portal, and Raven notes in the same
  change.
