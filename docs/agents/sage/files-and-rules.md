# Sage Files And Rules

## Important Files

- [app/createSageApp.mjs](../../../services/sage/app/createSageApp.mjs): app wiring and dependency injection.
- [app/createSetupClient.mjs](../../../services/sage/app/createSetupClient.mjs): Warden discovery and setup proxy logic.
- [routes/registerAuthRoutes.mjs](../../../services/sage/routes/registerAuthRoutes.mjs): Discord OAuth, sessions,
  bootstrap, users, and default permissions.
- [routes/registerSetupRoutes.mjs](../../../services/sage/routes/registerSetupRoutes.mjs): setup and install routes.
- [routes/registerSettingsRoutes.mjs](../../../services/sage/routes/registerSettingsRoutes.mjs): admin settings APIs.
- [routes/registerRavenRoutes.mjs](../../../services/sage/routes/registerRavenRoutes.mjs): browser-facing Raven proxy
  routes.

## Rules

- Moon-facing setup and auth should continue to flow through Sage unless the boundary is intentionally redesigned.
- Treat redirect and callback handling carefully. Do not widen redirect trust rules casually.
- Normalize upstream failures into browser-safe responses instead of leaking backend-specific details.
- Setup, auth, or user-management changes should update the public [README.md](../../../services/sage/README.md)
  and [../../../ServerAdmin.md](../../../ServerAdmin.md).
