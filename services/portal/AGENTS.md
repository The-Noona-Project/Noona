# Portal Service Guide

## Runtime lifecycle (`initPortal.mjs`)
1. **Configuration** – `safeLoadPortalConfig` merges process environment variables with any overrides and validates required values before the runtime starts. The resolved object is stored on the shared `runtime` singleton so teardown can reference what was loaded.
2. **Client wiring** – HTTP clients for Kavita and Vault are constructed next, using the configuration's base URLs, API credentials, and HTTP timeout. The onboarding token store is initialised with Redis namespace/TTL settings, and the Discord slash-command map is created with handles to those collaborators.
3. **Discord bootstrap** – With the command set assembled, `createDiscordClient` is invoked to prepare the bot with guild metadata, default role automation, and the slash-command definitions. `discord.login()` authenticates the bot and registers commands before the HTTP server starts.
4. **Server start** – `startPortalServer` receives the config and ready clients, exposes the Express application, and begins listening on the configured port. The resulting server instance and closer are retained on `runtime` for shutdown.
5. **Shutdown path** – `stopPortal` closes the HTTP listener (when available), destroys the Discord client, and nulls every cached runtime reference. Signal handlers (`SIGINT`/`SIGTERM`) funnel through `handleSignal`, ensuring the process exits cleanly after teardown completes.

## Configuration & environment (`shared/config.mjs`)
- The module lazily loads `.env` files via `dotenv` (path resolved from `PORTAL_ENV_FILE` or `ENV_FILE`). Overrides passed to the loader merge with `process.env`.
- Required string variables: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `KAVITA_BASE_URL`, `KAVITA_API_KEY`, `VAULT_BASE_URL`, and either `VAULT_ACCESS_TOKEN` or `VAULT_API_TOKEN`.
- Optional tunables include `SERVICE_NAME`, `PORTAL_PORT`/`API_PORT`, `DISCORD_GUILD_ROLE_ID` (or `DISCORD_DEFAULT_ROLE_ID`), `PORTAL_REDIS_NAMESPACE`, `PORTAL_TOKEN_TTL`, and `PORTAL_HTTP_TIMEOUT`.
- URLs are validated for Kavita/Vault endpoints; numeric settings default to sensible fallbacks when unset or malformed.
- Once loaded, the config is frozen and logged with the resolved guild identifier.

## Onboarding & credential storage
- `portalApp` exposes REST endpoints: `/api/portal/onboard` writes onboarding tokens and triggers Kavita/Vault/Discord flows; `/api/portal/tokens/consume` redeems stored tokens. Both routes rely on the shared onboarding store.
- `createOnboardingStore` issues UUID-backed tokens, persists them in Redis under `namespace:token`, and enforces TTL-based expiry. `setToken`, `getToken`, and `consumeToken` provide read/delete semantics with structured logging.
- `createVaultClient` wraps Vault's HTTP API, handles timeout-aware fetch calls, and surfaces helpers for reading/writing secrets. `storePortalCredential` stores member credentials under `portal/{discordId}`.

## Discord commands & permissions
- `createDiscordClient` normalises a command map, logs lifecycle events, registers slash commands on login, and mediates interactions. It defers to `roleManager.checkAccess` to enforce guild/role gating before executing handlers.
- `roleManager` honours `REQUIRED_GUILD_ID` and per-command role environment variables (`REQUIRED_ROLE_<COMMAND>` with uppercase snake-cased names) when deciding if an interaction is allowed.
- Slash commands defined in `shared/discordCommands.mjs`:
  - `/ding` responds with a simple health check.
  - `/join` orchestrates onboarding by invoking Kavita, the onboarding store, optional Vault persistence, and Discord role assignment. Errors during credential storage or role assignment are logged but do not abort the command reply.
  - `/scan` queries Kavita libraries and formats a comma-separated summary.
  - `/search` looks up Kavita users and optionally Vault-stored credentials for a given Discord ID, returning a combined report.
- Each handler uses ephemeral responses, defers replies while awaiting downstream calls, and leverages helper utilities (e.g., `ensureArray`, `respondWithError`) to normalise user input. Testing hooks include dependency injection via the factory parameters (`discord`, `getDiscord`, `kavita`, `vault`, `onboardingStore`) so mocks can be supplied during automated tests.

## Module collaboration map
- `shared/config.mjs` resolves and validates runtime settings before `initPortal.mjs` composes the service. Its frozen return value feeds every downstream constructor invoked during initialisation.
- `shared/discordClient.mjs` exports the factory that `initPortal.mjs` calls once the command map and collaborators are assembled. The resulting client instance is cached on the `runtime` object and torn down via `stopPortal`.
- `shared/discordCommands.mjs` exposes the slash-command definitions that `initPortal.mjs` injects into the Discord client factory, ensuring handlers receive the Kavita, Vault, and onboarding store dependencies created earlier in the boot sequence.
- `shared/onboardingStore.mjs` provides the Redis-backed token manager instantiated by `initPortal.mjs`. The store is passed to both HTTP route handlers and Discord commands so they share token persistence.
- `shared/vaultClient.mjs` creates the Vault HTTP adapter that `initPortal.mjs` wires into Discord command handlers and onboarding flows, enabling credential storage and retrieval.

## npm scripts
- `npm run start` – launches the production build by calling the entrypoint that invokes `initPortal.mjs`. Use this in deployed environments or when reproducing production behaviour locally.
- `npm run dev` – runs the service in watch mode with development-focused logging. Prefer this during active feature work where hot reloads and verbose diagnostics are valuable.
- `npm test` – executes the Node.js built-in test runner across the suites in `services/portal/tests/`. Run this before committing to ensure the portal integration and unit tests remain green.

## Testing expectations & coverage
- Existing suites cover configuration validation edge cases, Discord client event behaviour, command permission gating, and onboarding-store semantics. Review the tests under `services/portal/tests/` to understand fixtures and helpers before extending coverage.
- Add new tests alongside their modules in `services/portal/tests/`, mirroring the directory structure where practical. Each new feature or bug fix should include targeted tests that exercise the code paths being introduced or changed.

## Troubleshooting runtime issues
- **Discord login failures** – verify `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, and guild identifiers are present. If the client partially initialises, call `stopPortal` to release the cached Discord instance before retrying a fresh `initPortal` to avoid stale sessions.
- **Redis connectivity** – ensure the onboarding store can reach the configured host and namespace. When redis errors surface during development, trigger `stopPortal` so any lingering Redis connections or timers are cleaned up prior to restarting the service.
