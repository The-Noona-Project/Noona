# Sage (Noona Stack 2.2)

Sage is the setup and proxy service for Noona. It fronts Warden install APIs, Discord setup helpers, and Raven
download/library routes for Moon and other clients.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Entrypoint](initSage.mjs)
- [App builder](app/createSageApp.mjs)
- [Setup client](app/createSetupClient.mjs)
- [Route modules](routes/)
- [Auth routes](routes/registerAuthRoutes.mjs)
- [Setup routes](routes/registerSetupRoutes.mjs)
- [Downstream clients](clients/)
- [Wizard state](wizard/)
- [Tests](tests/)
- [Root docs](../../docs/)

## Core Responsibilities

- Proxy setup/install/status requests to Warden.
- Expose Discord setup validation helpers for Portal onboarding.
- Own Moon auth state, Discord OAuth config, Discord callback handling, and Discord-linked user/session management.
- Proxy Raven search/download/library/status routes.
- Normalize downstream failures into consistent API responses.

## Common Endpoint Groups

- Setup: `/api/setup/*`
- Discord setup helpers: `/api/setup/services/noona-portal/discord/*`
    - validation now performs a real bot login, returns the detected application/client id, lists accessible guilds, and
      loads roles/channels when a guild is selected.
- Moon auth and Discord OAuth: `/api/auth/*`
    - `/api/auth/discord/config` stores the Discord OAuth client id/secret used by Moon setup and login.
    - `/api/auth/discord/start` creates a full Discord OAuth round-trip for callback testing, setup bootstrap, or normal
      Moon login.
    - `/api/auth/discord/callback` exchanges the code with Discord, records callback tests, bootstraps the first admin,
      and signs in Discord-linked Moon users.
- Raven proxy: `/api/raven/*`

## Key Environment Variables

| Variable                                       | Purpose                                  |
|------------------------------------------------|------------------------------------------|
| `API_PORT`                                     | Sage listener port (defaults in runtime) |
| `SERVICE_NAME`                                 | Service label used in logs               |
| `WARDEN_BASE_URL`                              | Preferred Warden base URL override       |
| `RAVEN_BASE_URL`                               | Preferred Raven base URL override        |
| `RAVEN_INTERNAL_BASE_URL` / `RAVEN_DOCKER_URL` | Additional Raven discovery overrides     |

## Local Commands

```bash
cd services/sage
npm install
npm run start
npm test
```

## Documentation Rule

When adding or changing Sage routes, update this README and include links to the exact route/client files touched so
Moon and platform maintainers can trace behavior quickly.
