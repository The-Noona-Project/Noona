# Noona Stack 2.2

Noona is a self-hosted stack for manga and comics servers. It combines a web app, downloader, Discord onboarding, and
managed reading services behind a single Docker-first control plane.

The supported release install path is Docker + Warden. If you are setting up a server, start
with [ServerAdmin.md](ServerAdmin.md).

## Quick Navigation

- [Server admin guide](ServerAdmin.md)
- [Repository rules](AGENTS.md)
- [Warden README](services/warden/readme.md)
- [Moon README](services/moon/README.md)
- [Portal README](services/portal/README.md)
- [Sage README](services/sage/README.md)
- [Raven README](services/raven/readme.md)
- [Vault README](services/vault/readme.md)
- [Kavita README](services/kavita/README.md)
- [Komf README](services/komf/README.md)
- [AI docs index](docs/agents/README.md)
- [Warden bootstrap script for bash](scripts/run-warden.sh)
- [Warden bootstrap script for PowerShell](scripts/run-warden.ps1)

## What Noona Does

- Warden starts, updates, and restores the managed Docker stack.
- Moon is the main web UI for setup, settings, users, downloads, and daily admin work.
- Portal handles Discord onboarding, recommendations, and Kavita bridge features.
- Sage brokers setup, auth, and browser-facing API traffic for Moon.
- Raven downloads content, builds library files, and keeps the library in sync.
- Vault stores users, secrets, and shared service state.
- Managed Kavita and Komf round out the reading and metadata experience.

## Who Noona Is For

- Self-hosters who want one supported install story instead of wiring every service by hand.
- Server admins who need a single place to manage users, roles, updates, and storage.
- Readers and community members who mainly interact through Moon, Discord, and Kavita after the server is set up.

## Install Noona

1. Follow [ServerAdmin.md](ServerAdmin.md).
2. Pull and start Warden with Docker.
3. Open Moon and complete the first-run setup flow.
4. Use Moon for ongoing updates, user management, and troubleshooting.

Source installs and parallel quick starts are intentionally not the public path for this repository.

## Services At A Glance

| Service                             | What it does                                   | When an admin cares                                     |
|-------------------------------------|------------------------------------------------|---------------------------------------------------------|
| [Warden](services/warden/readme.md) | Docker control plane and setup source of truth | First install, updates, restarts, logs, restore issues  |
| [Moon](services/moon/README.md)     | Main web UI                                    | Setup, settings, users, permissions, operations         |
| [Portal](services/portal/README.md) | Discord and Kavita bridge                      | Discord bot setup, onboarding, recommendation flows     |
| [Sage](services/sage/README.md)     | Setup, auth, and browser API broker            | Login, setup, and proxy troubleshooting                 |
| [Raven](services/raven/readme.md)   | Downloader and library worker                  | Download jobs, imports, worker tuning, storage checks   |
| [Vault](services/vault/readme.md)   | Shared data and auth broker                    | User/auth persistence, secrets, reset and recovery work |
| [Kavita](services/kavita/README.md) | Managed reading server                         | Reader access, external links, Noona login handoff      |
| [Komf](services/komf/README.md)     | Managed metadata helper                        | Metadata matching and enrichment issues                 |

## Where To Go Next

- Admins: [ServerAdmin.md](ServerAdmin.md)
- Public service summaries: the README in each `services/*` folder
- AI contributors: [AGENTS.md](AGENTS.md) and [docs/agents/README.md](docs/agents/README.md)
- Archived pre-release docs: [docs/archive/README.md](docs/archive/README.md)
