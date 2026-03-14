# Moon Setup, Auth, And UI State

## Setup Profile Contract

- Moon's setup helper lives in
  [../../../services/moon/src/components/noona/setupProfile.mjs](../../../services/moon/src/components/noona/setupProfile.mjs).
- Current public contract is `SETUP_PROFILE_VERSION = 3`.
- The persisted browser-facing shape is intentionally small:
  `version`,
  `storageRoot`,
  `kavita`,
  `komf`,
  and `discord`.
- `deriveSetupProfileSelection()` is the Moon-side summary of implied managed services.
  It always includes `noona-portal` and `noona-raven`, plus `noona-kavita` or `noona-komf` when those integrations
  are managed.
- `hydrateSetupProfileState()` is the only supported path for restoring wizard form state from a saved snapshot.

## Setup Gates

- `SetupWizardGate` keeps `/setupwizard` and `/setupwizard/summary` available only while setup is incomplete.
- `SetupModeGate` keeps the main application behind setup completion and redirects to `/setupwizard` otherwise.
- `AuthGate` is separate.
  It checks `/api/noona/auth/status`, redirects to `/login` on `401`, and can enforce individual Moon permissions.

## Wizard State Inside Moon

- The wizard loads the service catalog, storage layout, persisted setup snapshot, and setup status together.
- Moon keeps a derived local env state for form editing, but the real install selection still comes from the persisted
  snapshot.
- `storageRoot` stays separate wizard metadata.
  The local derived env helper should only mirror editable service fields, not inject `NOONA_DATA_ROOT` into service
  env maps.
- Uploaded setup JSON files are normalized server-side and only hydrate local wizard state.
  Persistence still happens on explicit save or install actions.
- Debug mode changes the UI surface.
  Advanced and derived env keys become more visible only when setup status says debug is enabled.
- `ALWAYS_RUNNING` currently includes `noona-moon` and `noona-sage`.
  Those are not normal toggles in the setup service grid.

## Bootstrap And Login State

- Moon no longer supports username/password bootstrap.
  `/api/noona/auth/bootstrap` and `/api/noona/auth/bootstrap/status` both return `410` and point users back to the
  setup summary Discord flow.
- `/signup` is just the login screen.
- Login checks:
  setup completion,
  existing session,
  and Discord OAuth config availability.
- Moon's Discord callback route forwards the OAuth exchange to Sage and writes `noona_session` when a token is
  returned.
- The callback page appends `discordTest=success` or `discordAuth=success` to the return target so the summary or
  login page can show the correct next-state message.

## Setup Completion Bridge

- Moon's `/api/noona/setup/complete` route does two things:
  call Sage bootstrap finalize,
  then fetch and rewrite the Sage wizard state with `completed=true`.
- This is important because the Moon summary page owns the final handoff from "install is ready" to "setup is
  finished" from the browser's perspective.

## AppShell State

- `AppShell.tsx` decides whether Moon shows setup navigation, main navigation, or no shell chrome at all.
- After setup completes, the main shell keeps direct links for `Home`, `Library`, and `Downloads`, exposes request and
  admin groups as the only menus, and surfaces `Add download` as a header action instead of burying it in navigation.
- Setup stays isolated as its own guided mode until completion.
  Do not mix setup entries back into the normal app shell outside the admin resume/setup-summary affordances.
- Current shellless routes are:
  `/login`,
  `/signup`,
  `/discord/callback`,
  and `/rebooting`.
- AppShell separately loads setup status and auth status, then exposes nav entries only when the related permission is
  present.
- The signed-in drawer now includes a `Music` card above `Display`.
  It only renders for the post-setup main shell, persists `moon-music-enabled` and `moon-music-volume` in browser
  `localStorage`, and plays through Moon's `/api/noona/media/background-track` proxy path.
- `AppShell.tsx` and `SiteNotifications.tsx` now share the signed-in route gating helper from
  [../../../services/moon/src/components/noona/moonShellRoutes.mjs](../../../services/moon/src/components/noona/moonShellRoutes.mjs)
  so shell chrome and live toast polling stay aligned across login, reboot, callback, and setup flows.
- `SiteNotifications.tsx` owns all custom in-app toast behavior.
  It still handles service update polling, and now also runs best-effort signed-in polling for recommendation-decision
  and subscription-update toasts, stores per-user seen state in browser storage keyed by `discordUserId` or username,
  and dispatches the internal `noona:open-music-controls` click action for music toasts.
- Mobile navigation is intentionally a single-expansion drawer.
  Keep section headings flat inside each expanded group instead of reintroducing nested accordions or a dense mobile
  mega menu.
- Task navigation comes from
  [../../../services/moon/src/components/noona/settings/settingsRoutes.ts](../../../services/moon/src/components/noona/settings/settingsRoutes.ts),
  not from ad hoc route strings sprinkled across components.

## Reboot Monitor State

- Update-all flow and reboot monitoring persist state in browser `sessionStorage` through
  [../../../services/moon/src/components/noona/rebootMonitorSession.ts](../../../services/moon/src/components/noona/rebootMonitorSession.ts).
- The stored payload tracks:
  target services,
  return path,
  phase,
  service states,
  and stability counters.
- Reboot monitor ordering is intentional.
  Priority currently favors Portal, Raven, Kavita, Komf, Mongo, Redis, Vault, Moon, then Sage.
- If update or restart UX changes, keep the session format and `/rebooting` page aligned.

## Route Availability State

- Route availability is not only filesystem-driven.
  `RouteGuard.tsx` checks `moonRoutes` and dynamic route prefixes from the resources config and can render `not-found`
  for disabled features.
- If a new page is added but should be feature-gated, update the route config as well as the page component.
