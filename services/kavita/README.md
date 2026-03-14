# Noona Kavita Service

This repository includes a Noona-managed Kavita checkout. In Noona, Kavita is the reading server that admins and readers open after the stack is installed.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Kavita AI docs](../../docs/agents/kavita/README.md)
- [Noona Dockerfile](../../dockerfiles/kavita.Dockerfile)
- [Container entrypoint](entrypoint.sh)
- [Noona bootstrap helper](noona-bootstrap-admin.sh)
- [Account controller](API/Controllers/AccountController.cs)

## What This Service Does

- provides the managed reading server in a standard Noona install
- supports the Noona-to-Kavita login handoff
- exposes the reader and user-role features admins expect from Kavita

## Who It Is For

- Server admins managing reader access
- Contributors touching Noona's managed Kavita behavior

## When An Admin Needs To Care

- when reader access or Kavita links fail
- when tuning managed Kavita defaults during setup
- when troubleshooting the Noona login handoff

## How It Fits Into Noona

Warden manages the container, Moon exposes the relevant settings, and Portal/Sage participate in the login and onboarding flow. Admins usually do not install Kavita separately when running Noona.

## Next Steps

- Admin install and operations: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/kavita/README.md](../../docs/agents/kavita/README.md)
