# Portal (Noona Stack 2.2)

Portal coordinates Discord onboarding with Kavita and Vault. It exposes HTTP onboarding routes and Discord slash
commands that provision users, store onboarding tokens, and assign default roles.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Entrypoint](initPortal.mjs)
- [Runtime config loader](shared/config.mjs)
- [HTTP app](shared/portalApp.mjs)
- [Discord client compatibility export](shared/discordClient.mjs)
- [Discord runtime modules](shared/discord/)
- [Discord client implementation](shared/discord/client.mjs)
- [Discord command inspector](shared/discord/commandInspector.mjs)
- [Slash commands compatibility export](shared/discordCommands.mjs)
- [Slash command modules](shared/commands/)
- [Command listing script](scripts/listCommands.mjs)
- [Onboarding token store](shared/onboardingStore.mjs)
- [Kavita client](shared/kavitaClient.mjs)
- [Vault client](shared/vaultClient.mjs)
- [Tests](tests/)

## Core Responsibilities

- Validate runtime config for Discord, Kavita, Vault, and Redis-backed onboarding tokens.
- Handle onboarding over HTTP (`/api/portal/*`).
- Register and execute Discord slash commands for join/scan/search workflows.
- Persist portal credentials in Vault and assign Discord roles when configured.

## HTTP Endpoints

- `GET /health` - process health and guild metadata.
- `POST /api/portal/onboard` - create/update user onboarding and issue one-time token.
- `POST /api/portal/tokens/consume` - redeem an onboarding token.

## Slash Commands

- `/ding` - health check response.
- `/join` - onboarding flow with Kavita + token storage + optional Vault write.
- `/scan` - list available Kavita libraries.
- `/search` - lookup user details from Kavita and Vault.
- Boot behavior: on Discord login, Portal clears current-app global commands, clears the guild command list, then
  re-registers all current slash command definitions for the configured guild.

## Key Environment Variables

| Variable                                                              | Purpose                           |
|-----------------------------------------------------------------------|-----------------------------------|
| `PORTAL_PORT` or `API_PORT`                                           | HTTP listen port (default `3003`) |
| `DISCORD_BOT_TOKEN`                                                   | Discord bot token                 |
| `DISCORD_CLIENT_ID`                                                   | Discord application client id     |
| `DISCORD_GUILD_ID`                                                    | Guild scope for slash commands    |
| `DISCORD_GUILD_ROLE_ID` / `DISCORD_DEFAULT_ROLE_ID`                   | Default role assignment target    |
| `KAVITA_BASE_URL` / `KAVITA_API_KEY`                                  | Kavita API connection             |
| `VAULT_BASE_URL` / `VAULT_ACCESS_TOKEN` (`VAULT_API_TOKEN` supported) | Vault API connection              |
| `PORTAL_REDIS_NAMESPACE` / `PORTAL_TOKEN_TTL`                         | Token storage namespace and TTL   |
| `PORTAL_HTTP_TIMEOUT`                                                 | Upstream request timeout in ms    |

## Local Commands

```bash
cd services/portal
npm install
npm run start
npm run dev
npm run commands:list
npm test
```

`npm run commands:list` inspects the current Portal Discord application and prints global commands, guild commands, and
duplicate names across both scopes. Add `-- --json` to emit machine-readable output.

## Documentation Rule

When command definitions, onboarding payloads, or endpoint contracts change, update this README and include markdown
links to the exact files updated so downstream services can follow the flow quickly.
