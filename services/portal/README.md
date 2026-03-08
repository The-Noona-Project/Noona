# Portal (Noona Stack 2.2)

Portal coordinates Discord onboarding with Kavita and Vault. It exposes HTTP onboarding routes and Discord slash
commands that provision Kavita users, surface Kavita library/title metadata, store onboarding tokens, and assign
default Discord roles.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Entrypoint](initPortal.mjs)
- [Portal runtime](app/portalRuntime.mjs)
- [HTTP app](app/createPortalApp.mjs)
- [Portal routes](routes/registerPortalRoutes.mjs)
- [Runtime config loader](config/portalConfig.mjs)
- [Discord runtime modules](discord/)
- [Discord client](discord/client.mjs)
- [Recommendation notifier](discord/recommendationNotifier.mjs)
- [Discord command inspector](discord/commandInspector.mjs)
- [Slash command modules](commands/)
- [Recommend command](commands/recommendCommand.mjs)
- [Command listing script](scripts/listCommands.mjs)
- [Onboarding token store](storage/onboardingStore.mjs)
- [Kavita client](clients/kavitaClient.mjs)
- [Komf client](clients/komfClient.mjs)
- [Raven client](clients/ravenClient.mjs)
- [Vault client](clients/vaultClient.mjs)
- [Tests](tests/)

## Core Responsibilities

- Validate runtime config for Discord, Kavita, Vault, and Redis-backed onboarding tokens.
- Handle onboarding and Kavita option discovery over HTTP (`/api/portal/*`).
- Proxy Raven-triggered Kavita library scans so completed imports can surface in Kavita without direct bot access.
- Register and execute Discord slash commands for Kavita account creation, library scans, title search workflows, and
  Raven-backed recommendation intake.
- Poll Raven and Warden so the Discord bot presence reflects active downloads, title checks, and service updates.
- Persist portal credentials and pending recommendation documents in Vault, assign Discord roles when configured, and
  DM recommendation requesters when approvals, admin comments, and completed imports are detected.
- Queue outbound Discord DMs through Vault Redis packet APIs so per-user recommendation notifications stay in-order.

## HTTP Endpoints

- `GET /health` - process health and guild metadata.
- `GET /api/portal/kavita/info` - return the Kavita link base URL for Moon buttons, preferring `KAVITA_EXTERNAL_URL`
  when configured, plus managed-service hints.
- `GET /api/portal/kavita/title-search` - search Kavita series and return direct Kavita title URLs for Moon title pages.
- `GET /api/portal/kavita/title-cover/:titleUuid` - proxy the stored Noona cover art for a Raven title so Kavita can
  download and lock the same cover image Moon displays.
- `POST /api/portal/kavita/libraries/ensure` - idempotently create or reuse a Kavita library for Raven-managed media
  folders and merge in any missing Raven folder roots on existing libraries.
- `POST /api/portal/kavita/libraries/scan` - resolve a Kavita library by name and trigger a scan for Raven-managed
  imports.
- `POST /api/portal/kavita/title-match` - fetch Komf metadata candidates for the selected Kavita series id and Moon
  title query. Portal now queries Komf directly through `/api/kavita/metadata/search`, normalizes Komf provider/result
  ids into Moon's flat match shape, and returns compact operator-facing `500` guidance when Komf fails server-side.
- `POST /api/portal/kavita/title-match/apply` - identify the selected Komf metadata candidate against the chosen
  Kavita series through Komf `/api/kavita/metadata/identify`, then, when Moon supplies the Raven `titleUuid`,
  immediately lock Kavita to the same Noona cover art through the `title-cover` proxy route. If the Raven title record
  does not already have a stored `coverUrl`, Portal now backfills it from the selected metadata match's
  `coverImageUrl` before syncing Kavita so older Noona library entries still inherit the correct cover art. Legacy
  Kavita provider-id payloads are still accepted as a compatibility fallback.
- `GET /api/portal/kavita/users` - return Kavita users plus available Kavita roles/role descriptions for Moon's
  `/settings/users` management view.
- `PUT /api/portal/kavita/users/:username/roles` - update one Kavita user's role set while preserving their current
  email and library assignments.
- `POST /api/portal/kavita/noona-login` - create or update a Kavita account for a signed-in Noona Discord user,
  generate a fresh managed password, store the Noona-to-Kavita mapping in Vault, and mint a short-lived one-time
  login token for Kavita's Noona handoff flow. If Kavita rejects the first provisioning attempt with HTTP `400`,
  Portal now retries once with a safe fallback role set (`Pleb`, `Login`) and no library overrides so login handoff
  can still complete for existing users. Portal also always includes a `libraries` field in Kavita invite/update
  payloads (including `[]`) because newer Kavita builds reject requests that omit that field. Invite/update requests
  also always include `ageRestriction` and preserve an existing user's restriction when available. When Kavita reports
  `Username already taken`, Portal now looks up existing users and remaps the handoff to a matching existing account
  (preferring email matches), preserving that account's roles, libraries, and age restriction. Portal also persists
  the generated handoff password in Vault and reuses a stored Vault password as `oldPassword` on future updates.
- `POST /api/portal/kavita/login-tokens/consume` - redeem a short-lived one-time Kavita login token issued by the
  Noona handoff flow.
- `GET /api/portal/join-options` - list Kavita roles, role descriptions, and libraries used by Moon's Portal settings
  picker.
- `POST /api/portal/onboard` - create a Kavita user, store an onboarding token, and optionally persist the credential.
- `POST /api/portal/tokens/consume` - redeem an onboarding token.

## Slash Commands

- `/ding` - health check response.
- `/join username:<name> password:<password> confirm_password:<password> email:<email>` - create a Kavita user with the
  configured default roles/libraries, store the credential metadata, and assign the default Discord role when
  configured. `PORTAL_JOIN_DEFAULT_ROLES` supports `*` plus exclusions like `*,-admin`, and
  `PORTAL_JOIN_DEFAULT_LIBRARIES` supports `*` for all available libraries.
- `/scan` - autocomplete Kavita libraries in Discord and queue a scan for the selected library.
- `/search` - search Kavita series titles by name and return matching series results.
- `/recommend title:<name>` - search Raven for up to five title matches, ask the user to confirm the intended title
  with Discord buttons, then insert a pending recommendation document into Vault's `portal_recommendations`
  collection. After insertion Portal sends an immediate DM receipt to the requester confirming the recommendation and,
  when Moon URL discovery succeeds, includes a direct `/myrecommendations/<id>` link. If the confirmed title already
  exists in Raven's library, Portal skips insertion and responds that the title is already on the server plus a Kavita
  title link when one can be resolved (preferring `KAVITA_EXTERNAL_URL`).
- Command fallback behavior: if Discord still has an old slash definition that no longer maps to a live Portal command
  handler, Portal now replies with an explicit ephemeral unavailable message instead of timing out with
  `The application did not respond`.
- Recommendation follow-up DMs: Portal polls Vault recommendations and sends direct messages to the original requester
  when a manager approves the recommendation (including approver name), then sends a second DM once the title appears
  in Raven and a Kavita series link can be resolved (preferring `KAVITA_EXTERNAL_URL`). It also sends a DM when an
  admin adds a recommendation timeline comment, including a direct Moon link to `/myrecommendations/<id>`. The same
  poller now mirrors Raven download activity into each recommendation timeline by appending
  `download-started` and `download-completed` system events before Kavita completion DMs go out.
- Boot behavior: when Discord is configured, Portal logs in, clears current-app global commands, clears the guild
  command list, then re-registers all current slash command definitions for the configured guild. If Discord env vars
  are omitted, Portal starts in HTTP-only mode.

## Key Environment Variables

| Variable                                                              | Purpose                                                                                              |
|-----------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| `PORTAL_PORT` or `API_PORT`                                           | HTTP listen port (default `3003`)                                                                    |
| `DISCORD_BOT_TOKEN` / `DISCORD_CLIENT_ID` / `DISCORD_GUILD_ID`        | Optional Discord integration (all-or-none). If omitted, Portal still boots with HTTP routes only.    |
| `DISCORD_GUILD_ROLE_ID` / `DISCORD_DEFAULT_ROLE_ID`                   | Default role assignment target                                                                       |
| `KAVITA_BASE_URL` / `KAVITA_API_KEY`                                  | Kavita API connection (`KAVITA_BASE_URL` defaults to managed `http://noona-kavita:5000`)             |
| `KAVITA_EXTERNAL_URL`                                                 | Optional public Kavita URL used in Moon buttons and Discord recommendation links                     |
| `KOMF_BASE_URL`                                                       | Komf metadata helper URL (`http://noona-komf:8085` by default for managed installs)                  |
| `PORTAL_JOIN_DEFAULT_ROLES` / `PORTAL_JOIN_DEFAULT_LIBRARIES`         | Default Kavita access for `/join` (`*,-admin` for roles and `*` for libraries by default)            |
| `VAULT_BASE_URL` / `VAULT_ACCESS_TOKEN` (`VAULT_API_TOKEN` supported) | Vault API connection; Warden injects a generated `VAULT_API_TOKEN` for managed Portal installs       |
| `RAVEN_BASE_URL` / `WARDEN_BASE_URL`                                  | Optional activity-poll targets for Discord bot presence                                              |
| `MOON_BASE_URL`                                                       | Optional direct Moon URL override for recommendation DMs (fallback uses Warden service URLs)         |
| `PORTAL_ACTIVITY_POLL_MS`                                             | Poll interval for Discord presence refreshes (default `15000`)                                       |
| `PORTAL_RECOMMENDATION_POLL_MS`                                       | Poll interval for recommendation approval/completion DM checks (default `30000`)                     |
| `PORTAL_REDIS_NAMESPACE` / `PORTAL_TOKEN_TTL`                         | Token storage namespace and TTL                                                                      |
| `PORTAL_HTTP_TIMEOUT`                                                 | Upstream request timeout in ms                                                                       |
| `REQUIRED_GUILD_ID` / `REQUIRED_ROLE_<COMMAND>`                       | Optional per-command Discord access gates for `/ding`, `/join`, `/scan`, `/search`, and `/recommend` |
| `NOONA_LOG_DIR`                                                       | Optional directory for Portal's `latest.log`; Warden-managed installs mount `/var/log/noona`         |

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

For Warden-managed installs that target `noona-kavita`, Warden provisions the managed Kavita auth key before starting
Portal and injects the resulting `KAVITA_API_KEY` automatically. Portal now defaults its metadata helper to the
managed `noona-komf` service as well, so fresh installs can search and apply metadata matches without extra manual
configuration.

Portal's Discord presence now prefers Warden install/update activity, then falls back to Raven download/check status,
so the bot advertises `Updating <service>`, `Downloading <title>`, `Downloading <title> (+N)`, `Recovering <title>`,
`Checking <title>`, or `Idle` automatically.

## Documentation Rule

When command definitions, onboarding payloads, or endpoint contracts change, update this README and include markdown
links to the exact files updated so downstream services can follow the flow quickly.
