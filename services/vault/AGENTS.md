# Vault Service Guide

## Service Purpose
- Vault exposes secure MongoDB and Redis primitives to other Noona services via the Express app created in `shared/vaultApp.mjs`.
- `initVault.mjs` boots the service with shared logging utilities so Vault can be run as a standalone microservice.

## Authentication Model
- Service-to-service authentication is configured through the `VAULT_TOKEN_MAP` environment variable (comma-separated `service:token` entries).
- `parseTokenMap()` converts that string into two lookup tables:
  - `tokensByService` for outbound logging/diagnostics.
  - `serviceByToken` for request validation inside `createRequireAuth()`.
- The `requireAuth` middleware expects a `Bearer <token>` header, attaches the resolved `serviceName` to `req`, and rejects unknown or missing tokens with HTTP 401.

## `/v1/vault/handle` Flow
1. Requests must include a valid bearer token that maps to a known service.
2. The JSON body is treated as the "packet" payload.
3. `handlePacket` is resolved from the options passed to `createVaultApp()`; if omitted it is loaded lazily from `utilities/database/packetParser.mjs` via dynamic `import()`.
4. The handler executes the storage operation and returns a result object. Any `{ error: ... }` response triggers an HTTP 400; otherwise the JSON payload is streamed back with status 200. Undefined results default to an empty object.

## Packet Handler Source
- `utilities/database/packetParser.mjs` exports `handlePacket(packet)` which dispatches between MongoDB and Redis operations.
- Allowed operations are constrained by the `allowedOps` whitelist. Update this map when supporting new storage types or commands.
- All MongoDB interactions go through the shared `connectMongo()` helper; ensure new operations validate required fields (e.g., `collection`, `query`) and return consistent `{ status: 'ok', ... }` structures.
- Redis interactions use the singleton from `redisClient.mjs`; preserve JSON serialization/deserialization conventions when adding new commands.
- Wrap additional storage logic with error handling that returns user-friendly `{ error: '...' }` messages and logs via the shared logger utilities.

## Environment & Local Setup
- Required environment variables:
  - `VAULT_TOKEN_MAP` – service/token pairs for authentication.
  - `MONGO_URI` – MongoDB connection string (defaults to `mongodb://noona-mongo:27017`).
  - `REDIS_HOST` / `REDIS_PORT` – Redis endpoint configuration (defaults to `noona-redis:6379`).
  - Optional: `SERVICE_NAME` to customize logging prefixes.
- Ensure MongoDB and Redis services are reachable before exercising storage packets.
- To run Vault locally: `node services/vault/initVault.mjs` (dotenv loads `.env` values automatically).
- To run the service tests (requires mocked or test-friendly storage adapters):
  - From `services/vault/`: `npm test` (executes Node's built-in test runner against `tests/vaultApp.test.mjs`).
- When manually testing packet handling, you can curl the health check (`GET /v1/vault/health`) and send authenticated POSTs to `/v1/vault/handle` with JSON bodies matching the packet schema.

