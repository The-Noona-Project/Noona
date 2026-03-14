# Portal AI Notes

Portal handles Discord bot behavior, onboarding, recommendation notifications, and Kavita bridge features.

## Read In This Order

- [files-and-rules.md](files-and-rules.md)
- [flows.md](flows.md)

## Key Files

- [app/portalRuntime.mjs](../../../services/portal/app/portalRuntime.mjs)
- [routes/registerPortalRoutes.mjs](../../../services/portal/routes/registerPortalRoutes.mjs)
- [discord/](../../../services/portal/discord/)
- [commands/](../../../services/portal/commands/)
- [storage/onboardingStore.mjs](../../../services/portal/storage/onboardingStore.mjs)

## Change Map

- HTTP onboarding or Kavita bridge changes: routes
- Discord login, sync, or permissions: `discord/`
- slash commands: `commands/`
- onboarding token behavior: `storage/onboardingStore.mjs`

If Moon settings or admin setup steps need to change with the Portal change, update those docs too.
