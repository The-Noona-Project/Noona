# Vault Auth And Data Models

## Service Token Contract

- Vault authenticates other services through `VAULT_TOKEN_MAP`.
- The format is a comma-separated list of `service:token` pairs, for example
  `noona-sage:abc,noona-portal:def`.
- [parseTokenMap()](../../../services/vault/auth/tokenAuth.mjs) builds both `tokensByService` and
  `serviceByToken`. Duplicate tokens or duplicate service names are not rejected, so later entries effectively win.
- If the token map is empty, Vault still boots, but every protected route will reject requests.

## Default Service Policies

- `noona-sage`
    - `admin: true`
    - Can reach debug routes, user routes, and unrestricted packet/secret operations.
- `noona-portal`
    - Secret prefixes: `portal/`
    - Mongo collections: `portal_recommendations`, `portal_subscriptions`
    - Redis prefixes: `portal:discord:dm:`
- `noona-raven`
    - Mongo collections: `manga_library`, `raven_download_tasks`, `noona_settings`
    - Redis prefixes: `raven:download:current-task`
- `noona-warden`
    - Mongo collections: `noona_settings`
    - Redis prefixes: `noona:wizard:state`

## Packet Operation Contract

- Supported Mongo operations in the shared handler:
  `insert`, `find`, `findMany`, `update`, `delete`, `listCollections`, `wipe`
- Supported Redis operations in the shared handler:
  `set`, `get`, `del`, `rpush`, `lpop`, `wipe`
- Vault's authorizer narrows that broader set per service.
- When adding a new operation, update both
  [servicePolicy.mjs](../../../services/vault/auth/servicePolicy.mjs) and
  [packetParser.mjs](../../../utilities/database/packetParser.mjs), then extend tests.

## User Record Shape

- Stored user records are expected to carry:
  `username`, `usernameNormalized`, `passwordHash`, `role`, `permissions`, `isBootstrapUser`, `createdAt`,
  `updatedAt`, `createdBy`, and `updatedBy`.
- `usernameNormalized` is the durable lookup key. It is lowercased and used to keep login and rename flows
  case-insensitive.
- [sanitizeUser()](../../../services/vault/users/userAuth.mjs) is the boundary between stored data and API output.
  It removes `passwordHash`, normalizes permissions, and derives the effective role.

## Permission Model

- Canonical permission keys are:
  `moon_login`, `library_management`, `download_management`, `user_management`, `admin`
- Legacy Moon keys such as `lookup_new_title`, `download_new_title`, and `check_download_missing_titles` still map
  into the canonical set.
- Member defaults are `moon_login`, `library_management`, and `download_management`.
- Admin users always end up with the `admin` permission after sanitization, even if the incoming payload is messy.

## Secret Record Shape

- Secret records live in the configured secrets collection and normally store:
  `path`, `secret`, `createdAt`, `createdBy`, `updatedAt`, and `updatedBy`
- The `secret` value can be an object or scalar. Vault does not impose a per-path schema.
- Secret access rules depend on the raw path string and allowed prefixes, so client code should keep path naming
  stable and URL-encode path segments consistently.

## Useful Editing Reminders

- Policy changes are high-impact because the enforcement is runtime-only. Breakage usually shows up as `403` from Vault,
  not as a build error.
- User and permission changes affect Moon and admin workflows, even when the Vault route contract stays the same.
- If you touch auth, policies, or packet shapes, read
  [vaultApp.test.mjs](../../../services/vault/tests/vaultApp.test.mjs) before editing so you preserve the expected
  HTTP behavior.
