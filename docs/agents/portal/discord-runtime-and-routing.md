# Portal Discord Runtime And Routing

## Boot Path

- Portal decides whether Discord is enabled in
  [../../../services/portal/config/portalConfig.mjs](../../../services/portal/config/portalConfig.mjs).
  Discord only turns on when `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` are all present.
- [../../../services/portal/app/portalRuntime.mjs](../../../services/portal/app/portalRuntime.mjs) always builds the
  upstream Kavita, Komf, Vault, Raven, Warden, and onboarding-store clients first.
- When Discord is enabled, `startPortal()` then builds the slash-command map, the DM-only message handler, and the
  Discord client wrapper before calling `discord.login()`.
- If Discord auth fails, Portal destroys the client, marks Discord status as `degraded`, skips Discord-only workers,
  and still starts the HTTP API.
  This is an intentional API-only fallback, not a hard startup failure.

## Discord Client Wrapper

- The bot wrapper lives in
  [../../../services/portal/discord/client.mjs](../../../services/portal/discord/client.mjs).
- Default intents are:
  `Guilds`,
  `GuildMembers`,
  `DirectMessages`
- Default partials are:
  `GuildMember`,
  `User`,
  `Channel`
- `ClientReady` resolves the wrapper's internal ready promise.
  `login()` waits for that promise and only then synchronizes slash commands.
- The wrapper exposes a few helpers used elsewhere in Portal:
  `fetchGuild()`,
  `fetchMember()`,
  `assignDefaultRole()`,
  `sendDirectMessage()`,
  `waitUntilReady()`
- `assignDefaultRole()` uses the configured `DISCORD_GUILD_ROLE_ID` or `DISCORD_DEFAULT_ROLE_ID` when present.
  Route and onboarding helpers can call this without reaching into raw Discord.js objects.

## Command Registry

- Slash command assembly lives in
  [../../../services/portal/commands/index.mjs](../../../services/portal/commands/index.mjs).
- The current registered command set is:
  `ding`,
  `scan`,
  `search`,
  `recommend`,
  `subscribe`
- Each command object follows the same broad contract:
  `definition` for Discord registration,
  `execute` for chat-input handling,
  optional `autocomplete`,
  optional `handleComponent`
- [../../../services/portal/discord/commandCatalog.mjs](../../../services/portal/discord/commandCatalog.mjs)
  normalizes that collection into a stable `Map` and extracts only `definition` payloads for registration.

## Slash Command Sync

- Registration lives in
  [../../../services/portal/discord/commandSynchronizer.mjs](../../../services/portal/discord/commandSynchronizer.mjs).
- On successful login, Portal clears stale global commands first, clears the configured guild commands second, and
  finally registers the current guild command definitions.
- That "clear then register" sequence is what keeps the old legacy `join` command from reappearing on the application.
- If no command definitions are available, Portal still clears existing global and guild commands so Discord does not
  keep stale state.

## Interaction Routing

- Routing lives in
  [../../../services/portal/discord/interactionRouter.mjs](../../../services/portal/discord/interactionRouter.mjs).
- Autocomplete interactions:
  check guild and role access first,
  then call `handler.autocomplete()`,
  otherwise respond with an empty suggestion list
- Button interactions:
  iterate every registered command that exports `handleComponent()`,
  stop on the first handler that returns `true`
- Chat-input commands:
  look up the command by `interaction.commandName`,
  apply access checks,
  call `handler.execute()`
- Missing handlers, command exceptions, and button exceptions all respond with compact ephemeral fallback messages so a
  bad command path does not crash the bot process.

## Access Gates

- [../../../services/portal/discord/roleManager.mjs](../../../services/portal/discord/roleManager.mjs) centralizes the
  two live Discord access gates.
- `REQUIRED_GUILD_ID` can lock every slash command to one guild.
- `REQUIRED_ROLE_<COMMAND>` can lock a single command after normalizing its name to uppercase underscore form.
  Example:
  `REQUIRED_ROLE_RECOMMEND`
- The access check inspects several possible member role shapes because Discord.js test doubles and real runtime
  objects are not identical.
- Denials stay ephemeral and user-facing.
  Portal logs the denied actor plus the reason for command invocations.

## Component And DM Routing

- `/recommend` is the main component-driven flow.
  [../../../services/portal/commands/recommendCommand.mjs](../../../services/portal/commands/recommendCommand.mjs)
  stores a 10-minute in-memory pending session, renders button rows, and only lets the original requester confirm that
  session.
- DM text commands do not go through slash-command routing at all.
  [../../../services/portal/discord/directMessageRouter.mjs](../../../services/portal/discord/directMessageRouter.mjs)
  is attached separately to `MessageCreate`.
- The only current DM-only bot command is `downloadall`.
  It only runs in direct messages, accepts `downloadall`, `/downloadall`, and `!downloadall`, and silently ignores
  non-superuser attempts.
- `downloadall` authorization comes from `DISCORD_SUPERUSER_ID`.
  That path is intentionally invisible to normal guild users because it is not a slash command.

## Presence Updates

- [../../../services/portal/discord/presenceUpdater.mjs](../../../services/portal/discord/presenceUpdater.mjs) polls
  Warden and Raven after a successful Discord login.
- `PORTAL_ACTIVITY_POLL_MS` controls that polling interval.
- Presence priority is:
  active Warden install or update work first,
  active Raven downloads second,
  Raven recovery or queue state next,
  Raven title-checking next,
  then idle
- Warden activity uses install progress first and recent service history second.
  Raven activity uses download summary payloads.

## Test Map

- [../../../services/portal/tests/discordClient.test.mjs](../../../services/portal/tests/discordClient.test.mjs)
  covers login, command sync, interaction routing, and DM queue behavior.
- [../../../services/portal/tests/discordCommands.test.mjs](../../../services/portal/tests/discordCommands.test.mjs)
  covers the live slash-command contract, autocomplete, and recommendation component flow.
- [../../../services/portal/tests/directMessageRouter.test.mjs](../../../services/portal/tests/directMessageRouter.test.mjs)
  covers `downloadall` parsing, prefixes, validation replies, and superuser enforcement.
- [../../../services/portal/tests/presenceUpdater.test.mjs](../../../services/portal/tests/presenceUpdater.test.mjs)
  covers presence-priority decisions.

## Editing Reminders

- If you add or remove a slash command, update the sync tests and the high-level command docs in the same change.
- If you change button `customId` conventions, update the command handler and the router-facing tests together.
- If you turn DM-only admin behavior into a slash command, that is a product-visible change.
  Update public Portal and admin docs too, not only this internal note.
