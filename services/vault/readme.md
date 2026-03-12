# Vault (Noona Stack 2.2)

Vault is the shared data and authentication broker for Noona services. It validates caller tokens, routes packet
operations to storage adapters, and exposes APIs for users, secrets, and runtime debug control.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Entrypoint](initVault.mjs)
- [App builder](app/createVaultApp.mjs)
- [Auth helpers](auth/tokenAuth.mjs)
- [Route modules](routes/)
- [User helpers](users/)
- [Packet dispatcher](../../utilities/database/packetParser.mjs)
- [Mongo helpers](../../utilities/database/mongo/)
- [Redis helpers](../../utilities/database/redis/)
- [Tests](tests/vaultApp.test.mjs)

## Primary Route Groups

- `GET /v1/vault/health` - service health string.
- `GET /v1/vault/debug` and `POST /v1/vault/debug` - read/update debug mode (token protected).
- `POST /v1/vault/handle` - generic packet dispatch to storage handlers (token protected). Thrown packet-handler
  failures are converted into JSON `500` responses instead of bubbling out as opaque Express errors. Redis packet
  support includes key operations (`set`, `get`, `del`, `wipe`) plus list queue operations (`rpush`, `lpop`).
- `GET /api/users`, `GET /api/users/:username`, `POST /api/users`, `PUT /api/users/:username`,
  `DELETE /api/users/:username` - user management APIs (token protected).
- `POST /api/users/authenticate` - username/password auth check (token protected).
- `GET /api/secrets/:path`, `PUT /api/secrets/:path`, `DELETE /api/secrets/:path` - secret read/write/delete (token
  protected).

## Authentication

- Protected routes require `Authorization: Bearer <token>`.
- Tokens are loaded from `VAULT_TOKEN_MAP` (`service:token,service:token` format).
- `app/createVaultApp.mjs` wires the token registry, and `auth/tokenAuth.mjs` attaches `req.serviceName` for authorized
  callers.
- Vault now also enforces per-service authorization in `auth/servicePolicy.mjs`. In the managed stack:
  `noona-sage` has admin access, `noona-portal` is limited to `portal/*` secrets plus its recommendation/subscription
  collections and Discord-DM Redis keys, `noona-raven` is limited to Raven collections/current-task Redis state, and
  `noona-warden` is limited to `noona_settings` plus wizard-state Redis keys.

## Permission Model

- Vault user records now normalize Moon's legacy Raven permissions into the canonical `library_management` and
  `download_management` keys.
- The user APIs still accept legacy inputs (`lookup_new_title`, `download_new_title`,
  `check_download_missing_titles`) so older callers can write users/defaults without breaking.
- User routes and debug/admin packet operations are now Sage-only capabilities; non-admin service identities receive
  `403` responses before the packet handler runs.

## Environment Variables

| Variable                   | Purpose                                          | Default                        |
|----------------------------|--------------------------------------------------|--------------------------------|
| `PORT`                     | HTTP listen port                                 | `3005`                         |
| `VAULT_TOKEN_MAP`          | Service token registry                           | none                           |
| `VAULT_SECRETS_COLLECTION` | Mongo collection for secret documents            | `vault_secrets`                |
| `VAULT_USERS_COLLECTION`   | Mongo collection for user records                | `noona_users`                  |
| `MONGO_URI`                | MongoDB connection URI (used by packet handlers) | `mongodb://noona-mongo:27017`  |
| `REDIS_HOST`               | Redis host (used by packet handlers)             | `noona-redis`                  |
| `REDIS_PORT`               | Redis port                                       | `6379`                         |
| `NOONA_LOG_DIR`            | Optional directory for Vault's `latest.log`      | Warden mounts `/var/log/noona` |

## Local Commands
```bash
cd services/vault
npm install
node initVault.mjs
npm test
```

## Documentation Rule

When you add or change Vault route contracts, packet operations, auth behavior, or collection defaults, update this
README and link the exact code paths touched so service integrations stay traceable.
