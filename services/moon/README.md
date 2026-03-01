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
- [Noona page components](src/components/noona/)
- [Setup wizard component](src/components/noona/SetupWizard.tsx)
- [Header](src/components/Header.tsx)
- [Footer](src/components/Footer.tsx)
- [Noona API routes](src/app/api/noona/)
- [Setup layout proxy](src/app/api/noona/setup/layout/route.ts)
- [Web GUI helpers](src/utils/webGui.ts)
- [Moon UI configuration](src/resources/moon.config.ts)

## Primary UI Areas

- `/` - Home summary and shortcuts into library/download workflows.
- `/libraries` - Library browsing, filtering, and title drill-down.
- `/downloads` - Download queueing, active status, workers summary, and history.
- `/settings` - Service control for managed services with explicit save/restart actions, Portal join-default pickers
  plus Kavita role guidance, Discord access settings, ecosystem restart controls, Warden image-update tooling with
  single-service and update-all actions, Vault-backed persistence for service overrides in `noona_settings`, vault
  tools, and diagnostics.
- `/setupwizard` - First-run stack configuration flow with storage, integrations, services, and install tabs. It
  previews the shared Noona folder tree, defaults to managed Kavita and Komf, allows switching either one to external
  URLs, and persists the selected managed service set for future Warden boots.
- `/login` and `/signup` - Moon auth entry points backed by Sage auth proxies.

## API Proxy Surface (Moon -> Backend Services)

- `src/app/api/noona/raven/*` - Raven search/download/library/status/history proxies.
- `src/app/api/noona/settings/*` - service settings, Portal join option helpers, vault, ecosystem, and debug operations.
- `src/app/api/noona/services/*` - service listing and logs.
- `src/app/api/noona/install/*` and `src/app/api/noona/setup/*` - install/setup state and completion APIs.
- `src/app/api/noona/setup/layout` - setup-wizard proxy for Warden's resolved storage layout tree.
- `src/app/api/noona/auth/*` - bootstrap, login/logout, and user APIs.

## Key Environment Variables

- `WEBGUI_PORT` - port Moon binds to for `npm run dev` and `npm run start` (defaults to `3000`).
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
