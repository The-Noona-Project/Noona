# Warden Service Guide

## 1. Role & Architecture Overview
- The Warden service is the orchestrator for the Noona stack. It bootstraps Docker containers defined in `docker/noonaDockers.mjs` and `docker/addonDockers.mjs`, exposes orchestration APIs, and coordinates install-time status tracking.
- `createWarden` (see `shared/wardenCore.mjs`) is the central factory. It:
  - Normalizes the service catalogs, combining the core and addon descriptors into a single lookup map used throughout the API.
  - Creates/obtains the Docker network (`ensureNetwork`) and binds the Warden container to it (`attachSelfToNetwork`).
  - Maintains a shared `trackedContainers` set so any container started by the API can be shut down with `shutdownAll()`.
  - Builds installation state (`installationOrder`, `installationStatuses`, and history summaries) that powers `getInstallationProgress()` and `getServiceHistory()`.
  - Persists log buffers per-service via `recordContainerOutput()` so `/api/services/:name/logs` can replay output.
- Vault token management happens in the core service descriptors: `docker/noonaDockers.mjs` generates a registry via `buildVaultTokenRegistry`/`stringifyTokenMap`. Because `createWarden` reads those descriptors at boot, updating the descriptor is sufficient for tokens to propagate to containers and history metadata.

## 2. Working with Container Descriptors
- Both `docker/noonaDockers.mjs` and `docker/addonDockers.mjs` export plain objects keyed by service name. When extending the catalog:
  1. Add (or update) an entry in the relevant `rawList` array with the desired image, ports, environment, volumes, and health information.
  2. Ensure `name` matches the canonical container name that Warden expects when resolving dependencies.
  3. For new core services, add the service name to the `rawList` in `noonaDockers.mjs` so the Vault token registry includes the service automatically.
  4. If a service needs to expose host ports, populate both `ports` (host bindings) and `exposed` (container-level definitions). If omitted, the helper in each file derives defaults from `port`/`internalPort`.
- Each descriptor exposes `env` (array of `KEY=value` strings) and `envConfig` (metadata consumed by UI/forms). Use the shared `createEnvField` helper to document environment variables:
  - `key`: environment variable name; `defaultValue`: value Warden injects if none supplied.
  - `label`/`description`: human-readable metadata for configuration UIs.
  - `warning`: highlight edge cases or risky changes.
  - `required`: mark optional overrides (`false` when safe to omit).
  - `readOnly`: mark values that should not be edited (e.g., generated service names or Vault tokens).
- When introducing new Vault-integrated services, push the token into `env` (`VAULT_API_TOKEN=…`) and mirror the generated value in `envConfig` with `readOnly: true` so downstream consumers know the token comes from the registry.

## 3. Running and Observing the Warden
- `initWarden.mjs` is the entrypoint used by `npm start`/`node initWarden.mjs`:
  - Instantiates the Warden (`createWarden()`), starts the HTTP API (`startWardenServer`), and listens on `WARDEN_API_PORT` (default `4001`).
  - Registers SIGINT/SIGTERM handlers to close the HTTP server and invoke `warden.shutdownAll()` for a clean teardown.
  - Calls `warden.init()` which ensures the Docker network exists, attaches the Warden container, and boots either the minimal or "super" stack based on `DEBUG`.
- The API exposed via `shared/wardenServer.mjs` includes:
  - `GET /health` – liveness probe for the API process.
  - `GET /api/services` – list core/addon services with install status; `?includeInstalled=false` filters out running containers.
  - `POST /api/services/install` – install one or more services; returns multi-status (`207`) when any install fails.
  - `GET /api/services/install/progress` – read installation timeline aggregated by `createWarden`.
  - `GET /api/services/:service/logs?limit=n` – retrieve buffered log history for a service.
  - `POST /api/services/:service/test` – invoke service-specific diagnostics if available.
  - `POST /api/services/noona-raven/detect` – run Kavita mount discovery (falls back to manual env overrides when null).
- Warden automatically records install and runtime events into per-service histories that the API routes above expose; leverage those when building dashboards or CLI tooling.

## 4. Testing Expectations
- Unit tests live under `services/warden/tests`. Run them with `npm test` from the `services/warden` directory (uses Node's built-in test runner).
- When modifying orchestration flows, add/adjust tests to cover new behaviors (e.g., changes to installation ordering, env metadata, or Docker utility integration). Ensure logs/history assertions remain deterministic by using the helpers in `wardenCore.test.mjs`.
