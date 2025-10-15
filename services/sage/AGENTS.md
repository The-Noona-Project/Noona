# Sage Service Guide

## Service Overview
- **Purpose:** Sage acts as Noona's setup and observability gateway. It orchestrates initial service provisioning requests, proxies observability calls, and exposes helper endpoints that front-end flows can call during onboarding.
- **Dependencies:**
  - **Warden:** Primary source for installable services, installation progress, and system logs. Sage forwards setup API calls directly to Warden's REST surface.
  - **Discord:** Used to validate guild credentials and create channels/roles required by the Portal onboarding flow via the Discord setup helper client.
  - **Raven:** Supplies library lookup, search, and download management capabilities that Sage exposes to the UI through Raven proxy endpoints.

## Project Structure
- `shared/` – Core Express wiring such as `shared/sageApp.mjs`, service discovery helpers, and dependency-injected clients. Update these modules when you need new downstream integrations or shared middleware.
- `routes/` – Thin HTTP handlers grouped by capability (setup, Discord helpers, Raven proxy). Each module registers with the shared Express app builder and should remain focused on translating HTTP requests into client calls.
- `tests/` – Node test suites (`*.test.mjs`) that exercise the Express app and helper clients via dependency injection. Follow the existing patterns when adding coverage for new routes or clients.
- `README.md` – Service-level overview including Raven discovery details and environment examples. Reference it when configuring local development or clarifying integration behavior.

## API Surface Breakdown (`shared/sageApp.mjs`)
Sage builds an Express app in `shared/sageApp.mjs`. The major endpoint groups and their helper clients are:

1. **Setup & Install APIs** (e.g., `/api/setup/services`, `/api/setup/install`, `/api/setup/services/:name/logs`):
   - Implemented via the local `createSetupClient`, which discovers Warden and forwards REST calls for listing services, kicking off installs, polling progress, fetching logs, running service self-tests, and detecting Raven mounts.
   - These endpoints normalize request bodies with `normalizeServiceInstallPayload` and translate validation errors (`SetupValidationError`) into HTTP 400 responses before reporting other failures as 502s.

2. **Discord Validation Helpers** (e.g., `/api/setup/services/noona-portal/discord/validate`, `/discord/roles`, `/discord/channels`):
   - Delegate to `createDiscordSetupClient`, which wraps Discord API calls for onboarding. Sage simply validates input, relays success payloads, and maps client validation errors to 400-series responses while treating network/API issues as 502s.

3. **Raven Proxy Endpoints** (e.g., `/api/raven/library`, `/api/raven/search`, `/api/raven/download`, `/api/raven/downloads/status`):
   - Rely on the shared `createRavenClient` wrapper. Sage enforces lightweight input validation (such as requiring `query`, `searchId`, or numeric `optionIndex`) before invoking Raven for catalog retrieval, search, download queueing, and status polling.

Each helper client is plumbed into the Express app via dependency injection in `createSageApp`, allowing tests to stub network interactions.

## Tooling & Scripts
- `npm start` (or `npm run start`) executes `node initSage.mjs`, bootstrapping the production Express app with real discovery clients.
- `npm test` runs `node --test`, executing suites like `tests/sageApp.test.mjs` and `tests/wizardStateClient.test.mjs`. These suites stub downstream clients to confirm that Sage proxies requests, translates validation errors, and updates wizard state as expected.

## Extending Routes & Clients
1. Place new HTTP handlers in an appropriate module under `routes/`. Mirror existing conventions: accept injected clients, validate inputs, and surface domain-specific errors as 4xx while falling back to 5xx for upstream failures.
2. If a route needs a new downstream integration, extend the relevant factory in `shared/sageApp.mjs` (e.g., `createSetupClient`, `createRavenClient`, or `createDiscordSetupClient`). Keep client construction isolated and export dependency injection hooks so tests can provide stubs.
3. Register your route within `createSageApp` by wiring it into the Express router. Ensure new handlers receive the injected clients they require and are covered by unit tests.

## Environment & Configuration
- **Warden discovery:** `createSetupClient` merges `setup.baseUrl`, `setup.baseUrls`, and multiple environment variables (`WARDEN_BASE_URL`, `WARDEN_INTERNAL_BASE_URL`, `WARDEN_DOCKER_URL`, `WARDEN_HOST`, `WARDEN_SERVICE_HOST`, `WARDEN_PORT`). It falls back to common Docker/local URLs. Provide at least one reachable URL to ensure install endpoints work.
- **Raven discovery:** `createRavenClient` accepts `raven.baseUrl`, `raven.baseUrls`, and similar environment overrides (`RAVEN_BASE_URL`, `RAVEN_INTERNAL_BASE_URL`, etc.). Configure these when Raven is not discoverable at defaults like `http://noona-raven:8080` or localhost.
- **Service identity:** `SERVICE_NAME` sets log prefixes; `API_PORT` overrides the default `3004` listener.
- **Common practice:** Store service-specific values in `.env` or deployment manifests, and export them before starting Sage: `WARDEN_BASE_URL=https://warden.example.com API_PORT=3004 node services/sage/initSage.mjs`.

## Troubleshooting & Testing Tips
- **Warden/Raven discovery issues:** Double-check the relevant `*_BASE_URL` variables (e.g., `RAVEN_BASE_URL`, `WARDEN_BASE_URL`) and verify that `setup.baseUrls`/`raven.baseUrls` include reachable endpoints. When running locally, set these to `http://localhost:<port>` before starting Sage.
- **Mocking downstream services:** Unit tests rely on dependency injection—construct `createSageApp` with stubbed `setupClient`, `wizardStateClient`, or `ravenClient` objects to simulate success, validation errors, or timeouts. Use this approach to reproduce edge cases without needing live Warden or Raven instances.
- **Validating proxy behavior:** Extend the existing `node --test` suites with additional cases that assert HTTP status codes, payload passthrough, and error translation for your new routes. Mimic network failures by having stubs throw errors or return diagnostic payloads, then ensure the handler surfaces them correctly.

## Local Testing
- Install dependencies once (`npm install` from `services/sage` if not already done).
- Start the Express app with Node: `node services/sage/initSage.mjs`. This runs `startSage`, wiring up default clients and logging successful binds.
- Use tools such as `curl` or `HTTPie` against `http://localhost:<API_PORT>` to exercise the setup, Discord, and Raven routes. Provide mock services or adjust environment variables to point at staging instances when validating integrations.
