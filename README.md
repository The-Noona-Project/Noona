# Noona Stack 2.2

Noona is a multi-service platform for orchestration, onboarding, library automation, and download management.

## Quick Navigation

- [Repository rules](AGENTS.md)
- [Dockerfiles](dockerfiles/)
- [Warden orchestrator](services/warden/readme.md)
- [Moon web UI](services/moon/README.md)
- [Portal API gateway](services/portal/README.md)
- [Sage setup/proxy service](services/sage/README.md)
- [Raven downloader](services/raven/readme.md)
- [Vault data and auth broker](services/vault/readme.md)
- [Kavita integration](services/kavita/README.md)
- [Kavita service guide](services/kavita/AGENTS.md)
- [Project docs](docs/)

## Services

| Service | Runtime              | README                                                 | Responsibility                                               |
|---------|----------------------|--------------------------------------------------------|--------------------------------------------------------------|
| Warden  | Node.js              | [services/warden/readme.md](services/warden/readme.md) | Container lifecycle, install order, stack orchestration APIs |
| Moon    | Next.js + Once UI    | [services/moon/README.md](services/moon/README.md)     | Web GUI for `/libraries`, `/downloads`, `/settings`, setup   |
| Portal  | Node.js + Discord.js | [services/portal/README.md](services/portal/README.md) | Discord onboarding and Kavita/Vault bridging                 |
| Sage    | Node.js + Express    | [services/sage/README.md](services/sage/README.md)     | Warden and Raven proxy APIs for setup and downloads          |
| Raven   | Spring Boot (Java)   | [services/raven/readme.md](services/raven/readme.md)   | Search, scrape, download, library metadata updates           |
| Vault   | Node.js + Express    | [services/vault/readme.md](services/vault/readme.md)   | Token-authenticated packet handling, users, secrets          |
| Kavita  | .NET 10 + Angular    | [services/kavita/README.md](services/kavita/README.md) | Managed reading server image and first-admin bootstrap flow  |

## Stack 2.2 Baseline

- Core services: Warden, Moon, Portal, Sage, Raven, Vault.
- Shared modules live in [utilities/](utilities/).
- Stack-level docs live in [docs/](docs/).
- Service Dockerfiles live in [dockerfiles/](dockerfiles/).
- Managed Kavita is built as `captainpax/noona-kavita`
  from [dockerfiles/kavita.Dockerfile](dockerfiles/kavita.Dockerfile).

## Local Workflow

1. Start Warden first:

```bash
cd services/warden
DEBUG=false node initWarden.mjs
```

2. Start the full stack profile:

```bash
cd services/warden
DEBUG=super node initWarden.mjs
```

3. Open Moon when healthy: `http://localhost:3000`.

Set `SERVER_IP` on Warden when Moon should advertise LAN URLs like `http://192.168.x.x:<port>` for managed services.

## Root Scripts

- Generate docs: `npm run docs`
- List docker targets: `npm run docker:list`
- Build docker images: `npm run docker:build`
- Push docker images: `npm run docker:push`
- Build + push helper: `npm run docker:publish`
- Pass docker helper flags after `--`, for example `npm run docker:publish -- --no-cache`

## Repo Map

- [dockerfiles/](dockerfiles/) - Container build definitions for core services and managed Kavita
- [services/](services/) - Service source, tests, and service-level docs
- [utilities/](utilities/) - Shared helpers and modules
- [docs/](docs/) - Deployment and operations documentation
- [scripts/](scripts/) - Monorepo tooling and automation scripts

## Documentation Rule

When any major service behavior changes, update that service README and keep this file's links current so GitHub
navigation stays accurate.
