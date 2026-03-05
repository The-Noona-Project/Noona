# Moon (Noona Stack 2.2)

Moon is the Noona web GUI built with Next.js and Once UI. It renders the primary tabs (`/libraries`, `/downloads`,
the `/settings/*` route family), setup and auth flows, and the Noona-only service proxy routes consumed by the
frontend.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Docker image](../../dockerfiles/moon.Dockerfile)
- [Main app router](src/app/)
- [Runtime launcher](scripts/runNext.mjs)
- [ESLint config](eslint.config.mjs)
- [Home page](src/app/page.tsx)
- [Libraries page route](src/app/libraries/page.tsx)
- [Downloads page route](src/app/downloads/page.tsx)
- [Downloads modal](src/components/noona/DownloadsAddModal.tsx)
- [Rebooting page route](src/app/rebooting/page.tsx)
- [Settings landing redirect](src/app/settings/page.tsx)
- [Settings route group](src/app/settings/[...slug]/page.tsx)
- [Settings navigation components](src/components/noona/settings/)
- [Setup wizard route](src/app/setupwizard/page.tsx)
- [Setup summary route](src/app/setupwizard/summary/page.tsx)
- [Discord callback route](src/app/discord/callback/page.tsx)
- [Noona page components](src/components/noona/)
- [Rebooting page component](src/components/noona/RebootingPage.tsx)
- [Setup wizard component](src/components/noona/SetupWizard.tsx)
- [Shared config editor styles](src/components/noona/ConfigEditor.module.scss)
- [Setup summary component](src/components/noona/SetupSummaryPage.tsx)
- [Discord callback component](src/components/noona/DiscordCallbackPage.tsx)
- [Shared Raven title card](src/components/noona/RavenTitleCard.tsx)
- [Title detail page component](src/components/noona/TitleDetailPage.tsx)
- [App shell](src/components/AppShell.tsx)
- [Header](src/components/Header.tsx)
- [Footer](src/components/Footer.tsx)
- [Noona API routes](src/app/api/noona/)
- [Install history proxy](src/app/api/noona/install/history/route.ts)
- [Home latest-titles proxy](src/app/api/noona/raven/library/latest/route.ts)
- [Setup layout proxy](src/app/api/noona/setup/layout/route.ts)
- [Discord auth config proxy](src/app/api/noona/auth/discord/config/route.ts)
- [Discord auth start proxy](src/app/api/noona/auth/discord/start/route.ts)
- [Discord auth callback proxy](src/app/api/noona/auth/discord/callback/route.ts)
- [Managed Kavita key proxy](src/app/api/noona/setup/kavita/service-key/route.ts)
- [Web GUI helpers](src/utils/webGui.ts)
- [Permission helpers](src/utils/moonPermissions.ts)
- [Moon UI configuration](src/resources/moon.config.ts)

## Primary UI Areas

- `/` - Home summary and shortcuts into library/download workflows. Recent titles now reuse the same cover-card tiles
  as the main library page so the landing screen and `/libraries` stay visually consistent, and signed-in users
  without `library_management` can still see the latest titles there even though the cards stay non-clickable.
- `/libraries` - Library browsing, filtering, and title drill-down. The tab and direct page now require the
  `library_management` permission.
- `/downloads` - Download queueing, active status, workers summary, and history. The tab and direct page now require
  the `download_management` permission, and the add-download flow now uses a centered modal with a dedicated
  search/select/queue layout instead of the old inline overlay. The page now also prioritizes Raven's persisted
  current-task snapshot, including recovery state, remaining queued chapters, and the new-vs-missing split that Raven
  discovered for the active task. The top task panel now rotates through every live Raven task like a slide deck, and
  both the active-download and history grids scale with Moon's selected `desktop` / `ultrawide` / `mobile` view mode.
- `/rebooting` - Internal transition screen used by Warden `Update all`. The settings page now forces a fresh image
  check before launching it, and the reboot monitor persists its queue state in browser session storage so interrupted
  Moon reloads can resume the same update pass instead of starting blind. It also waits for Redis alongside Warden,
  Vault, Sage, and Moon before retrying authenticated update calls, then shows live service health while the stack
  settles.
- `/settings/*` - Route-based settings pages such as `/settings/general`, `/settings/moon`, `/settings/raven`,
  `/settings/usermanagement`, and `/settings/portal/discord`. These pages provide service control for managed
  services with explicit save/restart actions, Portal join-default pickers plus Kavita role guidance, Discord access
  settings, Portal subpages for `Discord`, `Kavita`, and `Komf`, a managed Komf `/config/application.yml` editor with
  provider ordering/toggles plus inline `malClientId` and `comicVineApiKey` fields when those providers are enabled,
  and the managed Komf reset/default template now mirrors the current Komf sample by enabling only MangaUpdates by
  default,
  ecosystem restart controls, a Warden runtime-settings panel for `SERVER_IP` host-facing links plus the
  `AUTO_UPDATES` startup-image toggle, Warden image-update tooling with single-service and update-all actions,
  Vault-backed persistence for service overrides in `noona_settings`,
  vault tools, a direct Redis Stack Web UI link from the Vault page using Warden's host-facing service URL metadata,
  default permissions for first-time Discord sign-ins, per-thread Raven speed limits, and diagnostics.
  Successful self-permission edits now update the local user-management state first so Moon does not report a false
  save failure when the change intentionally removes that account's `user_management` access. The Moon permission
  editor now exposes the canonical `library_management` and `download_management` roles while still normalizing the
  legacy Raven permission names returned by older records. Raven worker speed-limit inputs now accept raw KB/s values
  or `mb` / `gb` suffixes, and `-1` means unlimited speed. Moon's Portal-backed Kavita metadata-match proxy now also
  preserves compact Portal `500` responses for metadata failures instead of collapsing them into a large multi-backend
  error string.
- `/setupwizard` - First-run stack configuration flow with storage, integrations, services, and install tabs. It
  previews the shared Noona folder tree, defaults to managed `noona-kavita` and Komf, allows switching either one to
  external URLs, includes a Discord bot login test with client/guild auto-fill for Portal setup, upgrades Portal
  role-id fields into guild-role dropdowns after a successful Discord validation, refreshes those dropdowns for the
  selected guild, collects the first managed Kavita admin username/email/password with password confirmation,
  auto-provisions the managed Kavita API key into Portal/Raven/Komf after install, pushes those credentials into
  managed `noona-kavita` as
  `KAVITA_ADMIN_USERNAME`, `KAVITA_ADMIN_EMAIL`, and `KAVITA_ADMIN_PASSWORD`, and persists the selected managed
  service set for future Warden boots. The integrations step now exposes the managed Komf `application.yml` content so
  metadata providers can be tuned before install, starting from the safer MangaUpdates-only default template. The
  services tab groups the managed stack into `Storage`, `Library
  Management`, and `External APIs`, and install payloads follow the Warden lifecycle order (`mongo -> redis -> vault
  -> kavita -> raven -> komf -> portal`). Portal defaults now prefill `/join` access as `*,-admin` for roles and `*`
  for libraries, and the managed Vault token is injected automatically instead of being entered by hand. The install
  tab now starts installs asynchronously, keeps progress polling even if the original request fails after Warden has
  started, reads the current installation-session history instead of generic `noona-warden` service logs, excludes
  generated runtime-only values such as Vault tokens and managed Kavita API keys from setup JSON download/upload,
  waits longer for the post-install managed Kavita key provisioning step to finish restarting dependent services, and
  exposes a manual `Continue to summary` action if the automatic redirect needs to be retried.
- `/setupwizard/summary` - Dedicated post-install review page that lists installed services, descriptions, service URLs,
  the Discord OAuth callback URL, full callback-loop testing, Discord superuser bootstrap, and final setup
  completion.
- `/discord/callback` - Browser callback page for the Discord OAuth round-trip used by setup bootstrap and normal Moon
  login.
- `/login` and `/signup` - Auth entry points for the Discord-first Moon flow. Both now render the same
  sign-in-or-create-account screen, the main tab bar is hidden there, and first-time Discord sign-in creates the user
  from Sage's default permission template.
- Title detail pages now surface Kavita series links plus metadata match actions, and the footer prefers Warden's
  host-facing managed Kavita URL before falling back to Portal's configured external Kavita base URL. The title-page
  `Open in Kavita` action and each inline Kavita search-result `Open` button now rebuild the series link from
  Warden's host-facing `noona-kavita` URL so they follow the configured `SERVER_IP`. Moon's metadata-match request now
  also forwards the active title query to Portal/Kavita so Komf-backed lookup does not fail on a null query. The
  metadata button now opens a centered confirmation modal that lists returned Komf candidates before applying the
  selected match, and
  applying a Kavita metadata match from the title page still sends the Raven title UUID so Portal can lock Kavita to
  the same Noona cover art that Moon is rendering for that title. Title detail pages now also show Raven's stored
  downloaded-chapter index, the exact latest new/missing chapter plan returned by `Check new/missing`, and the live
  cached Raven task when that task belongs to the current title.
- Moon now uses a permission-aware top header plus a slide-out navigation drawer for `Home`, `Library`, `Downloads`,
  and `Settings` instead of the old fixed top tab strip. Settings keeps its own nested settings-only sub-navigation
  inside the page content, the drawer now opens with the signed-in account card and close control at the top, and it
  still holds the light/dark theme toggle plus a three-mode viewport switch for `desktop`, `ultrawide`, and `mobile`
  framing without pinning the whole page off-center.

## API Proxy Surface (Moon -> Backend Services)

- `src/app/api/noona/raven/*` - Raven search/download/library/status/history proxies. The dedicated
  `src/app/api/noona/raven/library/latest` feed keeps the Home page's latest-title cards visible for signed-in users
  who do not have `library_management`, while full library/title navigation still stays permission-gated.
- `src/app/api/noona/portal/kavita/*` - Portal-backed Kavita info, title search, and metadata-match proxies.
- `src/app/api/noona/settings/*` - service settings, Portal join option helpers, vault, ecosystem, and debug operations.
- `src/app/api/noona/settings/downloads/workers` - proxy for Raven per-thread speed-limit settings stored by Sage.
  Moon accepts plain KB/s numbers plus `mb` / `gb` suffixes here, and uses `-1` for unlimited workers.
- `src/app/api/noona/services/*` - service listing and logs.
- `src/app/api/noona/services/[name]/health` - Warden-backed per-service health proxy used by the reboot monitor.
- `src/app/api/noona/install/*` and `src/app/api/noona/setup/*` - install/setup state, installation history, and
  completion APIs. The setup-complete proxy now preserves upstream wizard-state failures and forwards the active Noona
  auth headers when it persists the final selected-service list.
- `src/app/api/noona/setup/layout` - setup-wizard proxy for Warden's resolved storage layout tree.
- `src/app/api/noona/setup/discord/validate` - setup-wizard Discord validation proxy for Portal bot credentials.
- `src/app/api/noona/setup/kavita/service-key` - setup-wizard proxy that provisions or reuses the managed Kavita auth
  key after install, optionally creates or logs into the first Kavita admin account from setup-wizard credentials, and
  applies the resulting key to Portal, Raven, and `noona-komf`.
- `src/app/api/noona/auth/discord/*` - Discord OAuth config, flow start, and callback completion.
- `src/app/api/noona/auth/*` - login/logout, session status, and Discord-linked user-management APIs. The legacy
  Moon bootstrap route now returns `410` so username/password signup cannot be used from the Moon web flow anymore, and
  `src/app/api/noona/auth/users/default-permissions` now proxies the first-login permission template editor.

## Key Environment Variables

- `WEBGUI_PORT` - port Moon binds to for `npm run dev` and `npm run start` (defaults to `3000`).
- `NOONA_LOG_DIR` - optional directory for Moon's runtime `latest.log` file when Warden or local dev runs should
  persist web GUI logs to disk.
- `WARDEN_BASE_URL`, `SAGE_BASE_URL`, `RAVEN_BASE_URL`, `PORTAL_BASE_URL` - optional backend overrides for local
  proxy resolution when default container and host fallbacks are not correct.

## Docker Runtime Notes

- The production image is built from [../../dockerfiles/moon.Dockerfile](../../dockerfiles/moon.Dockerfile).
- The runner stage needs the compiled `.next` output, [public](public), [next.config.mjs](next.config.mjs), and
  [scripts/runNext.mjs](scripts/runNext.mjs). Moon no longer ships the old portfolio MDX content tree.

## Local Commands

```bash
cd services/moon
npm install
npm run dev
npm run lint
npm run build
npm run start
```

Set `WEBGUI_PORT` before `npm run dev` or `npm run start` when Moon should bind to a non-default port.
`npm run lint` uses the flat ESLint config in [eslint.config.mjs](eslint.config.mjs).

## Documentation Rule

When tabs, routes, API proxies, package metadata, or major UI flows change, update this README and keep the Quick
Navigation links current so maintainers can jump directly to the updated files.
