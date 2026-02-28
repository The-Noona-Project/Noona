# Sage Service Guide

## Service Overview
- **Purpose:** Sage acts as Noona's setup and observability gateway. It orchestrates initial service provisioning requests, proxies observability calls, and exposes helper endpoints that front-end flows can call during onboarding.
- **Dependencies:**
  - **Warden:** Primary source for installable services, installation progress, and system logs. Sage forwards setup API calls directly to Warden's REST surface.
  - **Discord:** Used to validate guild credentials and create channels/roles required by the Portal onboarding flow via the Discord setup helper client.
  - **Raven:** Supplies library lookup, search, and download management capabilities that Sage exposes to the UI through Raven proxy endpoints.

## Project Structure

- `app/` - The Sage app factory lives here. `app/createSageApp.mjs` builds the Express server and wires the route
  registrars, while `app/createSetupClient.mjs` owns Warden discovery and install/update proxy calls.
- `routes/` - Thin HTTP handlers grouped by capability (`registerAuthRoutes`, `registerSettingsRoutes`,
  `registerSetupRoutes`, `registerRavenRoutes`). Keep them focused on translating HTTP requests into client calls.
- `clients/` - Dependency-injected downstream clients for Discord, Raven, and Vault.
- `wizard/` - Wizard state schema, storage, and publisher helpers shared between Sage and Warden.
- `lib/` - Small shared Sage utilities such as domain-specific error types.
- `tests/` - Node test suites (`*.test.mjs`) that exercise the Express app and helper clients via dependency injection.
- `README.md` - Service-level overview including Raven discovery details and environment examples.

## API Surface Breakdown (`app/createSageApp.mjs`)

Sage builds an Express app in `app/createSageApp.mjs`. The major endpoint groups and their helper clients are:

1. **Setup & Install APIs** (e.g., `/api/setup/services`, `/api/setup/install`, `/api/setup/services/:name/logs`)
    - Implemented via `app/createSetupClient.mjs`, which discovers Warden and forwards REST calls for listing services,
      kicking off installs, polling progress, fetching logs, running service self-tests, and detecting Raven mounts.
   - These endpoints normalize request bodies with `normalizeServiceInstallPayload` and translate validation errors (`SetupValidationError`) into HTTP 400 responses before reporting other failures as 502s.
2. **Discord Validation Helpers** (e.g., `/api/setup/services/noona-portal/discord/validate`, `/discord/roles`,
   `/discord/channels`)
    - Delegate to `clients/discordSetupClient.mjs`, which wraps Discord API calls for onboarding. Sage validates input,
      relays success payloads, and maps client validation errors to 400-series responses while treating network or API
      issues as 502s.
3. **Raven Proxy Endpoints** (e.g., `/api/raven/library`, `/api/raven/search`, `/api/raven/download`,
   `/api/raven/downloads/status`)
    - Rely on `clients/ravenClient.mjs`. Sage enforces lightweight input validation before invoking Raven for catalog
      retrieval, search, download queueing, and status polling.

Each helper client is plumbed into the Express app via dependency injection in `createSageApp`, allowing tests to stub network interactions.

## Tooling & Scripts
- `npm start` (or `npm run start`) executes `node initSage.mjs`, bootstrapping the production Express app with real discovery clients.
- `npm test` runs `node --test`, executing suites like `tests/sageApp.test.mjs` and `tests/wizardStateClient.test.mjs`.

## Extending Routes & Clients
1. Place new HTTP handlers in an appropriate module under `routes/`. Mirror existing conventions: accept injected clients, validate inputs, and surface domain-specific errors as 4xx while falling back to 5xx for upstream failures.
2. If a route needs a new downstream integration, extend the relevant factory or client module (
   `app/createSetupClient.mjs`, `clients/ravenClient.mjs`, or `clients/discordSetupClient.mjs`). Keep client
   construction isolated and export dependency injection hooks so tests can provide stubs.
3. Register your route within `createSageApp` by wiring it into the Express router. Ensure new handlers receive the injected clients they require and are covered by unit tests.

## Environment & Configuration

- **Warden discovery:** `createSetupClient` merges `setup.baseUrl`, `setup.baseUrls`, and multiple environment
  variables (`WARDEN_BASE_URL`, `WARDEN_INTERNAL_BASE_URL`, `WARDEN_DOCKER_URL`, `WARDEN_HOST`, `WARDEN_SERVICE_HOST`,
  `WARDEN_PORT`). It falls back to common Docker and local URLs.
- **Raven discovery:** `clients/ravenClient.mjs` accepts `raven.baseUrl`, `raven.baseUrls`, and similar environment
  overrides (`RAVEN_BASE_URL`, `RAVEN_INTERNAL_BASE_URL`, etc.).
- **Service identity:** `SERVICE_NAME` sets log prefixes; `API_PORT` overrides the default `3004` listener.
- **Common practice:** Store service-specific values in `.env` or deployment manifests, and export them before starting
  Sage.

## Troubleshooting & Testing Tips

- **Warden or Raven discovery issues:** Double-check the relevant `*_BASE_URL` variables and verify that
  `setup.baseUrls` or `raven.baseUrls` include reachable endpoints.
- **Mocking downstream services:** Unit tests rely on dependency injection. Construct `createSageApp` with stubbed
  `setupClient`, `wizardStateClient`, or `ravenClient` objects to simulate success, validation errors, or timeouts.
- **Validating proxy behavior:** Extend the existing `node --test` suites with additional cases that assert HTTP status
  codes, payload passthrough, and error translation for new routes.

## Local Testing
- Install dependencies once (`npm install` from `services/sage` if not already done).
- Start the Express app with Node: `node services/sage/initSage.mjs`.
- Use `curl` or `HTTPie` against `http://localhost:<API_PORT>` to exercise the setup, Discord, and Raven routes.
