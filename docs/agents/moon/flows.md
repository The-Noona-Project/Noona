# Moon Flows

## First-Run Setup Wizard

- The setup wizard loads four things in parallel:
  the installable service catalog, storage layout, persisted setup snapshot, and setup status.
- The catalog fetch is cold-start tolerant.
  Moon retries transient `502`, `503`, and `504` responses from `/api/noona/services` for a short bounded window so
  Warden warm-up does not strand the wizard on the first load.
- Moon hydrates its local wizard state from the persisted v3 snapshot through
  [../../../services/moon/src/components/noona/setupProfile.mjs](../../../services/moon/src/components/noona/setupProfile.mjs).
- The flow stays task-based:
  storage, integrations, service review, then install.
- Moon persists the setup snapshot with `apply: false` before install and before summary navigation.
  Warden remains responsible for deriving the actual managed-service plan from the saved profile.
- Managed integrations are implicit.
  `deriveSetupProfileSelection()` always includes Portal and Raven, and adds Kavita or Komf when those modes are
  managed.
- Import/export is snapshot-based.
  Moon downloads the normalized setup JSON, and uploaded files are first normalized through Sage and Warden before the
  wizard hydrates local review state.
- The install request is intentionally snapshot-driven.
  After validation and persistence, Moon calls `/api/noona/install` with an empty selection body and then monitors the
  async progress stream.

## Summary, Discord Test, And Final Setup Completion

- `openSetupSummary()` in the wizard does three critical things before navigation:
  provision the managed Kavita service key when needed, save Discord OAuth config with retries, and persist the latest
  setup snapshot.
- Once install is already complete, those live Kavita or Discord sync calls downgrade to one-shot summary warnings.
  Snapshot persistence still blocks, but post-install sync failures no longer strand the user on the install tab.
- `install()` does not run the live Kavita or Discord preflight.
  It validates the form, persists the final snapshot, and lets Warden handle managed Kavita provisioning during the
  install lifecycle after `noona-kavita` is running.
- The summary page loads live services, persisted config, auth status, and setup status together.
- Discord OAuth on the summary page has two Moon-facing modes:
  `test` to validate the callback path and `bootstrap` to create the first admin.
- Moon's old username/password bootstrap routes intentionally return `410`.
  Setup summary plus Discord OAuth is the only supported Moon bootstrap path now.
- Moon's `/api/noona/setup/complete` route finalizes the pending admin through Sage and then marks the wizard state as
  `completed`.
  This is a UI-owned completion bridge, not a direct Warden install action.

## Login, Session, And Kavita Handoff

- Login is Discord-first.
  `LoginPage.tsx` checks setup status, existing auth status, and Discord OAuth config before presenting the login
  button.
- The Discord callback page posts `code` and `state` to Moon's auth callback route, which forwards to Sage and writes
  the `noona_session` cookie when a token comes back.
- Logout clears the cookie even if Sage logout fails.
  This keeps the browser state recoverable during backend issues.
- `/signup` is currently just an alias of `/login`.
- The Kavita bridge is separate from Moon login.
  Moon checks the current Noona session through Sage, requests a Portal-issued Kavita token, validates the target URL
  stays under the trusted Kavita origin, and then redirects the browser to Kavita's `/login` endpoint.

## Settings, Service Updates, And Reboot Monitor

- Moon settings are task-based, not service-first.
  `settingsRoutes.ts` maps views like `overview`, `filesystem`, `database`, `downloader`, `updater`, `discord`,
  `kavita`, `komf`, and `users`.
- The settings page handles ecosystem actions, service updates, service config edits, user management, Vault views,
  and download tuning through Moon API routes that forward into Sage.
- Admin service-config saves must stay narrow.
  Moon should only send editable keys that are explicitly modeled in Warden's `envConfig` (`readOnly !== true` and
  `serverManaged !== true`), while preserving masked secret placeholders and intentional blank clears.
  Do not round-trip the full redacted `env` snapshot back into Sage or Warden.
- `updateAllImages()` writes reboot-monitor session state into `sessionStorage` and redirects to `/rebooting`.
- The reboot monitor page watches both target services and core recovery services such as Warden, Redis, Vault, Moon,
  and Sage until the stack is stable enough to return to settings.
- Admin docs matter here.
  If task labels, route names, or the update-monitor flow change, update the public Moon README and
  [../../../ServerAdmin.md](../../../ServerAdmin.md).

## Downloads, Recommendations, And Home Feed

- Home page access is gated by setup completion and auth, then loads the latest Raven titles for the landing feed.
- Downloads are stricter than naive HTTP success checks.
  Moon only treats a queue attempt as accepted when the response is HTTP `202` and Raven returns queue status
  `queued` or `partial`.
- Failed Raven queue attempts remain visible in the UI and failed options stay selected in `DownloadsAddPage.tsx`.
- Recommendation, subscription, and Raven title actions all flow through Moon's server routes into Sage so the browser
  never needs a direct Sage token.
