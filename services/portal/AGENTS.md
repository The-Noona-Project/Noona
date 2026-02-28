# Portal Service Guide

## Runtime lifecycle (`initPortal.mjs`)

1. **Configuration** - `safeLoadPortalConfig` merges process environment variables with overrides and validates required
   values before boot.
2. **Client wiring** - Kavita and Vault clients are built from config, the onboarding token store is initialized, and
   slash command handlers are assembled.
3. **Discord bootstrap** - `createDiscordClient` is created with guild metadata, command handlers, and role settings.
   `discord.login()` authenticates, clears current-app global commands, clears guild slash commands, and registers the
   current guild command list.
4. **Server start** - `startPortalServer` creates the Express app and listens on `config.port`.
5. **Shutdown path** - `stopPortal` closes HTTP, destroys Discord, and clears runtime references.

## Configuration and environment (`shared/config.mjs`)

- Required values: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `KAVITA_BASE_URL`, `KAVITA_API_KEY`,
  `VAULT_BASE_URL`, and either `VAULT_ACCESS_TOKEN` or `VAULT_API_TOKEN`.
- Optional tunables: `SERVICE_NAME`, `PORTAL_PORT`/`API_PORT`, `DISCORD_GUILD_ROLE_ID` or `DISCORD_DEFAULT_ROLE_ID`,
  `PORTAL_JOIN_DEFAULT_ROLES`, `PORTAL_JOIN_DEFAULT_LIBRARIES`, `PORTAL_REDIS_NAMESPACE`, `PORTAL_TOKEN_TTL`,
  `PORTAL_HTTP_TIMEOUT`.
- URL fields are validated and the final config object is frozen.

## Discord structure

- `shared/discordClient.mjs` is a compatibility export for `shared/discord/client.mjs`.
- `shared/discord/commandSynchronizer.mjs` performs boot sync by clearing current-app global commands, clearing guild
  slash commands, and re-registering current definitions.
- `shared/discord/interactionRouter.mjs` routes interactions and applies permission denials and fallback error replies.
- `shared/roleManager.mjs` enforces `REQUIRED_GUILD_ID` and `REQUIRED_ROLE_<COMMAND>`.

## Slash command structure

- `shared/discordCommands.mjs` is a compatibility export for `shared/commands/index.mjs`.
- `shared/commands/` holds one module per command (`ding`, `join`, `scan`, `search`) plus shared helpers in
  `shared/commands/utils.mjs`.
- Command factories receive dependencies (`discord`, `getDiscord`, `kavita`, `vault`, `onboardingStore`,
  `joinDefaults`) for
  testability.

## HTTP and persistence modules

- `shared/portalApp.mjs` exposes `/health`, `/api/portal/join-options`, `/api/portal/onboard`, and
  `/api/portal/tokens/consume`.
- `shared/onboardingStore.mjs` manages token storage and redemption.
- `shared/vaultClient.mjs` handles Vault secret read/write/delete and portal credential storage.
- `shared/kavitaClient.mjs` handles Kavita invite/update/reset-password user flows plus library and title operations.

## npm scripts

- `npm run start` - run `initPortal.mjs`.
- `npm run dev` - nodemon watch mode.
- `npm run commands:list` - inspect the current Portal Discord application's global and guild slash commands using
  Discord env vars only.
- `npm test` - Node test runner for `services/portal/tests/`.

## Testing expectations

- Keep tests aligned with command registration behavior, role gating, and onboarding contracts.
- Add tests with each behavior change; if tests are skipped, document why.
