# Moon AI Notes

Moon is Noona's main web UI. It owns first-run setup, Discord-first login, task-based settings, download and library
workflows, and the browser-side experience for recommendations and subscriptions.

## Read In This Order

- [files-and-rules.md](files-and-rules.md)
  Important files, invariants, and the small Moon test surface that protects the main helpers.
- [api-and-proxy-boundaries.md](api-and-proxy-boundaries.md)
  How the Next route handlers proxy to Sage or Portal, how the session cookie becomes bearer auth, and which
  boundaries should stay intact.
- [setup-auth-and-ui-state.md](setup-auth-and-ui-state.md)
  The v3 setup profile, setup gates, Discord callback flow, bootstrap deprecation, AppShell mode switching, and reboot
  monitor session state.
- [flows.md](flows.md)
  The high-value setup, settings, reboot, download, and Kavita handoff flows.

## Core Concepts

- Browsers should talk to Moon's `/api/noona/*` routes, not directly to Sage, Warden, Raven, Portal, or Vault.
- Moon's server-side proxy layer is mostly Sage-first.
  Portal is used for Kavita and metadata helpers, while the `wardenJson()` and `ravenJson()` helpers in
  [../../../services/moon/src/app/api/noona/_backend.ts](../../../services/moon/src/app/api/noona/_backend.ts)
  currently exist but are not the main live route surface.
- Moon stores the Noona session in an HTTP-only cookie named `noona_session`.
  Client components do not get the raw bearer token; the Next route handlers attach it server-side.
- The setup wizard edits a minimal masked v3 setup profile, not raw Warden descriptor state.
  Warden derives the real managed-service selection and runtime config after Moon persists the snapshot.
- Moon's information architecture is intentionally task-based.
  Setup, settings, downloads, and users should not drift back to a service-name-first UI unless the redesign is
  intentional.
- Setup completion drives the page gates.
  The wizard pages stay accessible only while setup is incomplete, and the main app routes redirect back to the wizard
  until setup is marked complete.

## Most Common Edit Targets

- app shell, navigation, and route enablement:
  [../../../services/moon/src/app/layout.tsx](../../../services/moon/src/app/layout.tsx),
  [../../../services/moon/src/components/AppShell.tsx](../../../services/moon/src/components/AppShell.tsx),
  [../../../services/moon/src/components/RouteGuard.tsx](../../../services/moon/src/components/RouteGuard.tsx)
- setup wizard, summary, and setup-profile helpers:
  [../../../services/moon/src/components/noona/SetupWizard.tsx](../../../services/moon/src/components/noona/SetupWizard.tsx),
  [../../../services/moon/src/components/noona/SetupSummaryPage.tsx](../../../services/moon/src/components/noona/SetupSummaryPage.tsx),
  [../../../services/moon/src/components/noona/setupProfile.mjs](../../../services/moon/src/components/noona/setupProfile.mjs)
- login, callback, and Kavita handoff UI:
  [../../../services/moon/src/components/noona/LoginPage.tsx](../../../services/moon/src/components/noona/LoginPage.tsx),
  [../../../services/moon/src/components/noona/DiscordCallbackPage.tsx](../../../services/moon/src/components/noona/DiscordCallbackPage.tsx),
  [../../../services/moon/src/components/noona/KavitaLoginBridgePage.tsx](../../../services/moon/src/components/noona/KavitaLoginBridgePage.tsx)
- task-based settings UI and settings route mapping:
  [../../../services/moon/src/components/noona/SettingsPage.tsx](../../../services/moon/src/components/noona/SettingsPage.tsx),
  [../../../services/moon/src/components/noona/settings/settingsRoutes.ts](../../../services/moon/src/components/noona/settings/settingsRoutes.ts)
- API proxy layer and session-cookie helpers:
  [../../../services/moon/src/app/api/noona/](../../../services/moon/src/app/api/noona/),
  [../../../services/moon/src/app/api/noona/_backend.ts](../../../services/moon/src/app/api/noona/_backend.ts),
  [../../../services/moon/src/app/api/noona/_auth.ts](../../../services/moon/src/app/api/noona/_auth.ts)
- permission and workflow helpers:
  [../../../services/moon/src/utils/moonPermissions.ts](../../../services/moon/src/utils/moonPermissions.ts),
  [../../../services/moon/src/components/noona/downloadQueueResults.mjs](../../../services/moon/src/components/noona/downloadQueueResults.mjs),
  [../../../services/moon/src/components/noona/rebootMonitorSession.ts](../../../services/moon/src/components/noona/rebootMonitorSession.ts)

## Cross-Service Touchpoints

- Sage:
  the primary backend for setup, auth, settings, service control, recommendations, subscriptions, and Raven browser
  actions.
- Portal:
  Kavita provisioning, title metadata matching, join options, and the Kavita noona-login handoff.
- Warden:
  indirect through Sage. Moon should not need to know Warden auth or raw runtime descriptor logic.
- Raven:
  indirect through Sage for library and download actions, but Moon still owns the user-facing interpretation of queue
  responses and download UX.
- Kavita:
  Moon owns the browser handoff page that converts a Noona session into a Portal-issued Kavita login token.

## Update Checklist

- If setup, login, permissions, or admin workflows change, update [../../../ServerAdmin.md](../../../ServerAdmin.md).
- If the public Moon workflow changes, update [../../../services/moon/README.md](../../../services/moon/README.md).
- If the proxy layer, cookie auth, or backend discovery rules change,
  update [api-and-proxy-boundaries.md](api-and-proxy-boundaries.md).
- If setup profile, auth pages, AppShell gating, or reboot monitor state changes, update
  [setup-auth-and-ui-state.md](setup-auth-and-ui-state.md).
