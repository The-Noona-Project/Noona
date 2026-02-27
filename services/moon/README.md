# Moon (Noona Stack 2.2)

Moon is the Noona web GUI built with Next.js and Once UI. It renders the primary tabs (`/libraries`, `/downloads`,
`/settings`), setup and auth flows, and service proxy routes consumed by the frontend.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Main app router](src/app/)
- [Home page](src/app/page.tsx)
- [Libraries page route](src/app/libraries/page.tsx)
- [Downloads page route](src/app/downloads/page.tsx)
- [Settings page route](src/app/settings/page.tsx)
- [Noona page components](src/components/noona/)
- [Header](src/components/Header.tsx)
- [Footer](src/components/Footer.tsx)
- [Noona API routes](src/app/api/noona/)
- [Once UI configuration](src/resources/once-ui.config.ts)

## Primary UI Areas

- `/` - Home summary and shortcuts into library/download workflows.
- `/libraries` - Library browsing, filtering, and title drill-down.
- `/downloads` - Download queueing, active status, workers summary, and history.
- `/settings` - Service control, ecosystem actions, vault tools, and diagnostics.
- `/setupwizard` - First-run stack configuration flow.

## API Proxy Surface (Moon -> Backend Services)

- `src/app/api/noona/raven/*` - Raven search/download/library/status/history proxies.
- `src/app/api/noona/settings/*` - service settings, vault, ecosystem, and debug operations.
- `src/app/api/noona/services/*` - service listing and logs.
- `src/app/api/noona/install/*` and `src/app/api/noona/setup/*` - install/setup state and completion APIs.
- `src/app/api/noona/auth/*` - bootstrap, login/logout, and user APIs.

## Local Commands

```bash
cd services/moon
npm install
npm run dev
npm run lint
npm run build
npm run start
```

## Documentation Rule

When tabs, routes, API proxies, or major UI flows change, update this README and keep the Quick Navigation links current
so maintainers can jump directly to the updated files.
