# Sage Service Guide

## Service Overview
- **Purpose:** Sage acts as Noona's setup and observability gateway. It orchestrates initial service provisioning requests, proxies observability calls, and exposes helper endpoints that front-end flows can call during onboarding.
- **Dependencies:**
  - **Warden:** Primary source for installable services, installation progress, and system logs. Sage forwards setup API calls directly to Warden's REST surface.
  - **Discord:** Used to validate guild credentials and create channels/roles required by the Portal onboarding flow via the Discord setup helper client.
  - **Raven:** Supplies library lookup, search, and download management capabilities that Sage exposes to the UI through Raven proxy endpoints.

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

## Environment & Configuration
- **Warden discovery:** `createSetupClient` merges `setup.baseUrl`, `setup.baseUrls`, and multiple environment variables (`WARDEN_BASE_URL`, `WARDEN_INTERNAL_BASE_URL`, `WARDEN_DOCKER_URL`, `WARDEN_HOST`, `WARDEN_SERVICE_HOST`, `WARDEN_PORT`). It falls back to common Docker/local URLs. Provide at least one reachable URL to ensure install endpoints work.
- **Raven discovery:** `createRavenClient` accepts `raven.baseUrl`, `raven.baseUrls`, and similar environment overrides (`RAVEN_BASE_URL`, `RAVEN_INTERNAL_BASE_URL`, etc.). Configure these when Raven is not discoverable at defaults like `http://noona-raven:8080` or localhost.
- **Service identity:** `SERVICE_NAME` sets log prefixes; `API_PORT` overrides the default `3004` listener.
- **Common practice:** Store service-specific values in `.env` or deployment manifests, and export them before starting Sage: `WARDEN_BASE_URL=https://warden.example.com API_PORT=3004 node services/sage/initSage.mjs`.

## Local Testing
- Install dependencies once (`npm install` from `services/sage` if not already done).
- Start the Express app with Node: `node services/sage/initSage.mjs`. This runs `startSage`, wiring up default clients and logging successful binds.
- Use tools such as `curl` or `HTTPie` against `http://localhost:<API_PORT>` to exercise the setup, Discord, and Raven routes. Provide mock services or adjust environment variables to point at staging instances when validating integrations.
