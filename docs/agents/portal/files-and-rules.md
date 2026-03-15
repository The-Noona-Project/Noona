# Portal Files And Rules

## Important Files

- [app/portalRuntime.mjs](../../../services/portal/app/portalRuntime.mjs): config load, Discord bootstrap, server start,
  and shutdown.
- [app/createPortalApp.mjs](../../../services/portal/app/createPortalApp.mjs): Express app assembly and route
  registration.
- [app/ravenTitleVolumeMap.mjs](../../../services/portal/app/ravenTitleVolumeMap.mjs): Komf-to-Raven chapter/volume map
  bridge used by metadata flows.
- [config/portalConfig.mjs](../../../services/portal/config/portalConfig.mjs): runtime config validation.
- [routes/registerPortalRoutes.mjs](../../../services/portal/routes/registerPortalRoutes.mjs): HTTP endpoints used by
  Moon and the rest of Noona.
- [discord/client.mjs](../../../services/portal/discord/client.mjs): Discord client lifecycle.
- [discord/interactionRouter.mjs](../../../services/portal/discord/interactionRouter.mjs): slash command, button, and
  autocomplete dispatch.
- [discord/roleManager.mjs](../../../services/portal/discord/roleManager.mjs): `REQUIRED_GUILD_ID` and
  `REQUIRED_ROLE_<COMMAND>` access gates.
- [discord/recommendationNotifier.mjs](../../../services/portal/discord/recommendationNotifier.mjs): recommendation DM,
  timeline, and deferred metadata worker.
- [discord/subscriptionNotifier.mjs](../../../services/portal/discord/subscriptionNotifier.mjs): chapter DM worker for
  active subscriptions.
- [discord/presenceUpdater.mjs](../../../services/portal/discord/presenceUpdater.mjs): bot presence derived from Warden
  install state and Raven activity.
- [commands/](../../../services/portal/commands/): slash command definitions and handlers.
- [storage/onboardingStore.mjs](../../../services/portal/storage/onboardingStore.mjs): onboarding token persistence.
- [clients/](../../../services/portal/clients/): Kavita, Komf, Raven, Vault, and Warden integrations.
- [tests/portalApp.test.mjs](../../../services/portal/tests/portalApp.test.mjs): route contract coverage.
- [tests/discordCommands.test.mjs](../../../services/portal/tests/discordCommands.test.mjs): slash command behavior and
  recommendation/subscription coverage.
- [tests/recommendationNotifier.test.mjs](../../../services/portal/tests/recommendationNotifier.test.mjs): DM, timeline,
  and deferred metadata coverage.
- [tests/subscriptionNotifier.test.mjs](../../../services/portal/tests/subscriptionNotifier.test.mjs): chapter DM
  dedupe and persistence coverage.

## Rules

- Discord startup is optional, but partial Discord config is invalid. Portal should either run full Discord mode or
  clean HTTP-only mode.
- First-party Portal `.mjs` files should keep the standard top JSDoc header with file purpose, related-file pointers,
  and `Times this file has been edited: N`.
- Refresh the edit counter from git history when you touch a Portal `.mjs` file, then add `1` for the in-flight edit.
- Add or update JSDoc for exported functions and non-trivial helpers you change so the code stays self-describing.
- Discord command changes should stay aligned with Moon's admin settings and command-role surfaces.
- Portal's Warden usage is intentionally narrow. Treat control-plane expansion carefully.
- Keep onboarding and recommendation flows durable across restarts by respecting the Vault-backed stores.
- Keep Portal Redis namespaces under the `portal:` family because Vault policy authorizes Portal keys by prefix.
- Preserve the current data contracts unless the change explicitly coordinates callers and docs:
  secret path `portal/<discordId>`, collections `portal_recommendations` and `portal_subscriptions`, onboarding token
  storage under `PORTAL_REDIS_NAMESPACE`, and Discord DM queue storage under `PORTAL_DM_QUEUE_NAMESPACE`.
- Preserve the current slash command set unless a coordinated product change says otherwise: `ding`, `scan`, `search`,
  `recommend`, and `subscribe`.
- Portal's DM delivery path supports both Redis list packets (`rpush`/`lpop`) and a legacy `set`/`get`/`del` fallback.
  Do not remove one side casually because Vault compatibility can vary.
- Recommendation and subscription notifiers are polling workers, not event-stream consumers. If you change their data
  shapes or idempotency rules, update tests in the same change.
- User-facing links should keep respecting configured external URLs for Moon and Kavita when available.
- Metadata and Kavita bridge errors should stay compact and operator-friendly; large upstream payloads should not leak
  straight through to Moon.
- User-visible Discord or Kavita behavior changes should update the
  public [README.md](../../../services/portal/README.md) and [../../../ServerAdmin.md](../../../ServerAdmin.md).
