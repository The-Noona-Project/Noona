# Vault Agent Guide

Read this before editing `services/vault`.

## Role

Vault is Noona's shared auth, user, secret, and packet-storage service.

## Hard Rules

- Keep [readme.md](readme.md) public-facing and concise.
- Auth policy, packet-whitelist, or user-model changes must update the matching agent docs and any admin docs affected
  by the change.
- Keep deep implementation detail in [../../docs/agents/vault/](../../docs/agents/vault/).
- Preserve service-level auth boundaries unless the change explicitly includes policy updates.

## Start Here

- [Public README](readme.md)
- [AI overview](../../docs/agents/vault/README.md)
- [Files and rules](../../docs/agents/vault/files-and-rules.md)
- [Flows](../../docs/agents/vault/flows.md)
- [Auth and data models](../../docs/agents/vault/auth-and-data-models.md)
