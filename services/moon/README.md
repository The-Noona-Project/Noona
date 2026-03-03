# Moon (Noona Stack 2.2)

Moon is the Noona web GUI built with Next.js and Once UI. It renders the primary tabs (`/libraries`, `/downloads`,
`/settings`), setup and auth flows, and the Noona-only service proxy routes consumed by the frontend.

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
- [Rebooting page route](src/app/rebooting/page.tsx)
- [Settings page route](src/app/settings/page.tsx)
- [Setup wizard route](src/app/setupwizard/page.tsx)
- [Setup summary route](src/app/setupwizard/summary/page.tsx)
- [Discord callback route](src/app/discord/callback/page.tsx)
- [Noona page components](src/components/noona/)
- [Rebooting page component](src/components/noona/RebootingPage.tsx)
- [Setup wizard component](src/components/noona/SetupWizard.tsx)
- [Setup summary component](src/components/noona/SetupSummaryPage.tsx)
- [Discord callback component](src/components/noona/DiscordCallbackPage.tsx)
- [Header](src/components/Header.tsx)
- [Footer](src/components/Footer.tsx)
- [Noona API routes](src/app/api/noona/)
- [Install history proxy](src/app/api/noona/install/history/route.ts)
- [Setup layout proxy](src/app/api/noona/setup/layout/route.ts)
- [Discord auth config proxy](src/app/api/noona/auth/discord/config/route.ts)
- [Discord auth start proxy](src/app/api/noona/auth/discord/start/route.ts)
- [Discord auth callback proxy](src/app/api/noona/auth/discord/callback/route.ts)
- [Managed Kavita key proxy](src/app/api/noona/setup/kavita/service-key/route.ts)
- [Web GUI helpers](src/utils/webGui.ts)
- [Permission helpers](src/utils/moonPermissions.ts)
- [Moon UI configuration](src/resources/moon.config.ts)

## Primary UI Areas

- `/` - Home summary and shortcuts into library/download workflows.
- `/libraries` - Library browsing, filtering, and title drill-down. The tab and direct page now require the
  `library_management` permission.
- `/downloads` - Download queueing, active status, workers summary, and history. The tab and direct page now require
  the `download_management` permission.
- `/rebooting` - Internal transition screen used by Warden `Update all`. It keeps a dedicated reboot monitor open,
  retries interrupted service-image updates after Moon comes back, and shows live service health while the stack
  settles.
- `/settings` - Service control for managed services with explicit save/restart actions, Portal join-default pickers
  plus Kavita role guidance, Discord access settings, ecosystem restart controls, Warden image-update tooling with
  single-service and update-all actions, Vault-backed persistence for service overrides in `noona_settings`, vault
  tools, a direct Redis Stack Web UI link from the Vault tab using Warden's host-facing service URL metadata, default
  permissions for first-time Discord sign-ins, per-thread Raven speed limits, and diagnostics.
  Successful self-permission edits now update the local user-management state first so Moon does not report a false
  save failure when the change intentionally removes that account's `user_management` access. The Moon permission
  editor now exposes the canonical `library_management` and `download_management` roles while still normalizing the
  legacy Raven permission names returned by older records. Raven worker speed-limit inputs now accept raw KB/s values
  or `mb` / `gb` suffixes, and `-1` means unlimited speed.
- `/setupwizard` - First-run stack configuration flow with storage, integrations, services, and install tabs. It
  previews the shared Noona folder tree, defaults to managed `noona-kavita` and Komf, allows switching either one to
  external URLs, includes a Discord bot login test with client/guild auto-fill for Portal setup, upgrades Portal
  role-id fields into guild-role dropdowns after a successful Discord validation, refreshes those dropdowns for the
  selected guild, collects the first managed Kavita admin username/email/password with password confirmation,
  auto-provisions the managed Kavita API key into Portal/Raven/Komf after install, pushes those credentials into
  managed `noona-kavita` as
  `KAVITA_ADMIN_USERNAME`, `KAVITA_ADMIN_EMAIL`, and `KAVITA_ADMIN_PASSWORD`, and persists the selected managed
  service set for future Warden boots. The services tab now groups the managed stack into `Storage`, `Library
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
  host-facing managed Kavita URL before falling back to Portal's configured external Kavita base URL.
- The header now keeps `Settings` inside the top-right account bubble with the user's Discord avatar and a `Logout`
  action instead of showing `Settings` in the main tab strip. Moon also suppresses the setup/main navigation pill until
  setup status resolves so completed stacks do not briefly flash the Setup tab on first load.

## API Proxy Surface (Moon -> Backend Services)

- `src/app/api/noona/raven/*` - Raven search/download/library/status/history proxies.
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
