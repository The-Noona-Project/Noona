# Vault Service Guide

## Service Purpose
- Vault exposes secure MongoDB and Redis primitives to other Noona services via the Express app created in `shared/vaultApp.mjs`.
- `initVault.mjs` boots the service with shared logging utilities so Vault can be run as a standalone microservice.

## Structure Overview
- `shared/vaultApp.mjs` – builds the Express application, wires middleware, and resolves the packet handler. Treat this as the HTTP surface area.
- `shared/requireAuth` – provides the bearer-token middleware that parses `VAULT_TOKEN_MAP`, validates callers, and attaches `req.serviceName`.
- `utilities/database/packetParser.mjs` – exports the packet dispatcher and storage helpers. MongoDB operations live in `utilities/database/mongo/` while Redis commands resolve through `utilities/database/redis/`.

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
- Extending `allowedOps`: add a new entry that maps the packet `op` string to the async function implementing the behavior, keep naming consistent with existing handlers, and document new ops in this file (Packet Handler Source section) plus `docs/` if necessary. Ensure related unit tests cover both happy-path and error scenarios for the new operation.

## Development Workflow
1. Manual service run: `node services/vault/initVault.mjs` (loads `.env` automatically) for exercising endpoints against local Mongo/Redis instances.
2. Node test runner: from repository root, execute `npm test` to run the existing `tests/vaultApp.test.mjs` suite.
3. When adding new storage packets or authentication flows, update fixtures/mocks as needed so both manual runs and automated tests continue to pass.

## Existing Tests
- `tests/vaultApp.test.mjs` verifies the Express app boots with the correct middleware, enforces authentication, and routes packets to `handlePacket` while honoring success and error responses. Extend this file with new test cases whenever `handlePacket`, packet dispatching, or authentication logic changes.

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

