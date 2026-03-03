# Vault Service Guide

## Service Purpose

- Vault exposes secure MongoDB and Redis primitives to other Noona services via the Express app created in
  `app/createVaultApp.mjs`.
- `initVault.mjs` boots the service with shared logging utilities so Vault can be run as a standalone microservice.

## Structure Overview

- `app/` - App composition and packet-handler resolution. `app/createVaultApp.mjs` is the HTTP entrypoint, and
  `app/defaultHandlePacket.mjs` resolves the shared packet dispatcher lazily.
- `auth/` - Bearer-token parsing and request authorization. `auth/tokenAuth.mjs` owns `VAULT_TOKEN_MAP` parsing and
  `req.serviceName` attachment.
- `routes/` - Focused route registrars grouped by capability: system routes, user routes, and secret routes.
- `users/` - User normalization, password hashing, permission policy, and Mongo-backed user lookup helpers.
- `utilities/database/packetParser.mjs` - Packet dispatcher and storage helpers. MongoDB operations live in
  `utilities/database/mongo/` while Redis commands resolve through `utilities/database/redis/`.

## Authentication Model
- Service-to-service authentication is configured through the `VAULT_TOKEN_MAP` environment variable (comma-separated `service:token` entries).
- `parseTokenMap()` converts that string into two lookup tables:
    - `tokensByService` for outbound logging and diagnostics.
  - `serviceByToken` for request validation inside `createRequireAuth()`.
- The `requireAuth` middleware expects a `Bearer <token>` header, attaches the resolved `serviceName` to `req`, and rejects unknown or missing tokens with HTTP 401.

## Route Breakdown

1. System routes in `routes/registerSystemRoutes.mjs`
    - `/v1/vault/health`
    - `/v1/vault/debug`
    - `/v1/vault/handle`
2. User routes in `routes/registerUserRoutes.mjs`
    - `/api/users/*`
    - Password verification and permission normalization
3. Secret routes in `routes/registerSecretRoutes.mjs`
    - `/api/secrets/:path`
    - Mongo-backed secret read, write, and delete behavior

## Packet Handler Source
- `utilities/database/packetParser.mjs` exports `handlePacket(packet)` which dispatches between MongoDB and Redis operations.
- Allowed operations are constrained by the `allowedOps` whitelist. Update this map when supporting new storage types or commands.
- All MongoDB interactions go through the shared `connectMongo()` helper; ensure new operations validate required fields
  and return consistent `{ status: 'ok', ... }` structures.
- Redis interactions use the singleton from `redisClient.mjs`; preserve JSON serialization and deserialization
  conventions when adding new commands.

## Development Workflow

1. Manual service run: `node services/vault/initVault.mjs`
2. Node test runner: from `services/vault/`, execute `npm test`
3. When adding new storage packets or authentication flows, update fixtures and mocks so both manual runs and automated
   tests continue to pass.

## Existing Tests

- `tests/vaultApp.test.mjs` verifies token parsing, middleware behavior, packet dispatch, user routes, and secret
  routes.

## Environment & Local Setup
- Required environment variables:
    - `VAULT_TOKEN_MAP` - service/token pairs for authentication
    - `MONGO_URI` - MongoDB connection string (defaults to `mongodb://noona-mongo:27017`)
    - `REDIS_HOST` / `REDIS_PORT` - Redis endpoint configuration (defaults to `noona-redis:6379`)
    - Optional: `SERVICE_NAME` to customize logging prefixes
- Ensure MongoDB and Redis services are reachable before exercising storage packets.
- Manual testing entrypoints:
    - `GET /v1/vault/health`
    - Authenticated `POST /v1/vault/handle`
    - Authenticated `/api/users/*` and `/api/secrets/:path`
