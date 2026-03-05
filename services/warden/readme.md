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
- [Managed image registry helper](docker/imageRegistry.mjs)
- [Managed Komf template](docker/komfConfigTemplate.mjs)
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

When setup has been completed, normal Warden boot restores the configured stack in lifecycle order instead of blindly
starting every registered service. If the Vault-backed setup state is unavailable during boot, Warden now falls back
to the installed managed containers it detects through Docker so a post-setup restart does not drop back to minimal
mode.

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

| Variable                                          | Purpose                                                                                              | Default                                                   |
|---------------------------------------------------|------------------------------------------------------------------------------------------------------|-----------------------------------------------------------|
| `DEBUG`                                           | Boot profile + log verbosity                                                                         | `false`                                                   |
| `WARDEN_API_PORT`                                 | Warden API listen port                                                                               | `4001`                                                    |
| `SERVER_IP`                                       | Optional LAN IP/hostname Warden uses for host-facing service URLs and shared runtime env             | unset                                                     |
| `AUTO_UPDATES`                                    | Pull newer images during Warden startup and restart installed services whose image changed           | `false`                                                   |
| `HOST_SERVICE_URL`                                | Explicit host-facing URL prefix override used in generated links (takes precedence over `SERVER_IP`) | `http://localhost`                                        |
| `NOONA_DOCKER_NAMESPACE`                          | Full registry/project prefix Warden uses for managed Noona images                                    | `docker.darkmatterservers.com/the-noona-project`          |
| `NOONA_DOCKER_REGISTRY`                           | Registry host used for managed Noona images when namespace override is unset                         | `docker.darkmatterservers.com`                            |
| `NOONA_DOCKER_PROJECT`                            | Registry project used for managed Noona images when namespace override is unset                      | `the-noona-project`                                       |
| `NOONA_DOCKER_USERNAME` / `NOONA_DOCKER_PASSWORD` | Optional registry credentials used for digest-based update checks against private registries         | unset                                                     |
| `NOONA_DATA_ROOT`                                 | Shared host root for Raven, Vault, Kavita, `noona-komf`, and reserved service folders                | `%APPDATA%\noona` on Windows, `/mnt/user/noona` elsewhere |
| `WEBGUI_PORT`                                     | Moon web GUI port injected into `noona-moon`                                                         | `3000`                                                    |
| `RAVEN_VAULT_URL`                                 | Vault URL injected into Raven runtime                                                                | `http://noona-vault:3005`                                 |
| `KAVITA_ADMIN_*`                                  | Optional managed `noona-kavita` first-admin defaults passed through on install/start                 | unset                                                     |
| `*_VAULT_TOKEN`                                   | Optional per-service token override                                                                  | generated in descriptors                                  |

## Development Commands

- Start: `npm run start`
- Dev watch mode: `npm run dev`
- Tests: `npm test`

## Notes

- Warden tracks service histories and buffered logs for diagnostics.
- Vault token maps are generated from descriptor lists in `docker/noonaDockers.mjs`.
- Managed `noona-komf` now materializes `/config/application.yml` from the stored `KOMF_APPLICATION_YML` service
  setting before container start. Moon's setup wizard and Portal settings page edit that managed file through Warden's
  normal service-config flow. The baked-in managed template now follows the current Komf sample more closely by
  enabling only `mangaUpdates` by default with `mode: API`, and Warden auto-upgrades the untouched legacy Noona Komf
  template to that safer provider set.
- Warden now resolves a shared Noona host root and pre-creates the expected tree before service launch. Redis and
  Mongo mount under the Vault folder (`vault/redis` and `vault/mongo` by default), Raven uses `raven/downloads`,
  managed `noona-kavita` uses `kavita/config` plus the Raven download share, and managed `noona-komf` uses
  `komf/config`.
- Managed Moon, Portal, Raven, Sage, and Vault installs now also mount dedicated log folders from the shared Noona
  root and inject `NOONA_LOG_DIR` so each service writes a persistent `latest.log` file outside the container.
- Set `SERVER_IP` on the Warden process when Moon and setup summaries should advertise a real LAN address such as
  `http://192.168.1.25:<port>` instead of `localhost`, and Warden will also pass that value into managed service env.
  Moon's `/settings/warden` page can now persist runtime `SERVER_IP` and `AUTO_UPDATES` overrides into
  `noona_settings`, and Warden uses those saved values immediately when it builds host-facing service URLs and decides
  whether to pull/apply newer images during startup.
- When `AUTO_UPDATES` resolves to `true`, Warden checks the startup target services for newer images during boot. It
  restarts installed services whose image changed, so startup can take longer than a normal boot.
- `WEBGUI_PORT` is consumed by Warden's Moon descriptor and passed through to Moon so the UI listens and publishes on
  the same port.
- Full-stack lifecycle order now starts Mongo, Redis, Vault, managed Kavita, Raven, Komf, and Portal. Sage and Moon
  remain the always-on platform services around that managed stack.
- Managed Noona images now default to `docker.darkmatterservers.com/the-noona-project/*`, including managed Kavita at
  `docker.darkmatterservers.com/the-noona-project/noona-kavita:latest`. Warden can inject `KAVITA_ADMIN_USERNAME`,
  `KAVITA_ADMIN_EMAIL`, and `KAVITA_ADMIN_PASSWORD` so Warden can provision the first admin account and persist the
  reusable managed API key into Portal and Komf startup env without the Kavita web UI wizard. The Kavita image keeps
  its local bootstrap helper available for standalone runs, but that helper is now disabled by default during managed
  Warden installs to avoid first-user registration races.
- Managed Kavita now probes Kavita's API health endpoint (`/api/Health`) and uses a longer first-boot wait window so
  setup can reach the initial admin/API-key provisioning flow without requiring a manual UI visit mid-install.
- Managed Kavita API key provisioning now retries transient first-user login/register failures during Kavita startup,
  including temporary 5xx registration responses before the admin account exists, reuses existing Kavita auth keys
  when available, and only creates a named key when no reusable key exists yet.
- Managed Portal now also uses an extended health-check window because Discord login and slash-command synchronization
  complete before the HTTP `/health` endpoint starts listening.
- Raven descriptors now receive `KAVITA_BASE_URL`, `KAVITA_API_KEY`, and `KAVITA_LIBRARY_ROOT` so Raven can create
  matching Kavita libraries for new Raven media-type folders when Kavita sync is configured, plus `PORTAL_BASE_URL`
  so Raven can ask Portal to ensure those libraries through the managed Kavita API path.
- Portal descriptors now receive `RAVEN_BASE_URL`, `WARDEN_BASE_URL`, and `PORTAL_ACTIVITY_POLL_MS` so the Discord bot
  can publish live Noona activity from Raven downloads/checks and Warden service updates.
- The managed Komf descriptor is now Kavita-only in setup flows. Warden no longer publishes optional Komga credentials
  in `komf` env metadata, so Moon setup only prompts for the Kavita-linked Komf fields that Noona actually uses.
- Warden's managed Komf `application.yml` template now includes `malClientId` and `comicVineApiKey` slots plus a
  safer provider list where credentialed providers such as `mal` and `comicVine` start disabled until Moon's Komf
  settings editor is used to enable them with valid credentials.
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
