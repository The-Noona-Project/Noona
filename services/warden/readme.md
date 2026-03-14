# Warden

Warden is Noona's Docker control plane. It starts the stack, applies the saved setup profile, tracks service state, and
exposes the management APIs that the rest of Noona uses.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Warden AI docs](../../docs/agents/warden/README.md)
- [Entrypoint](initWarden.mjs)
- [Core modules](core/)
- [Docker descriptors](docker/)
- [Tests](tests/)

## What Warden Does

- pulls and starts managed Noona containers
- stores and restores the active setup profile, with `storageRoot` persisted separately from per-service runtime
  overrides
- normalizes older setup JSON uploads for Moon review without persisting them until an explicit save or install
- tracks install progress, service health, and logs
- coordinates updates, restarts, and factory-reset behavior
- keeps Mongo and Redis on a private Docker data network
- generates and mounts the internal Vault HTTPS certificate bundle used by the stack

## Who It Is For

- Server admins installing or operating Noona
- Contributors working on stack orchestration and setup behavior

## When An Admin Needs To Care

- during the initial Docker + Warden install
- when changing storage, update, or restart behavior
- when Moon reports service-management or restore problems

## How It Fits Into Noona

Warden is the first service you start. Moon, Sage, Portal, and the rest of the managed stack rely on Warden for service
lifecycle and setup state. In managed installs it also owns the internal Vault trust bundle and keeps Vault as the only
runtime broker to Mongo and Redis.

For the supported install path, use [ServerAdmin.md](../../ServerAdmin.md) instead of treating Warden as a standalone
app.

## Next Steps

- Install or operate Noona: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/warden/README.md](../../docs/agents/warden/README.md)
