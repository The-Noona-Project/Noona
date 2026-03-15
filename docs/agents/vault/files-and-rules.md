# Vault Files And Rules

## Important Files

- [initVault.mjs](../../../services/vault/initVault.mjs): service entrypoint and logger/debug wiring.
- [app/createVaultApp.mjs](../../../services/vault/app/createVaultApp.mjs): Express app assembly, env defaults, route
  registration, and auth middleware creation.
- [app/createVaultServer.mjs](../../../services/vault/app/createVaultServer.mjs): HTTP vs HTTPS server selection and
  fail-closed managed TLS boot logic.
- [app/defaultHandlePacket.mjs](../../../services/vault/app/defaultHandlePacket.mjs): lazy import seam for the shared
  packet handler.
- [auth/tokenAuth.mjs](../../../services/vault/auth/tokenAuth.mjs): token-map parsing and Bearer auth middleware.
- [auth/servicePolicy.mjs](../../../services/vault/auth/servicePolicy.mjs): service-level authorization boundaries and
  default allow-lists.
- [routes/registerSystemRoutes.mjs](../../../services/vault/routes/registerSystemRoutes.mjs): health, debug, and packet
  entry routes.
- [routes/registerUserRoutes.mjs](../../../services/vault/routes/registerUserRoutes.mjs): admin-only user CRUD and
  password authentication.
- [routes/registerSecretRoutes.mjs](../../../services/vault/routes/registerSecretRoutes.mjs): prefix-gated secret
  storage routes.
- [users/createUserStore.mjs](../../../services/vault/users/createUserStore.mjs): user lookup helpers and normalized
  username repair path.
- [users/userAuth.mjs](../../../services/vault/users/userAuth.mjs): username validation, password hashing, permission
  normalization, and sanitized API output.
- [utilities/database/packetParser.mjs](../../../utilities/database/packetParser.mjs): actual Mongo/Redis operation
  execution and result shapes.
- [tests/vaultApp.test.mjs](../../../services/vault/tests/vaultApp.test.mjs): HTTP contract and policy-boundary tests.
- [tests/vaultServer.test.mjs](../../../services/vault/tests/vaultServer.test.mjs): managed TLS server boot behavior.
- [tests/userAuth.test.mjs](../../../services/vault/tests/userAuth.test.mjs): permission canonicalization coverage.

## Rules

- Preserve service-level auth boundaries unless the policy change is explicit and documented.
- Treat `req.serviceName` as the authoritative identity inside Vault. Routes do not perform end-user session checks.
- Keep `VAULT_TOKEN_MAP` parsing simple and backward-compatible. If you change its format, update tests and every
  service that constructs Vault headers.
- Keep `servicePolicy.mjs` and `packetParser.mjs` in sync. Adding an operation in one place without the other creates
  confusing runtime failures.
- Managed Vault TLS must fail closed.
  Do not add a silent HTTP fallback when `VAULT_TLS_ENABLED` is enabled, and do not weaken trust checks with global TLS
  disable flags.
- `/api/users*` and `/v1/vault/debug` are admin-service routes. Do not quietly widen access without updating docs and
  tests.
- Secret access is prefix-based, not collection-based. Path naming conventions are part of the contract.
- `usernameNormalized` is the durable lookup key for users. Preserve case-insensitive login and rename behavior.
- API responses must stay sanitized. Stored records may contain `passwordHash`, but route responses must not.
- Canonical Moon permission keys live in Vault. Legacy aliases are still accepted and normalized here.
- `defaultHandlePacket.mjs` is an intentional test seam. Keep it easy to inject a mock packet handler in tests.
- Vault is the only intended broker to managed Mongo and Redis.
  If a change would let other services talk to those stores directly, treat that as a broader architecture decision.
- User, auth, secret, or policy changes are admin-visible and should update public/admin docs when they affect
  operations.
