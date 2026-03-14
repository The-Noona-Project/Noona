# Noona Server Admin Guide

This is the main admin handbook for Noona. The supported install path is Docker + Warden only.

## Quick Navigation

- [Repo overview](README.md)
- [Warden README](services/warden/readme.md)
- [Moon README](services/moon/README.md)
- [Bash Warden bootstrap](scripts/run-warden.sh)
- [PowerShell Warden bootstrap](scripts/run-warden.ps1)
- [AI docs index](docs/agents/README.md)

## Supported Install Path

Use Docker to run Warden, then complete setup from Moon. This guide does not cover source installs or alternate control
planes.

## Before You Start

- Install Docker Engine or Docker Desktop on the host.
- Pick a persistent storage root for Noona data.
- Make sure the host can expose Warden on `4001` and Moon on `3000`.
- Mongo, Redis, and Vault do not need host port exposure for the supported install path. Mongo and Redis stay
  internal-only, and the rest of the stack reaches shared data through Vault.
- If you plan to use Discord login and the Discord bot, have your Discord app and bot details ready for first-run setup.

## 1. Pull And Start Warden

Choose a permanent data path first.

Linux example:

```bash
export NOONA_DATA_ROOT=/srv/noona
./scripts/run-warden.sh
```

Windows PowerShell example:

```powershell
$env:NOONA_DATA_ROOT = Join-Path $env:APPDATA 'noona'
./scripts/run-warden.ps1
```

What this does:

- pulls `docker.darkmatterservers.com/the-noona-project/noona-warden:latest` if needed
- creates the `noona-network` Docker network if it does not exist
- starts the `noona-warden` container
- exposes Warden on port `4001`
- lets Warden create and manage the private `noona-data-network` during stack boot

If you need a different image, port, or container name, set `WARDEN_IMAGE`, `WARDEN_PORT`, or `WARDEN_CONTAINER_NAME`
before running the script.

## 2. Confirm The Stack Is Reachable

- Warden health: `http://localhost:4001/health`
- Moon: `http://localhost:3000`
- Mongo and Redis are intentionally not published on host ports
- Vault is an internal service and is reached by the rest of the stack over Warden-managed HTTPS

Warden brings up the bootstrap services that Moon needs for setup. If Moon does not appear after Warden starts, check
`docker ps` and `docker logs noona-warden`.

## 3. Complete First-Run Setup In Moon

Moon's first-run flow is task-based:

1. `Storage`
2. `Library Setup`
3. `Discord`
4. `Install`
5. `Finish`

Use that flow to choose your storage root, configure managed services, and install the rest of the stack. The supported
public path is to let Warden derive the managed service selection from the setup profile instead of editing raw
container settings by hand.

If you upload an older Noona setup JSON file during setup, Moon now loads it into the wizard for review first. Confirm
the storage path and any secrets, then use the explicit save or install actions to persist the updated profile.

## 4. First Admin And Discord Notes

- Moon sign-in is Discord-first.
- During first-run setup, configure Discord OAuth for Moon and the Portal bot settings you want to use.
- On the finish or summary step, use the Discord login flow to create the first Noona admin session.
- Managed Kavita admin credentials are separate. If you provide Kavita admin defaults during setup, Warden can seed the
  managed Kavita admin and API-key flow for you.

## Storage And Data Expectations

`NOONA_DATA_ROOT` is the shared host root for Noona data.

Defaults:

- Windows: `%APPDATA%\\noona`
- Non-Windows: `/mnt/user/noona`

Recommended practice:

- set `NOONA_DATA_ROOT` explicitly to a path you control
- keep that path on persistent storage
- back up the entire tree regularly

Important paths under the storage root:

- `wardenm/noona-settings.json`: canonical setup snapshot
- `warden/service-runtime-config.json`: runtime service overrides
- `vault/`: shared Vault, Mongo, and Redis state used by the stack
- `vault/tls/`: Warden-managed internal CA plus the Vault HTTPS certificate and key
- `raven/`: download and library worker data
- `kavita/`: managed Kavita config
- `komf/`: managed Komf config

If Warden runs in a Linux container, mount `NOONA_DATA_ROOT` into that container at the same absolute path as the host
so setup snapshots and runtime files stay visible on the host.

## Updates, Restarts, Backups, And Factory Reset

Updates:

- Use Moon's `Admin -> System -> Updates` for normal managed-image updates.
- `AUTO_UPDATES=true` is optional if you want Warden to check startup images during boot.

Restarts:

- Use Moon `Admin -> System -> Overview` for ecosystem start, stop, and restart actions.
- Restart the Warden container itself when you update Warden or need to recover the control plane.

Backups:

- Back up the full `NOONA_DATA_ROOT`.
- Make sure your backup includes the Warden snapshot files plus the `vault/`, `raven/`, `kavita/`, and `komf/`
  folders.
- Treat `vault/tls/` as part of the backup set because the stack reuses that internal CA and server certificate bundle.

Factory reset:

- Use the reset controls in Moon only if you intend to wipe the install state.
- Back up first. Reset clears Warden's persisted setup and runtime snapshots so the old stack is not restored on the
  next boot.

## Users, Roles, And Permissions

Manage Noona users in Moon at `Admin -> People -> Users & roles`.

The current Moon permission set is:

- `moon_login`
- `library_management`
- `download_management`
- `mySubscriptions`
- `myRecommendations`
- `manageRecommendations`
- `user_management`
- `admin`

Also in Moon:

- `Admin -> Integrations -> Discord` manages Discord bot validation, onboarding defaults, and per-command role gates.
- `Admin -> Integrations -> Kavita` manages Kavita-related defaults and external link settings.

Use Moon's default-permissions controls if you want new Discord-linked users to start with a standard role set.

## Common Troubleshooting

Moon does not load:

- check `docker ps`
- confirm Warden health at `http://localhost:4001/health`
- inspect `docker logs noona-warden`

Setup changes do not appear on disk:

- confirm `NOONA_DATA_ROOT` is set
- confirm the host path is mounted into containerized Warden on Linux

Discord login or bot setup fails:

- verify the Discord client id, client secret, bot token, and callback settings entered during setup
- confirm Moon is reachable on the same public URL you configured for Discord callbacks

Users or permissions look wrong:

- review `Admin -> People -> Users & roles`
- confirm the correct default permissions are saved for new Discord-linked users

Downloads, Kavita, or metadata flows fail after a reboot:

- confirm the storage root persisted across the reboot
- check service health and logs from Moon or Warden before changing settings by hand

Direct Mongo or Redis host access is unavailable:

- this is expected in supported installs because those services are private to Docker
- use Moon, Sage, Warden, or other Vault-backed flows instead of opening direct DB ports
