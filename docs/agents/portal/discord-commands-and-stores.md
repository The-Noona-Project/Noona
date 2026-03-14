# Portal Discord, Commands, And Stores

## Current Slash Commands

- `ding`
  simple health-style Discord reply
- `scan`
  queues a Kavita library scan
- `search`
  searches Kavita titles
- `recommend`
  searches Raven, opens a selection UI, and stores a recommendation
- `subscribe`
  stores an active subscription for chapter-complete DMs

The legacy `join` command is intentionally absent. Tests lock that in.

## Command Sync Behavior

- Portal clears stale global and guild commands on boot, then registers the current guild command definitions.
- If a command definition changes, check
  [discordCommands.test.mjs](../../../services/portal/tests/discordCommands.test.mjs) and Moon/admin docs in the same
  change.

## Discord Access Gates

- `REQUIRED_GUILD_ID` can lock all commands to one guild.
- `REQUIRED_ROLE_<COMMAND>` can lock a single command, for example `REQUIRED_ROLE_DING`.
- Access checks happen in
  [roleManager.mjs](../../../services/portal/discord/roleManager.mjs) before command execution.

## DM Queue Behavior

- Portal serializes direct messages per user.
- Preferred queue path uses Vault Redis `rpush`/`lpop`.
- Fallback queue path stores a JSON array with Redis `set`/`get`/`del`.
- Runtime normally sets the DM queue namespace to `${PORTAL_REDIS_NAMESPACE}:discord-dm`.
- If queue writes fail, Portal can still fall back to in-memory per-user delivery for the current process lifetime.

## Recommendation Store Shape

- Stored in Vault collection `portal_recommendations`.
- Discord-sourced recommendations usually include:
  `source`, `status`, `requestedAt`, `query`, `searchId`, `selectedOptionIndex`, `title`, `href`,
  `sourceAdultContent`, `requestedBy`, and `discordContext`.
- Recommendation notifier also persists:
  `timeline`
  `notifications.*`
  `completedAt`
  `metadataSelection`

## Subscription Store Shape

- Stored in Vault collection `portal_subscriptions`.
- Discord-sourced subscriptions usually include:
  `source`, `status`, `subscribedAt`, `titleQuery`, `title`, `titleKey`, `titleUuid`, `sourceUrl`, `subscriber`,
  and `notifications`.
- `notifications.sentChapterKeys` is the idempotency guard that prevents duplicate chapter DMs.
- The notifier trims that key list to the newest 2000 entries.

## Recommendation Session Behavior

- `/recommend` uses an in-memory pending session with a 10-minute TTL.
- The session stores the search query, Raven `searchId`, visible options, and the requesting Discord user/guild/channel.
- Button interactions for `select`, `missing`, and `cancel` all depend on that session remaining alive.
- Search sessions are not persisted across Portal restarts. Only stored recommendations are durable.

## Background Notifiers

- Recommendation polling default: 30 seconds.
- Subscription polling default: 30 seconds.
- Recommendation notifier responsibilities:
  approval DMs
  admin-comment DMs
  Raven download timeline events
  deferred metadata apply
  completion DMs with Moon/Kavita links
- Subscription notifier responsibility:
  DM each newly completed chapter exactly once per subscriber/title key

## Useful Editing Reminders

- Recommendation flows touch more than Discord. They also touch Raven search, Vault persistence, Moon links, Kavita
  title lookup, Komf metadata, and Raven volume maps.
- Subscription flows intentionally capture baseline chapter markers at subscribe time so users do not receive old
  chapter notifications as "new."
- The best entry points for behavior changes are:
  [recommendCommand.mjs](../../../services/portal/commands/recommendCommand.mjs),
  [subscribeCommand.mjs](../../../services/portal/commands/subscribeCommand.mjs),
  [recommendationNotifier.mjs](../../../services/portal/discord/recommendationNotifier.mjs), and
  [subscriptionNotifier.mjs](../../../services/portal/discord/subscriptionNotifier.mjs).
