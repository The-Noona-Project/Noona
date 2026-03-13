# Portal (Noona Stack 2.2)

Portal coordinates website onboarding and Discord integrations with Kavita and Vault. It exposes HTTP onboarding
routes plus Discord slash commands that surface Kavita library/title metadata, store onboarding tokens, and bridge
recommendation and subscription flows.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Entrypoint](initPortal.mjs)
- [Portal runtime](app/portalRuntime.mjs)
- [HTTP app](app/createPortalApp.mjs)
- [Raven volume-map helper](app/ravenTitleVolumeMap.mjs)
- [Portal routes](routes/registerPortalRoutes.mjs)
- [Runtime config loader](config/portalConfig.mjs)
- [Discord runtime modules](discord/)
- [Discord client](discord/client.mjs)
- [Recommendation notifier](discord/recommendationNotifier.mjs)
- [Subscription notifier](discord/subscriptionNotifier.mjs)
- [Discord command inspector](discord/commandInspector.mjs)
- [Slash command modules](commands/)
- [Recommend command](commands/recommendCommand.mjs)
- [Subscribe command](commands/subscribeCommand.mjs)
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
- Register and execute Discord slash commands for library scans, title search workflows, Raven-backed recommendation
  intake, and subscription management.
- Poll Raven and Warden so the Discord bot presence reflects active downloads, title checks, and service updates.
- Persist portal credentials plus recommendation/subscription documents in Vault, assign Discord roles when configured,
  DM recommendation requesters when approvals/admin comments/completed imports are detected, and DM subscribers when
  Raven finishes new chapters for tracked titles.
- Poll Warden through a dedicated Warden API bearer token instead of anonymous control-plane reads. Portal's Warden
  client is intentionally limited to read-only activity endpoints.
- Queue outbound Discord DMs through Vault Redis packet APIs so per-user recommendation notifications stay in-order.
  Portal now prefers Redis list packets (`rpush`/`lpop`) for FIFO queueing, with a compatibility fallback to legacy
  Redis `set`/`get`/`del` packets when needed.
- Retry transient Vault packet failures for recommendation reads/writes so short startup races do not immediately fail
  Discord recommendation flows.

## HTTP Endpoints

- `GET /health` - process health and guild metadata.
- `GET /api/portal/kavita/info` - return the Kavita link base URL for Moon buttons, preferring `KAVITA_EXTERNAL_URL`
  when configured, plus managed-service hints.
- `GET /api/portal/kavita/title-search` - search Kavita series and return direct Kavita title URLs for Moon title pages.
- `GET /api/portal/kavita/series-metadata` - return Kavita metadata-match status entries for Moon batch metadata
  flows, including direct series URLs plus the current matched vs `notMatched` state.
- `GET /api/portal/kavita/title-cover/:titleUuid` - proxy the stored Noona cover art for a Raven title so Kavita can
  download and lock the same cover image Moon displays.
- `POST /api/portal/kavita/libraries/ensure` - idempotently create or reuse a Kavita library for Raven-managed media
  folders and merge in any missing Raven folder roots on existing libraries.
- `POST /api/portal/kavita/libraries/scan` - resolve a Kavita library by name and trigger a scan for Raven-managed
  imports.
- `POST /api/portal/kavita/title-match/search` - fetch standalone Komf metadata candidates for a Moon recommendation
  approval before the title exists in Kavita, returning the same normalized provider/result fields Moon later stores as
  a deferred metadata plan on the recommendation record. Portal now also normalizes `adultContent` when Komf exposes
  fields such as `Adult Content: yes`, so Moon can warn admins before approval.
- `POST /api/portal/kavita/title-match` - fetch Komf metadata candidates for the selected Kavita series id and Moon
  title query. Portal now queries Komf directly through `/api/kavita/metadata/search`, normalizes Komf provider/result
  ids into Moon's flat match shape, and returns compact operator-facing `500` guidance when Komf fails server-side.
- `POST /api/portal/kavita/title-match/apply` - identify the selected Komf metadata candidate against the chosen
  Kavita series through Komf `/api/kavita/metadata/identify`, then, when Moon supplies the Raven `titleUuid`,
  immediately lock Kavita to the same Noona cover art through the `title-cover` proxy route. If the Raven title record
  does not already have a stored `coverUrl`, Portal now backfills it from the selected metadata match's
  `coverImageUrl` before syncing Kavita so older Noona library entries still inherit the correct cover art. When the
  selected metadata match includes an explicit provider + `providerSeriesId` and the Raven title already exists,
  Portal now also derives a chapter-to-volume map from Komf's normalized provider book coverage, stores it on the
  Raven title, and lets Raven auto-rename existing `.cbz` files when the provider coverage is trustworthy. Legacy
  Kavita provider-id payloads are still accepted as a compatibility fallback.
- `POST /api/portal/raven/title-volume-map` - mediator route that loads normalized provider series details from Komf,
  derives a chapter-to-volume map only from unambiguous integer volume + chapter-coverage data, and forwards the
  normalized map to Raven with optional auto-rename.
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
  Vault credential reads/writes are now best-effort during this flow, so a valid one-time login token can still be
  issued when Vault is temporarily unavailable. If token storage itself returns a malformed record without a token,
  Portal now fails the request with an explicit `502` instead of sending Moon an unusable response.
- `POST /api/portal/kavita/login-tokens/consume` - redeem a short-lived one-time Kavita login token issued by the
  Noona handoff flow.
- `GET /api/portal/join-options` - list Kavita roles, role descriptions, and libraries used by Moon's Portal settings
  picker and the website onboarding flow.
- `POST /api/portal/onboard` - create a Kavita user for website onboarding, store an onboarding token, and optionally
  persist the credential.
- `POST /api/portal/tokens/consume` - redeem an onboarding token.

## Slash Commands

- `/ding` - health check response.
- `/scan` - autocomplete Kavita libraries in Discord and queue a scan for the selected library.
- `/search` - search Kavita series titles by name and return matching series results.
- `/recommend title:<name>` - search Raven for up to five title matches, ask the user to confirm the intended title
  with Discord buttons, then insert a pending recommendation document into Vault's `portal_recommendations`
  collection. The Discord picker now also includes a `Can't find your title?` fallback action so users can save a
  recommendation even when none of Raven's current source results match. After insertion Portal sends an immediate DM
  receipt to the requester confirming the recommendation and, when Moon URL discovery succeeds, includes a direct
  `/myrecommendations/<id>` link. If the confirmed title already exists in Raven's library, Portal skips insertion and
  responds that the title is already on the server plus a Kavita title link when one can be resolved (preferring
  `KAVITA_EXTERNAL_URL`). When Raven can inspect the selected source title page, Portal also stores
  `sourceAdultContent` from the source site's `Adult Content` tag on the recommendation document so Moon admins can be
  warned before approval.
- `/subscribe title:<name>` - subscribe the Discord user to a Raven title and store the subscription in Vault's
  `portal_subscriptions` collection. Portal sends the subscriber a DM whenever Raven reports newly completed chapter
  numbers for that title.
- Command fallback behavior: if Discord still has an old slash definition that no longer maps to a live Portal command
  handler, Portal now replies with an explicit ephemeral unavailable message instead of timing out with
  `The application did not respond`.
- Recommendation follow-up DMs: Portal polls Vault recommendations and sends direct messages to the original requester
  when a manager approves the recommendation (including approver name), then sends a second DM once the title appears
  in Raven. When a Kavita series link can be resolved (preferring `KAVITA_EXTERNAL_URL`), that completion DM includes
  the direct Kavita URL; otherwise Portal still sends the DM after Raven finishes downloading and includes a Moon
  `/myrecommendations/<id>` link when available so the requester is not left without an update. It also sends a DM
  when an admin adds a recommendation timeline comment, including a direct Moon link to `/myrecommendations/<id>`.
  The same poller now mirrors Raven download activity into each recommendation timeline by appending
  `download-started`, periodic `download-progress` milestones, and `download-completed` system events before
  completion DMs go out. When Sage/Moon stored a confirmed `metadataSelection` during approval, Portal now waits until
  Raven's imported title is visible and Kavita can resolve the scanned series, then applies that saved metadata match
  through Komf/Kavita and records the apply result back onto the recommendation before completion messaging finishes.
  That deferred metadata apply now reuses the same Raven volume-map helper as the immediate metadata-apply route, so
  provider-backed chapter-to-volume mappings and post-download file renames stay consistent across both paths.
- Subscription follow-up DMs: Portal polls active `portal_subscriptions` documents and DM-notifies each subscriber
  whenever Raven exposes new `completedChapterNumbers` for a matched title task.
- Boot behavior: when Discord is configured, Portal logs in, clears current-app global commands, clears the guild
  command list, then re-registers all current slash command definitions for the configured guild. That boot-time sync
  is what removes stale `/join` registrations after upgrading. If Discord env vars are omitted, Portal starts in
  HTTP-only mode.

## Key Environment Variables

| Variable                                                              | Purpose                                                                                               |
|-----------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| `PORTAL_PORT` or `API_PORT`                                           | HTTP listen port (default `3003`)                                                                     |
| `DISCORD_BOT_TOKEN` / `DISCORD_CLIENT_ID` / `DISCORD_GUILD_ID`        | Optional Discord integration (all-or-none). If omitted, Portal still boots with HTTP routes only.     |
| `DISCORD_GUILD_ROLE_ID` / `DISCORD_DEFAULT_ROLE_ID`                   | Default role assignment target                                                                        |
| `KAVITA_BASE_URL` / `KAVITA_API_KEY`                                  | Kavita API connection (`KAVITA_BASE_URL` defaults to managed `http://noona-kavita:5000`)              |
| `KAVITA_EXTERNAL_URL`                                                 | Optional public Kavita URL used in Moon buttons and Discord recommendation links                      |
| `KOMF_BASE_URL`                                                       | Komf metadata helper URL (`http://noona-komf:8085` by default for managed installs)                   |
| `PORTAL_JOIN_DEFAULT_ROLES` / `PORTAL_JOIN_DEFAULT_LIBRARIES`         | Default Kavita access for website onboarding (`*,-admin` for roles and `*` for libraries by default)  |
| `VAULT_BASE_URL` / `VAULT_ACCESS_TOKEN` (`VAULT_API_TOKEN` supported) | Vault API connection; Warden injects a generated `VAULT_API_TOKEN` for managed Portal installs        |
| `RAVEN_BASE_URL` / `WARDEN_BASE_URL`                                  | Optional activity-poll targets for Discord bot presence                                               |
| `WARDEN_API_TOKEN`                                                    | Bearer token Portal uses for Warden activity polling                                                  |
| `MOON_BASE_URL`                                                       | Optional direct Moon URL override for recommendation DMs (fallback uses Warden service URLs)          |
| `PORTAL_ACTIVITY_POLL_MS`                                             | Poll interval for Discord presence refreshes (default `15000`)                                        |
| `PORTAL_RECOMMENDATION_POLL_MS`                                       | Poll interval for recommendation and subscription DM checks (default `30000`)                         |
| `PORTAL_REDIS_NAMESPACE` / `PORTAL_TOKEN_TTL`                         | Token storage namespace and TTL                                                                       |
| `PORTAL_HTTP_TIMEOUT`                                                 | Upstream request timeout in ms                                                                        |
| `REQUIRED_GUILD_ID` / `REQUIRED_ROLE_<COMMAND>`                       | Optional per-command Discord access gates for `/ding`, `/scan`, `/search`, `/recommend`, `/subscribe` |
| `NOONA_LOG_DIR`                                                       | Optional directory for Portal's `latest.log`; Warden-managed installs mount `/var/log/noona`          |

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
