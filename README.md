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
- [Komf metadata helper](services/komf/README.md)
- [Kavita service guide](services/kavita/AGENTS.md)
- [Komf service guide](services/komf/AGENTS.md)
- [Project docs](docs/)

## Services

| Service | Runtime              | README                                                 | Responsibility                                                                                                         |
|---------|----------------------|--------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| Warden  | Node.js              | [services/warden/readme.md](services/warden/readme.md) | Container lifecycle, install order, stack orchestration APIs                                                           |
| Moon    | Next.js + Once UI    | [services/moon/README.md](services/moon/README.md)     | Web GUI for `/libraries`, `/downloads`, `/downloads/add`, `/recommendations`, `/mysubscriptions`, `/settings/*`, setup |
| Portal  | Node.js + Discord.js | [services/portal/README.md](services/portal/README.md) | Discord onboarding and Kavita/Vault bridging                                                                           |
| Sage    | Node.js + Express    | [services/sage/README.md](services/sage/README.md)     | Warden and Raven proxy APIs for setup and downloads                                                                    |
| Raven   | Spring Boot (Java)   | [services/raven/readme.md](services/raven/readme.md)   | Search, scrape, download, library metadata updates                                                                     |
| Vault   | Node.js + Express    | [services/vault/readme.md](services/vault/readme.md)   | Token-authenticated packet handling, users, secrets                                                                    |
| Kavita  | .NET 10 + Angular    | [services/kavita/README.md](services/kavita/README.md) | Managed reading server image and first-admin bootstrap flow                                                            |
| Komf    | Kotlin + Ktor        | [services/komf/README.md](services/komf/README.md)     | Managed metadata matching and enrichment for Kavita libraries                                                          |

## Stack 2.2 Baseline

- Core services: Warden, Moon, Portal, Sage, Raven, Vault.
- Shared modules live in [utilities/](utilities/).
- Stack-level docs live in [docs/](docs/).
- Service Dockerfiles live in [dockerfiles/](dockerfiles/).
- Managed Kavita is built as `docker.darkmatterservers.com/the-noona-project/noona-kavita`
  from [dockerfiles/kavita.Dockerfile](dockerfiles/kavita.Dockerfile).
- Managed Komf is built as `docker.darkmatterservers.com/the-noona-project/noona-komf`
  from [dockerfiles/komf.Dockerfile](dockerfiles/komf.Dockerfile).

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
- Docker scripts default to `docker.darkmatterservers.com/the-noona-project`
- Override the default target with `NOONA_DOCKER_NAMESPACE`, or split it with `NOONA_DOCKER_REGISTRY` and
  `NOONA_DOCKER_PROJECT`
- The helper now runs `docker login` to Harbor automatically before `push` and `publish`
- Set `NOONA_DOCKER_USERNAME` and `NOONA_DOCKER_PASSWORD` only if you need to override the built-in Harbor login
- Pass `--skip-login` after `--` if you want to rely on an existing Docker login session instead
- Pass docker helper flags after `--`, for example `npm run docker:publish -- --no-cache`
- Build and publish default to `--progress=plain` so long-running layers such as Kavita's `dotnet publish` keep printing
  logs
- Override progress with `NOONA_DOCKER_PROGRESS` or `npm run docker:publish -- --progress=tty`

## Repo Map

- [dockerfiles/](dockerfiles/) - Container build definitions for core services and managed Kavita/Komf
- [services/](services/) - Service source, tests, and service-level docs
- [utilities/](utilities/) - Shared helpers and modules
- [docs/](docs/) - Deployment and operations documentation
- [scripts/](scripts/) - Monorepo tooling and automation scripts

## Documentation Rule

When any major service behavior changes, update that service README and keep this file's links current so GitHub
navigation stays accurate.
