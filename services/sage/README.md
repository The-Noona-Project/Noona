# Sage (Noona Stack 2.2)

Sage is the setup and proxy service for Noona. It fronts Warden install APIs, Discord setup helpers, and Raven
download/library routes for Moon and other clients.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Entrypoint](initSage.mjs)
- [App builder](shared/sageApp.mjs)
- [Route modules](routes/)
- [Tests](tests/)
- [Root docs](../../docs/)

## Core Responsibilities

- Proxy setup/install/status requests to Warden.
- Expose Discord setup validation helpers for Portal onboarding.
- Proxy Raven search/download/library/status routes.
- Normalize downstream failures into consistent API responses.

## Common Endpoint Groups

- Setup: `/api/setup/*`
- Discord setup helpers: `/api/setup/services/noona-portal/discord/*`
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
