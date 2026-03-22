# Portal AI Notes

Portal is Noona's Discord, onboarding, and Kavita bridge service. Most edits land in one of five areas: HTTP routes,
Discord boot and commands, onboarding/login tokens, recommendation or subscription polling, or upstream client
contracts.

## Read In This Order

- [files-and-rules.md](files-and-rules.md)
- [flows.md](flows.md)
- [runtime-and-integrations.md](runtime-and-integrations.md)
- [discord-commands-and-stores.md](discord-commands-and-stores.md)
- [discord-runtime-and-routing.md](discord-runtime-and-routing.md)
- [discord-dm-queue-and-workers.md](discord-dm-queue-and-workers.md)

## Service Shape

- Boot starts in [initPortal.mjs](../../../services/portal/initPortal.mjs) and hands off to
  [portalRuntime.mjs](../../../services/portal/app/portalRuntime.mjs).
- [portalRuntime.mjs](../../../services/portal/app/portalRuntime.mjs) loads config, creates clients, optionally boots
  Discord, starts notifiers, and then starts the HTTP server through
  [createPortalApp.mjs](../../../services/portal/app/createPortalApp.mjs).
- The browser-facing API lives almost entirely in
  [registerPortalRoutes.mjs](../../../services/portal/routes/registerPortalRoutes.mjs).
- Discord behavior is split across
  [discord/client.mjs](../../../services/portal/discord/client.mjs),
  [discord/directMessageRouter.mjs](../../../services/portal/discord/directMessageRouter.mjs),
  [discord/interactionRouter.mjs](../../../services/portal/discord/interactionRouter.mjs),
  [discord/commandSynchronizer.mjs](../../../services/portal/discord/commandSynchronizer.mjs), and the slash command
  files in [commands/](../../../services/portal/commands/).
- Recommendation and subscription background work lives in
  [recommendationNotifier.mjs](../../../services/portal/discord/recommendationNotifier.mjs) and
  [subscriptionNotifier.mjs](../../../services/portal/discord/subscriptionNotifier.mjs).

## Common Task Map

- Config, required env, service defaults:
  [config/portalConfig.mjs](../../../services/portal/config/portalConfig.mjs)
- Route payloads, onboarding, Kavita bridge, metadata routes:
  [routes/registerPortalRoutes.mjs](../../../services/portal/routes/registerPortalRoutes.mjs)
- Discord login, DM queueing, DM-only admin commands, role checks, slash command sync:
  [discord/](../../../services/portal/discord/)
- Slash command behavior for `ding`, `scan`, `search`, `recommend`, and `subscribe`:
  [commands/](../../../services/portal/commands/)
- Onboarding token persistence and TTL behavior:
  [storage/onboardingStore.mjs](../../../services/portal/storage/onboardingStore.mjs)
- Upstream client contracts for Kavita, Komf, Raven, Vault, and Warden:
  [clients/](../../../services/portal/clients/)
- Raven chapter-to-volume mapping bridge:
  [app/ravenTitleVolumeMap.mjs](../../../services/portal/app/ravenTitleVolumeMap.mjs)

## Editing Convention

- First-party Portal `.mjs` files carry a top JSDoc header with a short file purpose, a few related Portal files, and a
  `Times this file has been edited: N` counter.
- Refresh that counter from git history when you materially edit the file, then add `1` for the current change.
- Add or update JSDoc for exported functions and any non-trivial helpers touched in the same edit.

## Cross-Service Impact

- [Moon](../moon/README.md) depends on Portal for onboarding options, Kavita user management, metadata bridge routes,
  and recommendation/user-facing links.
- [Vault](../vault/README.md) stores Portal credentials, recommendations, subscriptions, onboarding tokens, and DM
  queue state.
- [Raven](../raven/README.md) powers recommendation searches, download state, title repair work, and volume-map writes.
- Raven also backs Portal's DM-only `downloadall` bulk queue command through `POST /v1/download/bulk-queue`.
- [Komf](../komf/README.md) backs metadata search, identify, and series-details lookups.
- [Warden](../warden/README.md) is only used for a narrow set of read-side install/progress lookups and Moon URL
  discovery.

## Update Triggers

- If Discord onboarding, command access, recommendation behavior, or Kavita handoff changes, update Moon/admin docs in
  the same change.
- If route payloads change, update
  [portalApp.test.mjs](../../../services/portal/tests/portalApp.test.mjs) and any related command/notifier tests.
- If a change expands Portal's Warden usage beyond read-only status/progress lookups, document that explicitly because
  the current boundary is intentional.
