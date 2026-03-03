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
- `POST /v1/vault/handle` - generic packet dispatch to storage handlers (token protected).
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
