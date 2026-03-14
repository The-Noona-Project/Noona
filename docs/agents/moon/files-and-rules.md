# Moon Files And Rules

## Important Files

## App Shell And Route Gating

- [../../../services/moon/src/app/layout.tsx](../../../services/moon/src/app/layout.tsx)
  Root layout, providers, theme bootstrap, AppShell mounting, and top-level route guard.
- [../../../services/moon/src/components/AppShell.tsx](../../../services/moon/src/components/AppShell.tsx)
  Main navigation, setup-vs-main shell mode, permission-aware nav links, shellless route behavior, and view-mode
  state.
- [../../../services/moon/src/components/RouteGuard.tsx](../../../services/moon/src/components/RouteGuard.tsx)
  Disables routes based on `moonRoutes` and dynamic route prefixes from the resource config.
- [../../../services/moon/src/components/noona/AuthGate.tsx](../../../services/moon/src/components/noona/AuthGate.tsx)
  Session check, 401 redirect to `/login`, and permission-denied fallback UI.
- [../../../services/moon/src/components/noona/SetupModeGate.tsx](../../../services/moon/src/components/noona/SetupModeGate.tsx)
  Keeps the main app behind setup completion.
- [../../../services/moon/src/components/noona/SetupWizardGate.tsx](../../../services/moon/src/components/noona/SetupWizardGate.tsx)
  Keeps setup routes inaccessible once setup is complete.

## Setup, Auth, And Task UI

- [../../../services/moon/src/components/noona/SetupWizard.tsx](../../../services/moon/src/components/noona/SetupWizard.tsx)
  Main setup wizard, config import or export, managed Kavita provisioning, Discord validation, install polling, and
  summary handoff.
- [../../../services/moon/src/components/noona/SetupSummaryPage.tsx](../../../services/moon/src/components/noona/SetupSummaryPage.tsx)
  Service review, Discord OAuth test/bootstrap, and final setup completion.
- [../../../services/moon/src/components/noona/setupProfile.mjs](../../../services/moon/src/components/noona/setupProfile.mjs)
  Minimal v3 setup snapshot builder and hydrator used by the wizard.
- [../../../services/moon/src/components/noona/LoginPage.tsx](../../../services/moon/src/components/noona/LoginPage.tsx)
  Discord-first login UX, setup checks, and redirect behavior.
- [../../../services/moon/src/components/noona/DiscordCallbackPage.tsx](../../../services/moon/src/components/noona/DiscordCallbackPage.tsx)
  Completes the Sage OAuth exchange and redirects back into Moon with success markers.
- [../../../services/moon/src/components/noona/KavitaLoginBridgePage.tsx](../../../services/moon/src/components/noona/KavitaLoginBridgePage.tsx)
  Converts a Moon session into a Portal-issued Kavita login handoff token.
- [../../../services/moon/src/components/noona/SettingsPage.tsx](../../../services/moon/src/components/noona/SettingsPage.tsx)
  Task-based settings UI, service update actions, user management, and reboot monitor entrypoint.
- [../../../services/moon/src/components/noona/settings/settingsRoutes.ts](../../../services/moon/src/components/noona/settings/settingsRoutes.ts)
  Canonical settings route mapping, titles, descriptions, and tab/view selection.

## API Proxy Layer

- [../../../services/moon/src/app/api/noona/_backend.ts](../../../services/moon/src/app/api/noona/_backend.ts)
  Backend discovery, retry behavior, preferred-endpoint caching, timeouts, and JSON error shaping.
- [../../../services/moon/src/app/api/noona/_auth.ts](../../../services/moon/src/app/api/noona/_auth.ts)
  `noona_session` cookie handling and server-side auth-header injection.
- [../../../services/moon/src/app/api/noona/auth/](../../../services/moon/src/app/api/noona/auth/)
  Moon auth routes, Discord callback proxying, cookie write/clear, and bootstrap deprecation endpoints.
- [../../../services/moon/src/app/api/noona/setup/](../../../services/moon/src/app/api/noona/setup/)
  Setup snapshot, layout, status, Discord test, managed Kavita service-key, and final completion bridge.
- [../../../services/moon/src/app/api/noona/settings/](../../../services/moon/src/app/api/noona/settings/)
  Settings and service-management proxies into Sage plus a few Portal-backed helpers.
- [../../../services/moon/src/app/api/noona/raven/](../../../services/moon/src/app/api/noona/raven/)
  Raven browser actions proxied through Sage.
- [../../../services/moon/src/app/api/noona/portal/](../../../services/moon/src/app/api/noona/portal/)
  Portal-only metadata and Kavita helpers.

## Shared Workflow Helpers

- [../../../services/moon/src/utils/moonPermissions.ts](../../../services/moon/src/utils/moonPermissions.ts)
  Canonical permission list, labels, descriptions, normalization, and permission checks.
- [../../../services/moon/src/components/noona/downloadQueueResults.mjs](../../../services/moon/src/components/noona/downloadQueueResults.mjs)
  Interprets Raven queue responses. This is what keeps semantic failures visible even when a response contains a
  message body.
- [../../../services/moon/src/components/noona/rebootMonitorSession.ts](../../../services/moon/src/components/noona/rebootMonitorSession.ts)
  Session-storage state for the reboot monitor flow.
- [../../../services/moon/src/components/noona/downloadWorkerSettings.mjs](../../../services/moon/src/components/noona/downloadWorkerSettings.mjs)
  Worker CPU draft normalization shared by the downloads settings UI.

## Rules

## Boundary Rules

- Keep browser traffic behind Moon's `/api/noona/*` routes.
  Do not add direct browser calls to Sage, Portal, Raven, Warden, or Vault casually.
- New proxy routes should prefer the existing Sage and Portal boundaries instead of skipping layers for convenience.
- Moon's route handlers should preserve upstream statuses where possible and return Moon-shaped JSON errors when the
  backend call itself fails.

## Setup And Auth Rules

- The setup payload must stay the minimal masked v3 profile from `setupProfile.mjs`, not raw Warden internals.
- Username/password bootstrap is intentionally retired in Moon.
  The Moon bootstrap endpoints return `410`; first-admin creation flows through Discord OAuth on the setup summary
  page.
- `noona_session` stays HTTP-only.
  Client components should not receive or store the raw Sage session token.
- Discord `returnTo` and Kavita handoff targets must remain origin-scoped and trusted.
  Do not loosen those checks casually.

## Navigation And Permission Rules

- Keep Moon's setup and settings IA task-based.
  Avoid sliding back into service-name-first navigation without an explicit redesign.
- Permission keys, display labels, and normalization should stay canonical with
  [../../../services/moon/src/utils/moonPermissions.ts](../../../services/moon/src/utils/moonPermissions.ts).
- If you add or rename settings views, update both the route parser and the visible navigation definitions in
  `settingsRoutes.ts`.
- RouteGuard and AppShell navigation should stay in sync with the enabled route set.

## Update And Recovery Rules

- Use the reboot monitor helpers when update actions intentionally bounce services.
  Do not invent a second ad hoc restart-wait loop elsewhere in the UI.
- Preserve the stricter queue interpretation in `downloadQueueResults.mjs`.
  A Raven message alone does not mean Moon should show the queue attempt as success.

## Test Map

- [../../../services/moon/tests/setupProfile.test.mjs](../../../services/moon/tests/setupProfile.test.mjs)
  Setup profile version, derived service selection, and snapshot hydration.
- [../../../services/moon/tests/downloadQueueResults.test.mjs](../../../services/moon/tests/downloadQueueResults.test.mjs)
  Queue acceptance semantics for Raven downloads.
- [../../../services/moon/tests/downloadWorkerSettings.test.mjs](../../../services/moon/tests/downloadWorkerSettings.test.mjs)
  Worker CPU draft normalization and display labeling.
