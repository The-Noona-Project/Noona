# Sage

Sage is Noona's setup, auth, and browser-facing API broker. Moon talks to Sage for setup, login, user management, and
Raven-facing browser actions.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Sage AI docs](../../docs/agents/sage/README.md)
- [Entrypoint](initSage.mjs)
- [Route modules](routes/)
- [Clients](clients/)
- [Raven routes](routes/registerRavenRoutes.mjs)
- [Raven client](clients/ravenClient.mjs)
- [Tests](tests/)

## What Sage Does

- proxies setup and service-management requests to Warden
- owns Discord OAuth and Moon auth flows
- brokers browser-facing Raven and settings APIs
- talks to Vault through the stack's trusted internal HTTPS path in managed installs
- preserves Raven's real queue status and message for Moon instead of flattening every queue response into a generic
  success
- normalizes backend failures into UI-friendly responses

## Who It Is For

- Server admins troubleshooting setup or login
- Contributors working on auth, setup, or browser-facing service APIs

## When An Admin Needs To Care

- when Moon setup or Discord login fails
- when user management or default permissions behave unexpectedly
- when browser-facing Raven actions fail even though Raven is online

## How It Fits Into Noona

Sage sits between Moon and the rest of the stack. Admins usually encounter it indirectly through Moon rather than as a
standalone service.

## Next Steps

- Admin install and operations: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/sage/README.md](../../docs/agents/sage/README.md)
