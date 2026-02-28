# Moon (Noona Stack 2.2)

Moon is the Noona web GUI built with Next.js and Once UI. It renders the primary tabs (`/libraries`, `/downloads`,
`/settings`), setup and auth flows, and service proxy routes consumed by the frontend.

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
- [Noona page components](src/components/noona/)
- [Header](src/components/Header.tsx)
- [Footer](src/components/Footer.tsx)
- [Noona API routes](src/app/api/noona/)
- [Web GUI helpers](src/utils/webGui.ts)
- [Once UI configuration](src/resources/once-ui.config.ts)

## Primary UI Areas

- `/` - Home summary and shortcuts into library/download workflows.
- `/libraries` - Library browsing, filtering, and title drill-down.
- `/downloads` - Download queueing, active status, workers summary, and history.
- `/settings` - Service control for managed services with explicit save/restart actions, Portal join-default pickers
  plus Kavita role guidance, Discord access settings, ecosystem restart controls, Warden image-update tooling with
  single-service and update-all actions, Vault-backed persistence for service overrides in `noona_settings`, vault
  tools, and diagnostics.
- `/setupwizard` - First-run stack configuration flow that persists the selected service set for future Warden boots.

## API Proxy Surface (Moon -> Backend Services)

- `src/app/api/noona/raven/*` - Raven search/download/library/status/history proxies.
- `src/app/api/noona/settings/*` - service settings, Portal join option helpers, vault, ecosystem, and debug operations.
- `src/app/api/noona/services/*` - service listing and logs.
- `src/app/api/noona/install/*` and `src/app/api/noona/setup/*` - install/setup state and completion APIs.
- `src/app/api/noona/auth/*` - bootstrap, login/logout, and user APIs.

## Key Environment Variables

- `WEBGUI_PORT` - port Moon binds to for `npm run dev` and `npm run start` (defaults to `3000`).

## Docker Runtime Notes

- The production image is built from [../../moon.Dockerfile](../../moon.Dockerfile).
- The runner stage must include [scripts/runNext.mjs](scripts/runNext.mjs) plus the MDX content folders under
  [src/app/blog/posts](src/app/blog/posts) and [src/app/work/projects](src/app/work/projects), because Moon reads those
  files from disk at runtime for the blog, work, RSS, and sitemap routes.

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

When tabs, routes, API proxies, or major UI flows change, update this README and keep the Quick Navigation links current
so maintainers can jump directly to the updated files.
