# Sage AI Notes

Sage is the Moon-facing broker for setup, auth, users, and browser-safe Raven actions.

## Read In This Order

- [files-and-rules.md](files-and-rules.md)
- [flows.md](flows.md)

## Key Files

- [app/createSageApp.mjs](../../../services/sage/app/createSageApp.mjs)
- [app/createSetupClient.mjs](../../../services/sage/app/createSetupClient.mjs)
- [routes/](../../../services/sage/routes/)
- [clients/](../../../services/sage/clients/)
- [wizard/](../../../services/sage/wizard/)

## Change Map

- setup proxy behavior: `app/createSetupClient.mjs` and `routes/registerSetupRoutes.mjs`
- auth and user management: `routes/registerAuthRoutes.mjs`
- settings storage: `routes/registerSettingsRoutes.mjs`
- browser-facing Raven actions: `routes/registerRavenRoutes.mjs`

If an admin has to change how they install, log in, or manage users,
update [../../../ServerAdmin.md](../../../ServerAdmin.md).
