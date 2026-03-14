# Vault Flows

## Boot And App Assembly

- [initVault.mjs](../../../services/vault/initVault.mjs) loads `.env`, wires the shared logger/debug helpers, and
  starts the server returned by [createVaultServer.mjs](../../../services/vault/app/createVaultServer.mjs).
- `createVaultApp()` parses `VAULT_TOKEN_MAP`, builds the auth middleware and policy authorizer, registers all route
  groups, and defaults to port `3005`.
- `createVaultServer.mjs` chooses HTTP or HTTPS based on `VAULT_TLS_ENABLED`.
  HTTPS requires explicit cert and key paths and does not fall back to HTTP when those files are missing.
- The packet handler is injectable for tests. Production normally uses
  [defaultHandlePacket.mjs](../../../services/vault/app/defaultHandlePacket.mjs), which lazy-loads the shared
  database bridge.
- Managed callers now expect `https://noona-vault:3005` plus an explicit CA bundle path supplied by Warden.

## Request Auth And Authorization

- Protected routes require `Authorization: Bearer <token>`.
- [tokenAuth.mjs](../../../services/vault/auth/tokenAuth.mjs) resolves that token into `req.serviceName`.
- Route handlers do not inspect a user session. They trust the calling service identity and then ask
  [servicePolicy.mjs](../../../services/vault/auth/servicePolicy.mjs) whether that service may continue.
- This means admin capability is a service-level decision, not a per-user role check inside Vault.

## Packet Flow

- `POST /v1/vault/handle` accepts a storage packet and checks it with `authorizer.canHandlePacket(...)` before it
  ever reaches the shared database layer.
- Non-admin services are restricted by collection names, Redis key prefixes, and allowed operations.
- The shared [packetParser.mjs](../../../utilities/database/packetParser.mjs) still supports broader operations such
  as `listCollections` and `wipe`, but Vault's authorizer blocks those for non-admin services.
- Returned `{error}` payloads become `400` responses on the handle route. Thrown exceptions become `500`.

## Secret Flow

- Secret routes are `GET`, `PUT`, and `DELETE /api/secrets/:path`.
- Access is prefix-based. For example, Portal can only read or write paths under `portal/` by default.
- Vault stores the full Mongo document with metadata, but `GET /api/secrets/:path` returns only the `secret` value.
- `PUT` uses an upsert and refreshes `updatedAt` and `updatedBy` while preserving `createdAt` and `createdBy`.

## User Flow

- User routes are admin-service-only and live under `/api/users`.
- `POST /api/users` validates username and password, normalizes role and permissions, hashes the password with scrypt,
  and inserts the record into the configured users collection.
- `GET /api/users` and `GET /api/users/:username` always sanitize the response so `passwordHash` never leaves Vault.
- `POST /api/users/authenticate` performs case-insensitive lookup through `usernameNormalized` and backfills that field
  for older records when needed.
- `PUT /api/users/:username` supports rename, password reset, role/permission changes, and bootstrap-flag changes in
  one route, then re-reads the user for a sanitized response.

## Where To Update Tests

- Route behavior and auth boundaries:
  [vaultApp.test.mjs](../../../services/vault/tests/vaultApp.test.mjs)
- Permission normalization and legacy alias handling:
  [userAuth.test.mjs](../../../services/vault/tests/userAuth.test.mjs)
