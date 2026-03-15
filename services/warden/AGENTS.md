# Warden Agent Guide

Read this before editing `services/warden`.

## Role

Warden is Noona's Docker orchestrator and the source of truth for setup profiles, runtime service config, and restore
behavior.

## Hard Rules

- Keep [readme.md](readme.md) public and admin-friendly.
- If install flow, boot order, storage layout, setup snapshots, or service-management behavior changes,
  update [../../ServerAdmin.md](../../ServerAdmin.md) in the same change.
- Move implementation detail into [../../docs/agents/warden/](../../docs/agents/warden/), not this file.
- Descriptor, auth, or restore changes must update the matching Warden agent docs.

## Start Here

- [Public README](readme.md)
- [AI overview](../../docs/agents/warden/README.md)
- [Files and rules](../../docs/agents/warden/files-and-rules.md)
- [API surface and auth](../../docs/agents/warden/api-surface-and-auth.md)
- [Setup profile and persistence](../../docs/agents/warden/setup-profile-and-persistence.md)
- [Boot and restore flows](../../docs/agents/warden/boot-and-restore-flows.md)
- [How Warden pulls Docker images](../../docs/agents/warden/howWardenPullsDockers.md)
