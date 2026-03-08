# Portal Service Guide

## Runtime lifecycle (`app/portalRuntime.mjs`)

1. **Configuration** - `safeLoadPortalConfig` merges process environment variables with overrides and validates required
   values before boot.
2. **Client wiring** - Kavita and Vault clients are built from config, and the onboarding token store is initialized.
3. **Discord bootstrap (conditional)** - when all Discord env vars are present, `createDiscordClient` is created with
   guild metadata, command handlers, and role settings. `discord.login()` authenticates, clears current-app global
   commands, clears guild slash commands, and registers the current guild command list.
4. **Server start** - `startPortalServer` creates the Express app and listens on `config.port`.
5. **Shutdown path** - `stopPortal` closes HTTP, destroys Discord, and clears runtime references.

## Configuration and environment (`config/portalConfig.mjs`)

- Required values: `KAVITA_API_KEY`, `VAULT_BASE_URL`, and either `VAULT_ACCESS_TOKEN` or `VAULT_API_TOKEN`.
- Optional Discord values (all-or-none): `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`.
- Optional tunables: `SERVICE_NAME`, `PORTAL_PORT`/`API_PORT`, `DISCORD_GUILD_ROLE_ID` or `DISCORD_DEFAULT_ROLE_ID`,
  `PORTAL_JOIN_DEFAULT_ROLES`, `PORTAL_JOIN_DEFAULT_LIBRARIES`, `PORTAL_REDIS_NAMESPACE`, `PORTAL_TOKEN_TTL`,
  `PORTAL_HTTP_TIMEOUT`.
- URL fields are validated and the final config object is frozen.

## Discord structure

- `discord/client.mjs` wires Discord login, interaction handling, and role assignment.
- `discord/commandSynchronizer.mjs` performs boot sync by clearing current-app global commands, clearing guild
  slash commands, and re-registering current definitions.
- `discord/interactionRouter.mjs` routes interactions and applies permission denials and fallback error replies.
- `discord/roleManager.mjs` enforces `REQUIRED_GUILD_ID` and `REQUIRED_ROLE_<COMMAND>`.

## Slash command structure

- `commands/` holds one module per command (`ding`, `join`, `scan`, `search`, `recommend`) plus shared helpers in
  `commands/utils.mjs`.
- Command factories receive dependencies (`discord`, `getDiscord`, `kavita`, `vault`, `onboardingStore`,
  `joinDefaults`) for
  testability.
- When adding a new slash command, update Moon's Portal settings command-permission fields and setup-wizard role-field
  list in the same change so the new `REQUIRED_ROLE_<COMMAND>` override is editable in the UI.

## HTTP and persistence modules

- `app/createPortalApp.mjs` assembles the Express app and server wrapper.
- `routes/registerPortalRoutes.mjs` exposes `/health`, the `/api/portal/kavita/*` bridge routes,
  `/api/portal/join-options`,
  `/api/portal/onboard`, and `/api/portal/tokens/consume`.
- `storage/onboardingStore.mjs` manages token storage and redemption.
- `clients/vaultClient.mjs` handles Vault secret read/write/delete and portal credential storage.
- `clients/kavitaClient.mjs` handles Kavita invite/update/reset-password user flows plus library and title operations.

## npm scripts

- `npm run start` - run `initPortal.mjs`.
- `npm run dev` - nodemon watch mode.
- `npm run commands:list` - inspect the current Portal Discord application's global and guild slash commands using
  Discord env vars only.
- `npm test` - Node test runner for `services/portal/tests/`.

## Testing expectations

- Keep tests aligned with command registration behavior, role gating, and onboarding contracts.
- Add tests with each behavior change; if tests are skipped, document why.
