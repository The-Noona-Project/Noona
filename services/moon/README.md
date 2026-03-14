# Moon

Moon is the main Noona web app. It handles first-run setup, login, settings, user management, downloads,
recommendations, and the day-to-day admin UI.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Moon AI docs](../../docs/agents/moon/README.md)
- [App routes](src/app/)
- [Noona UI components](src/components/noona/)
- [Downloads add page](src/components/noona/DownloadsAddPage.tsx)
- [Download queue result helper](src/components/noona/downloadQueueResults.mjs)
- [Noona API proxies](src/app/api/noona/)
- [Tests](tests/)

## What Moon Does

- guides admins through first-run setup
- provides the main settings and operations UI
- keeps post-setup navigation task-based with `Home`, `Library`, `Downloads`, `Requests`, `Admin`, and a header
  `Add download` action when permitted
- handles Discord-first login and account management
- surfaces downloads, libraries, subscriptions, and recommendation flows
- treats Raven download queue attempts as successful only when Raven explicitly accepts them, so expired or invalid
  search selections stay visible as real errors

## Who It Is For

- Server admins and moderators
- Noona users signing in through Discord

## When An Admin Needs To Care

- during first-run setup
- when managing users, roles, service links, and updates
- when troubleshooting setup, login, or UI-driven service actions

## How It Fits Into Noona

Moon is the public face of the stack. Warden runs the services, Sage brokers browser-facing APIs, and Moon turns those
capabilities into the supported admin workflow.

## Next Steps

- Install and run Noona: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/moon/README.md](../../docs/agents/moon/README.md)
