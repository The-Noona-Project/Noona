# Portal Files And Rules

## Important Files

- [app/portalRuntime.mjs](../../../services/portal/app/portalRuntime.mjs): config load, Discord bootstrap, server start,
  and shutdown.
- [config/portalConfig.mjs](../../../services/portal/config/portalConfig.mjs): runtime config validation.
- [routes/registerPortalRoutes.mjs](../../../services/portal/routes/registerPortalRoutes.mjs): HTTP endpoints used by
  Moon and the rest of Noona.
- [discord/client.mjs](../../../services/portal/discord/client.mjs): Discord client lifecycle.
- [commands/](../../../services/portal/commands/): slash command definitions and handlers.
- [storage/onboardingStore.mjs](../../../services/portal/storage/onboardingStore.mjs): onboarding token persistence.
- [clients/](../../../services/portal/clients/): Kavita, Komf, Raven, Vault, and Warden integrations.

## Rules

- Discord command changes should stay aligned with Moon's admin settings and command-role surfaces.
- Portal's Warden usage is intentionally narrow. Treat control-plane expansion carefully.
- Keep onboarding and recommendation flows durable across restarts by respecting the Vault-backed stores.
- User-visible Discord or Kavita behavior changes should update the
  public [README.md](../../../services/portal/README.md) and [../../../ServerAdmin.md](../../../ServerAdmin.md).
