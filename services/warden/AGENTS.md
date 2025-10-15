# Warden Service Guide

> 📚 Start here, then cross-reference the deeper operational walkthrough in [`readme.md`](./readme.md) for CLI examples and environment variable tables.

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
- The `docker/` directory groups every runtime descriptor and helper:
  - `noonaDockers.mjs` – core Noona services (Moon, Portal, Sage, Raven, Vault, etc.).
  - `addonDockers.mjs` – optional infrastructure dependencies (Redis, Mongo, supporting tooling).
  - `dockerUtilties.mjs` – shared lifecycle helpers (network binding, log streaming controls, pull/install wrappers).
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
- For interactive setup flows use `setup/setupWizard.mjs`, which inspects descriptor metadata and environment defaults to pre-populate prompts before calling the Warden API. Update both the descriptors and the wizard whenever new services or required fields are added.

## 3. Running and Observing the Warden
- `initWarden.mjs` is the entrypoint used by `npm start`/`node initWarden.mjs`:
  - Instantiates the Warden (`createWarden()`), starts the HTTP API (`startWardenServer`), and listens on `WARDEN_API_PORT` (default `4001`).
  - Registers SIGINT/SIGTERM handlers to close the HTTP server and invoke `warden.shutdownAll()` for a clean teardown.
  - Calls `warden.init()` which ensures the Docker network exists, attaches the Warden container, and boots either the minimal or "super" stack based on `DEBUG` (`false`/unset keeps to minimal, `super` launches the full catalog in dependency order).
- The API exposed via `shared/wardenServer.mjs` includes:
  - `GET /health` – liveness probe for the API process.
  - `GET /api/services` – list core/addon services with install status; `?includeInstalled=false` filters out running containers.
  - `POST /api/services/install` – install one or more services; returns multi-status (`207`) when any install fails.
  - `GET /api/services/install/progress` – read installation timeline aggregated by `createWarden`.
  - `GET /api/services/:service/logs?limit=n` – retrieve buffered log history for a service.
  - `POST /api/services/:service/test` – invoke service-specific diagnostics if available.
  - `POST /api/services/noona-raven/detect` – run Kavita mount discovery (falls back to manual env overrides when null).
- Warden automatically records install and runtime events into per-service histories that the API routes above expose; leverage those when building dashboards or CLI tooling.
- **Minimal vs. Super Modes:** Minimal mode brings up the UI, Sage, and Redis for rapid iteration while keeping background systems offline. Super mode adds Vault, Raven, Mongo, and other addons. Toggle via `DEBUG=false|super` or set an explicit `superBootOrder` override when invoking `createWarden`.
- **Key environment variables:**
  - `DEBUG` – selects launch mode and enables log streaming (`true`/`super` streams container stdout via `utilities/etc/logger.mjs`).
  - `WARDEN_API_PORT` – HTTP port for `startWardenServer` (defaults to `4001`).
  - `HOST_SERVICE_URL`/`RAVEN_VAULT_URL`/`*_VAULT_TOKEN` – documented in [`readme.md`](./readme.md); ensure descriptors reference them in `envConfig` so setup wizards prompt appropriately.
- **Debugging tips:**
  1. Hit `GET /health` and `GET /api/services` to confirm Warden is reachable and descriptors are loading.
  2. Check `deployment/` manifests when reconciling expected boot order versus infrastructure recipes.
  3. Tail per-service logs with `GET /api/services/:service/logs?limit=n` or inspect the buffered output persisted through `utilities/etc/logger.mjs`.
  4. Use `docker ps` / `docker logs <container>` to verify container-level states when API summaries look stale.
  5. Re-run `setup/setupWizard.mjs` to regenerate configuration when environment variables drift.

## 4. Testing Expectations
- Unit tests live under `services/warden/tests`. Run them with `npm test` from the `services/warden` directory (uses Node's built-in test runner).
- When modifying orchestration flows, add/adjust tests to cover new behaviors (e.g., changes to installation ordering, env metadata, or Docker utility integration). Ensure logs/history assertions remain deterministic by using the helpers in `wardenCore.test.mjs`.
- Deployment bundles that ship these behaviors live in `deployment/`; review them whenever introducing new services or environment requirements so downstream clusters remain aligned.
