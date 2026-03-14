# Sage Files And Rules

## Important Files

## App Wiring And Shared Helpers

- [../../../services/sage/app/createSageApp.mjs](../../../services/sage/app/createSageApp.mjs)
  Main dependency factory. Owns session storage, OAuth state, permission normalization, default settings seeding,
  dangerous-action confirmation, debug propagation, and the middleware passed into all route modules.
- [../../../services/sage/app/createSetupClient.mjs](../../../services/sage/app/createSetupClient.mjs)
  Warden discovery order, Warden bearer auth, install payload normalization, and all setup or service-management proxy
  calls.
- [../../../services/sage/lib/errors.mjs](../../../services/sage/lib/errors.mjs)
  `SetupValidationError`. Use it for caller mistakes that should become `400`, not `502`.

## Route Modules

- [../../../services/sage/routes/registerSetupRoutes.mjs](../../../services/sage/routes/registerSetupRoutes.mjs)
  Setup catalog, config snapshot proxying, wizard state, verification, service logs or tests, Discord validation, and
  managed Kavita API-key provisioning.
- [../../../services/sage/routes/registerAuthRoutes.mjs](../../../services/sage/routes/registerAuthRoutes.mjs)
  Pending-admin bootstrap, Discord OAuth config and callback flow, session login/logout, default member permissions,
  and CRUD for auth users.
- [../../../services/sage/routes/registerSettingsRoutes.mjs](../../../services/sage/routes/registerSettingsRoutes.mjs)
  Debug, onboarding message, download naming, worker and VPN settings, service config and restart actions, ecosystem
  lifecycle, factory reset, and Vault inspection or wipe helpers.
- [../../../services/sage/routes/registerRavenRoutes.mjs](../../../services/sage/routes/registerRavenRoutes.mjs)
  Browser-safe Raven library and download APIs plus recommendation and subscription flows backed by Vault and Portal.

## Upstream Clients And State

- [../../../services/sage/clients/vaultPacketClient.mjs](../../../services/sage/clients/vaultPacketClient.mjs)
  Vault HTTP client for Mongo, Redis, and user endpoints. Retries server-side failures across candidate base URLs.
- [../../../services/sage/clients/ravenClient.mjs](../../../services/sage/clients/ravenClient.mjs)
  Browser-safe Raven proxy. Prefers Warden-discovered host URLs and promotes successful endpoints.
- [../../../services/sage/clients/portalClient.mjs](../../../services/sage/clients/portalClient.mjs)
  Portal metadata helper client with timeout and Warden-discovered host fallback behavior.
- [../../../services/sage/clients/discordSetupClient.mjs](../../../services/sage/clients/discordSetupClient.mjs)
  Discord bot-token validation, guild resource enumeration, and role or channel creation for setup.
- [../../../services/sage/wizard/wizardStateClient.mjs](../../../services/sage/wizard/wizardStateClient.mjs)
  Wizard-state Redis persistence with local fallback plus the publisher that maps service install events into wizard
  step status.
- [../../../services/sage/wizard/wizardStateSchema.mjs](../../../services/sage/wizard/wizardStateSchema.mjs)
  Wizard state shape, step metadata, update normalization, timeline rules, and the current `version = 2` contract.

## Rules

## Boundary Rules

- Moon-facing setup, auth, and Raven browser actions should continue to flow through Sage unless the change explicitly
  redesigns the boundary.
- Do not move Warden, Vault, Raven, or Portal tokens into Moon just to avoid Sage work.
- Browser-visible route handlers should keep returning Sage-shaped responses instead of leaking raw upstream payloads or
  transport errors.

## Auth And Session Rules

- Preserve the `moon_login` gate for any route that creates or validates a user session.
- Treat Discord redirect and callback handling carefully. `returnTo` must stay same-origin with the supplied
  `redirectUri` origin.
- The setup bootstrap user is intentionally protected. Existing bootstrap admins cannot be modified or deleted through
  the normal user-management endpoints.
- Do not bypass `requireSession*`, `requireAdminSession*`, or `requirePermissionSession`.
  Setup-complete gating is subtle and intentionally centralized in `createSageApp.mjs`.

## Persistence Rules

- Sessions and Discord OAuth state write to memory first, then attempt Vault Redis.
  Do not "optimize away" the fallback unless first-run and degraded-mode behavior is redesigned.
- Wizard state uses Redis key `noona:wizard:state`, but the client keeps a local fallback snapshot when Vault is
  missing or down.
- `resolveSetupCompleted()` is derived from wizard state, not a separate install flag.

## Service And Managed Kavita Rules

- Use canonical service names such as `noona-kavita`, `noona-raven`, and `noona-portal` in persisted config and route
  logic.
- Alias handling is intentionally narrow.
  `normalizeServiceInstallPayload()` accepts `kavita` and rewrites it to `noona-kavita`; do not grow alias support
  casually.
- Managed Kavita setup writes specific env keys per consumer service.
  Portal and Raven use `KAVITA_API_KEY` plus `KAVITA_BASE_URL`; Komf uses `KOMF_KAVITA_API_KEY` plus
  `KOMF_KAVITA_BASE_URI`.

## Settings And Destructive Action Rules

- `/api/settings` becomes admin-gated after setup completes, but the route module still performs explicit admin checks
  for sensitive actions.
- Debug changes propagate to Sage, Warden, Raven, and Vault when those endpoints exist.
- Vault wipe and factory reset confirmation depends on auth provider.
  Local users confirm with password; Discord users confirm with current identity text.
- Queue restart side effects through `queueEcosystemRestart()` or Warden lifecycle endpoints instead of open-coding new
  restart logic in route handlers.

## Test Map

- [../../../services/sage/tests/sageApp.test.mjs](../../../services/sage/tests/sageApp.test.mjs)
  Largest surface: route behavior, auth flows, managed Kavita wiring, permissions, and browser-facing responses.
- [../../../services/sage/tests/wizardStateClient.test.mjs](../../../services/sage/tests/wizardStateClient.test.mjs)
  Wizard client retry behavior, fallback reset semantics, and service-to-step publisher logic.
- [../../../services/sage/tests/managedKavitaSetupClient.test.mjs](../../../services/sage/tests/managedKavitaSetupClient.test.mjs)
  Managed Kavita login, register-race handling, and reusable API-key selection behavior.
