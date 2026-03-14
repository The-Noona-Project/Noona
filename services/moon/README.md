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
- [Noona API proxies](src/app/api/noona/)
- [Tests](tests/)

## What Moon Does

- guides admins through first-run setup
- provides the main settings and operations UI
- handles Discord-first login and account management
- surfaces downloads, libraries, subscriptions, and recommendation flows

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
