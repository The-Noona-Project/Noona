# Moon Files And Rules

## Important Files

- [src/app/](../../../services/moon/src/app/): route entrypoints.
- [src/components/noona/](../../../services/moon/src/components/noona/): product-facing pages and shared Noona UI.
- [src/app/api/noona/](../../../services/moon/src/app/api/noona/): browser-facing API proxies into Sage, Portal, and
  Raven.
- [src/utils/moonPermissions.ts](../../../services/moon/src/utils/moonPermissions.ts): canonical permission keys and
  labels.
- [src/components/noona/settings/settingsRoutes.ts](../../../services/moon/src/components/noona/settings/settingsRoutes.ts):
  settings route map and labels.

## Rules

- Keep Moon's setup and settings IA task-based. Do not drift back to service-name-first navigation by accident.
- The browser-facing setup payload should stay the minimal masked profile, not raw Warden internals.
- Prefer Moon -> Sage/Portal/Raven proxy boundaries that already exist. Do not add new direct
  browser-to-internal-service hops casually.
- Permission keys should stay canonical and consistent with `moonPermissions.ts`.
- Admin-facing route changes should update the public [README.md](../../../services/moon/README.md)
  and [../../../ServerAdmin.md](../../../ServerAdmin.md).
