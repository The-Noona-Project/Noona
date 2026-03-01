# Warden (Noona Stack 2.2)

Warden is the orchestrator for the Noona stack. It manages container descriptors, install order, service health checks,
log streaming, and lifecycle APIs.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Entrypoint](initWarden.mjs)
- [Core factory](core/createWarden.mjs)
- [Service management API registration](core/registerServiceManagementApi.mjs)
- [Diagnostics API registration](core/registerDiagnosticsApi.mjs)
- [Boot API registration](core/registerBootApi.mjs)
- [HTTP API server](api/startWardenServer.mjs)
- [Core descriptors](docker/noonaDockers.mjs)
- [Addon descriptors](docker/addonDockers.mjs)
- [Storage layout helpers](docker/storageLayout.mjs)
- [Docker helpers](docker/dockerUtilties.mjs)
- [Setup wizard helpers](setup/)
- [Tests](tests/)

## Start Modes

### Minimal mode

Starts the baseline dev set quickly.
```bash
cd services/warden
DEBUG=false node initWarden.mjs
```

### Super mode

Starts the full dependency chain.
```bash
cd services/warden
DEBUG=super node initWarden.mjs
```

When setup has been completed, normal Warden boot now restores the persisted setup selection in lifecycle order
instead of blindly starting every registered service.

## Main API Endpoints

- `GET /health` - Warden process health.
- `GET /api/services` - service catalog + status.
- `GET /api/storage/layout` - resolved Noona storage root plus per-service host/container folder mappings.
- `POST /api/services/install` - install/start one or more services. Add `?async=true` to accept the install in the
  background and return `202` with the current progress snapshot instead of holding the request open.
- `GET /api/services/install/progress` - current installation timeline.
- `GET /api/services/installation/logs` - buffered installation-session history with summary status/progress.
- `GET /api/services/:name/logs` - buffered log output.
- `POST /api/services/:name/test` - service-level diagnostics.

## Key Environment Variables

| Variable           | Purpose                                                                               | Default                                                   |
|--------------------|---------------------------------------------------------------------------------------|-----------------------------------------------------------|
| `DEBUG`            | Boot profile + log verbosity                                                          | `false`                                                   |
| `WARDEN_API_PORT`  | Warden API listen port                                                                | `4001`                                                    |
| `HOST_SERVICE_URL` | Host-facing URL prefix used in generated links                                        | `http://localhost`                                        |
| `NOONA_DATA_ROOT`  | Shared host root for Raven, Vault, Kavita, `noona-komf`, and reserved service folders | `%APPDATA%\noona` on Windows, `/mnt/user/noona` elsewhere |
| `WEBGUI_PORT`      | Moon web GUI port injected into `noona-moon`                                          | `3000`                                                    |
| `RAVEN_VAULT_URL`  | Vault URL injected into Raven runtime                                                 | `http://noona-vault:3005`                                 |
| `KAVITA_ADMIN_*`   | Optional managed `noona-kavita` first-admin defaults passed through on install/start  | unset                                                     |
| `*_VAULT_TOKEN`    | Optional per-service token override                                                   | generated in descriptors                                  |

## Development Commands

- Start: `npm run start`
- Dev watch mode: `npm run dev`
- Tests: `npm test`

## Notes

- Warden tracks service histories and buffered logs for diagnostics.
- Vault token maps are generated from descriptor lists in `docker/noonaDockers.mjs`.
- Warden now resolves a shared Noona host root and pre-creates the expected tree before service launch. Redis and
  Mongo mount under the Vault folder (`vault/redis` and `vault/mongo` by default), Raven uses `raven/downloads`,
  managed `noona-kavita` uses `kavita/config` plus the Raven download share, and managed `noona-komf` uses
  `komf/config`.
- Managed Moon, Portal, Raven, Sage, and Vault installs now also mount dedicated log folders from the shared Noona
  root and inject `NOONA_LOG_DIR` so each service writes a persistent `latest.log` file outside the container.
- `WEBGUI_PORT` is consumed by Warden's Moon descriptor and passed through to Moon so the UI listens and publishes on
  the same port.
- Managed Kavita now depends on Raven so the shared library mount is always present when Kavita is installed by Warden.
- Full-stack lifecycle order now starts Raven before managed Kavita, then Portal, then Komf so the managed content
  stack comes up in dependency order.
- Managed Kavita now uses `captainpax/noona-kavita:latest`, and Warden can inject `KAVITA_ADMIN_USERNAME`,
  `KAVITA_ADMIN_EMAIL`, and `KAVITA_ADMIN_PASSWORD` so the container can bootstrap the first admin account on its own
  before Warden provisions and persists the reusable managed API key into Portal and Komf startup env.
- Managed Kavita now probes Kavita's API health endpoint (`/api/Health`) and uses a longer first-boot wait window so
  setup can reach the initial admin/API-key provisioning flow without requiring a manual UI visit mid-install.
- Raven descriptors now receive `KAVITA_BASE_URL`, `KAVITA_API_KEY`, and `KAVITA_LIBRARY_ROOT` so Raven can create
  matching Kavita libraries for new Raven media-type folders when Kavita sync is configured.
- The managed Komf descriptor is now Kavita-only in setup flows. Warden no longer publishes optional Komga credentials
  in `komf` env metadata, so Moon setup only prompts for the Kavita-linked Komf fields that Noona actually uses.
- The Portal descriptor in [docker/noonaDockers.mjs](docker/noonaDockers.mjs) now includes `PORTAL_JOIN_DEFAULT_ROLES`
  and `PORTAL_JOIN_DEFAULT_LIBRARIES`, which drive the `/join` defaults exposed in Moon's Portal settings tab. Managed
  installs default those values to `*,-admin` and `*`, and Warden injects Portal's Vault credential through the
  generated `VAULT_API_TOKEN` field instead of asking users to type a Vault token during setup.
- Generic service config overrides saved from Moon now persist into Vault Mongo's `noona_settings` collection under
  `services.config.*` keys, and Warden reloads them during full boot before launching the rest of the managed stack.
- Normal Warden shutdown and ecosystem restart now stop managed Noona services without deleting their containers, and
  full startup brings the configured stack back online; only factory reset uses the destructive remove/wipe path.
- Service image updates only restart installed services when Docker actually pulls a newer image digest, and Warden now
  persists the refreshed update snapshot immediately after a successful pull so Moon does not require a second click to
  clear the update state.
- Update descriptor metadata and this README together when adding/removing core services.
