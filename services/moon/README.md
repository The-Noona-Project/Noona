# Moon (Noona Stack 2.2)

Moon is the Noona web GUI built with Next.js and Once UI. It renders the primary tabs (`/libraries`, `/downloads`,
`/settings`), setup and auth flows, and the Noona-only service proxy routes consumed by the frontend.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Docker image](../../moon.Dockerfile)
- [Main app router](src/app/)
- [Runtime launcher](scripts/runNext.mjs)
- [Home page](src/app/page.tsx)
- [Libraries page route](src/app/libraries/page.tsx)
- [Downloads page route](src/app/downloads/page.tsx)
- [Settings page route](src/app/settings/page.tsx)
- [Setup wizard route](src/app/setupwizard/page.tsx)
- [Setup summary route](src/app/setupwizard/summary/page.tsx)
- [Discord callback route](src/app/discord/callback/page.tsx)
- [Noona page components](src/components/noona/)
- [Setup wizard component](src/components/noona/SetupWizard.tsx)
- [Setup summary component](src/components/noona/SetupSummaryPage.tsx)
- [Discord callback component](src/components/noona/DiscordCallbackPage.tsx)
- [Header](src/components/Header.tsx)
- [Footer](src/components/Footer.tsx)
- [Noona API routes](src/app/api/noona/)
- [Setup layout proxy](src/app/api/noona/setup/layout/route.ts)
- [Discord auth config proxy](src/app/api/noona/auth/discord/config/route.ts)
- [Discord auth start proxy](src/app/api/noona/auth/discord/start/route.ts)
- [Discord auth callback proxy](src/app/api/noona/auth/discord/callback/route.ts)
- [Managed Kavita key proxy](src/app/api/noona/setup/kavita/service-key/route.ts)
- [Web GUI helpers](src/utils/webGui.ts)
- [Moon UI configuration](src/resources/moon.config.ts)

## Primary UI Areas

- `/` - Home summary and shortcuts into library/download workflows.
- `/libraries` - Library browsing, filtering, and title drill-down.
- `/downloads` - Download queueing, active status, workers summary, and history.
- `/settings` - Service control for managed services with explicit save/restart actions, Portal join-default pickers
  plus Kavita role guidance, Discord access settings, ecosystem restart controls, Warden image-update tooling with
  single-service and update-all actions, Vault-backed persistence for service overrides in `noona_settings`, vault
  tools, a direct Redis Stack Web UI link from the Vault tab, and diagnostics.
- `/setupwizard` - First-run stack configuration flow with storage, integrations, services, and install tabs. It
  previews the shared Noona folder tree, defaults to managed `noona-kavita` and Komf, allows switching either one to
  external URLs, includes a Discord bot login test with client/guild auto-fill for Portal setup, upgrades Portal
  role-id fields into guild-role dropdowns after a successful Discord validation, refreshes those dropdowns for the
  selected guild, auto-provisions the managed Kavita API key into Portal/Raven/Komf after install, and persists the
  selected managed service set for future Warden boots. Portal defaults now prefill `/join` access as `*,-admin` for
  roles and `*` for libraries, and the managed Vault token is injected automatically instead of being entered by hand.
  The install tab now contains the only live-log view, and it is scoped to Warden output for the current install
  session.
- `/setupwizard/summary` - Dedicated post-install review page that lists installed services, descriptions, service URLs,
  the Discord OAuth callback URL, full callback-loop testing, Discord superuser bootstrap, and final setup
  completion.
- `/discord/callback` - Browser callback page for the Discord OAuth round-trip used by setup bootstrap and normal Moon
  login.
- `/login` and `/signup` - Auth entry points for the Discord-first Moon flow. `/login` starts Discord OAuth, and
  `/signup` now redirects back into setup instead of offering username/password signup.
- Title detail pages now surface Kavita series links plus metadata match actions, and the footer can open the active
  Kavita URL directly.

## API Proxy Surface (Moon -> Backend Services)

- `src/app/api/noona/raven/*` - Raven search/download/library/status/history proxies.
- `src/app/api/noona/portal/kavita/*` - Portal-backed Kavita info, title search, and metadata-match proxies.
- `src/app/api/noona/settings/*` - service settings, Portal join option helpers, vault, ecosystem, and debug operations.
- `src/app/api/noona/services/*` - service listing and logs.
- `src/app/api/noona/install/*` and `src/app/api/noona/setup/*` - install/setup state and completion APIs.
- `src/app/api/noona/setup/layout` - setup-wizard proxy for Warden's resolved storage layout tree.
- `src/app/api/noona/setup/discord/validate` - setup-wizard Discord validation proxy for Portal bot credentials.
- `src/app/api/noona/setup/kavita/service-key` - setup-wizard proxy that provisions or reuses the managed Kavita auth
  key after install and applies it to Portal, Raven, and `noona-komf`.
- `src/app/api/noona/auth/discord/*` - Discord OAuth config, flow start, and callback completion.
- `src/app/api/noona/auth/*` - login/logout, session status, and Discord-linked user-management APIs. The legacy
  Moon bootstrap route now returns `410` so username/password signup cannot be used from the Moon web flow anymore.

## Key Environment Variables

- `WEBGUI_PORT` - port Moon binds to for `npm run dev` and `npm run start` (defaults to `3000`).
- `NOONA_LOG_DIR` - optional directory for Moon's runtime `latest.log` file when Warden or local dev runs should
  persist web GUI logs to disk.
- `WARDEN_BASE_URL`, `SAGE_BASE_URL`, `RAVEN_BASE_URL`, `PORTAL_BASE_URL` - optional backend overrides for local
  proxy resolution when default container and host fallbacks are not correct.

## Docker Runtime Notes

- The production image is built from [../../moon.Dockerfile](../../moon.Dockerfile).
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

## Documentation Rule

When tabs, routes, API proxies, package metadata, or major UI flows change, update this README and keep the Quick
Navigation links current so maintainers can jump directly to the updated files.
