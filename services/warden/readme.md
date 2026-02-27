# Warden (Noona Stack 2.2)

Warden is the orchestrator for the Noona stack. It manages container descriptors, install order, service health checks,
log streaming, and lifecycle APIs.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Entrypoint](initWarden.mjs)
- [Core descriptors](docker/noonaDockers.mjs)
- [Addon descriptors](docker/addonDockers.mjs)
- [Docker helpers](docker/dockerUtilties.mjs)
- [Core orchestration logic](shared/wardenCore.mjs)
- [HTTP API server](shared/wardenServer.mjs)
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

## Main API Endpoints

- `GET /health` - Warden process health.
- `GET /api/services` - service catalog + status.
- `POST /api/services/install` - install/start one or more services.
- `GET /api/services/install/progress` - current installation timeline.
- `GET /api/services/:name/logs` - buffered log output.
- `POST /api/services/:name/test` - service-level diagnostics.

## Key Environment Variables

| Variable           | Purpose                                        | Default                   |
|--------------------|------------------------------------------------|---------------------------|
| `DEBUG`            | Boot profile + log verbosity                   | `false`                   |
| `WARDEN_API_PORT`  | Warden API listen port                         | `4001`                    |
| `HOST_SERVICE_URL` | Host-facing URL prefix used in generated links | `http://localhost`        |
| `RAVEN_VAULT_URL`  | Vault URL injected into Raven runtime          | `http://noona-vault:3005` |
| `*_VAULT_TOKEN`    | Optional per-service token override            | generated in descriptors  |

## Development Commands

- Start: `npm run start`
- Dev watch mode: `npm run dev`
- Tests: `npm test`

## Notes

- Warden tracks service histories and buffered logs for diagnostics.
- Vault token maps are generated from descriptor lists in `docker/noonaDockers.mjs`.
- Update descriptor metadata and this README together when adding/removing core services.
