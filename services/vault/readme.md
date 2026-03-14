# Vault

Vault is Noona's shared data and authentication broker. It stores users, secrets, and service data that the rest of the
stack depends on.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Vault AI docs](../../docs/agents/vault/README.md)
- [Entrypoint](initVault.mjs)
- [Route modules](routes/)
- [User helpers](users/)
- [Tests](tests/vaultApp.test.mjs)

## What Vault Does

- authenticates service-to-service requests
- stores Noona users and shared secrets
- brokers Mongo and Redis-backed packet operations for the stack

## Who It Is For

- Server admins troubleshooting users, auth, or persistence
- Contributors working on shared storage and auth boundaries

## When An Admin Needs To Care

- when logins or user updates fail
- when secrets or shared state stop persisting
- during backup, reset, or restore work

## How It Fits Into Noona

Vault sits behind Moon, Sage, Portal, Raven, and Warden. It is an internal service, but its health matters to almost
every admin-facing flow.

## Next Steps

- Admin install and operations: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/vault/README.md](../../docs/agents/vault/README.md)
