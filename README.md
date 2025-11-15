# Noona 2.1

Noona is a full-stack companion platform for [Kavita](https://www.kavitareader.com/) servers. The project began life as a lightweight Discord bot that automated new reader sign ups. Since then it has grown into a distributed, service-oriented platform that helps server owners manage their libraries and gives readers a rich, AI-assisted experience across Discord and the web.

> **Project status**: Personal learning project under active development. Expect rapid iteration, experimental features, and breaking changes as new ideas and technologies are evaluated.

---

## Highlights
- **Discord-first onboarding** – Invite the bot and let readers register, request titles, and check library status from Discord.
- **Kavita integration** – Query, update, and upload content directly into your Kavita library once requests are approved.
- **AI companion** – Chat with Noona to locate series (e.g., *"Is Naruto on PaxKun?"*), get summaries, and receive tailored reading suggestions.
- **Reader suggestion workflow** – Collect reader requests, surface them to moderators, and track approvals and fulfillment end to end.
- **Web control center (Moon)** – A Vue-powered dashboard for admins and readers with service health, request tracking, downloads, AI chat, and more.
- **Distributed deployment** – Run the stack as a master/node cluster to spread workloads across machines via Docker Swarm.
- **Observability baked in** – Prometheus + Grafana dashboards capture service health, download status, and usage metrics.

## Service Architecture

Noona is organized into seven primary services that communicate through authenticated APIs. Warden orchestrates the environment and the other six services focus on specialized responsibilities.

| Service | Role |
| --- | --- |
| **Warden** | Orchestrator for the entire stack. Builds Docker images, provisions containers, enforces boot order, performs health checks, and manages rolling updates across master and node deployments. |
| **Vault** | Authentication and data access gateway. Issues JWTs to services, brokers reads/writes to MongoDB and Redis, and secures internal APIs. |
| **Portal** | External integrations hub. Handles Discord command logic, listens for guild events, and bridges to Kavita's APIs. |
| **Sage** | Monitoring and logging backbone using Prometheus for metrics collection and Grafana for visualization. |
| **Moon** | Web-based control center built with React. Provides dashboards for admins and readers, Discord authentication, AI chat, request management, and service status. |
| **Raven** | Custom Java-based scraper/downloader. Automates content acquisition, metadata enrichment, and CBZ packaging. |
| **Oracle** | AI assistant layer powered by LangChain, LocalAI/AnythingLLM for conversational insights and recommendations. |

### Master/Node Topology

Warden supports a distributed layout:
- **Master node** (`wardenState=master`) – Hosts orchestration logic and exposes control APIs.
- **Worker nodes** (`wardenState=node`) – Join the cluster and execute workloads dispatched by the master. Configure workers with the master's URL so they can securely retrieve instructions and service tokens.

This design allows you to keep the core management stack on a primary machine while scaling resource-intensive jobs—such as scraping or AI inference—across additional hosts.

## Technology Stack

| Area | Key Tools |
| --- | --- |
| Orchestration | Docker, Docker Swarm, RSA key pairs for secure service auth |
| Backend Services | Node.js 23 (Warden, Vault, Portal, Sage, Moon backend), Python 3 (Oracle), Java 21/24 (Raven) |
| Datastores | MongoDB, Redis |
| Integrations | Discord.js, Axios, Kavita REST APIs |
| Frontend | React, Vite, Tailwind CSS |
| Observability | Prometheus, Grafana |
| AI | LangChain, LocalAI, (planned) AnythingLLM |

## Deployment

- **Docker Hub**: [captainpax/noona-warden](https://hub.docker.com/repository/docker/captainpax/noona-warden)
- **Example Kavita instance**: [pax-kun.com](https://pax-kun.com/)
- **Repo**: [github.com/The-Noona-Project/Noona](https://github.com/The-Noona-Project/Noona)

The `deployment/` directory contains Dockerfiles for single-service containers. The `dockerManager.mjs` module now centralizes build, registry, and lifecycle helpers for the CLI (`deployment/cli.mjs`) and deployment control server (`deployment/webServer.mjs`). The server also serves the browser control panel (`deployment/control-panel.html`) so you can trigger the same NDJSON-streamed operations without leaving your browser. By default, builds reuse Docker's cache; choose the clean build option when prompted—or run the CLI with `--clean-build`—to force a `--no-cache` rebuild. Pass `--cached-build` to skip the prompt while keeping cached layers.

## Roadmap & Vision

1. **Stabilize the 2.0+ refactor** – Consolidate services under a single repository, improve inter-service contracts, and ship production-ready Docker images.
2. **Enhance AI experiences** – Expand Oracle's capabilities, integrate richer embeddings, and offer contextual conversation history across Discord and Moon.
3. **Deepen automation** – Extend Raven's scraping sources, streamline metadata enrichment via [Komf](https://github.com/Snd-R/komf), and provide self-serve request approvals.
4. **Community tooling** – Publish deployment templates, infrastructure guides, and monitoring dashboards for other Kavita server owners.

This is a passion project that doubles as a testbed for new technologies. Contributions, ideas, and feedback are welcome—whether you're exploring Noona for your own library or just curious about the stack.

## Getting Involved

1. **Clone the repository** and explore the services under `services/` and shared utilities under `utilities/`.
2. **Spin up individual services** using the Dockerfiles in `deployment/single/` to experiment locally.
3. **Join the conversation** by opening issues, suggesting features, or sharing how you're using Noona with your Kavita instance.

Thanks for checking out Noona. This project is growing quickly, and I hope it becomes a powerful companion for the Kavita community.

## Documentation

- Run `npm install` at the repository root (if you haven't already) to set up the shared tooling dependencies.
- Execute `npm run docs` to regenerate `docs/docs.json`, which now aggregates both the JSDoc output from the Node.js services and parsed Javadoc comments from the Raven (Java) service.
- Review [docs/moon-troubleshooting.md](docs/moon-troubleshooting.md) if the Moon UI shows 404 or `ERR_CONNECTION_REFUSED` errors while running locally.
