# Sage Agent Guide

Read this before editing `services/sage`.

## Role

Sage is Noona's setup, auth, and browser-facing API broker for Moon.

## Hard Rules

- Keep [README.md](README.md) public-facing and concise.
- Browser-facing setup and auth flow changes must update [../../ServerAdmin.md](../../ServerAdmin.md) and Moon-facing
  docs.
- Keep deeper route and client detail in [../../docs/agents/sage/](../../docs/agents/sage/).
- Preserve Sage's role as the Moon-facing broker unless the change explicitly redesigns that boundary.

## Start Here

- [Public README](README.md)
- [AI overview](../../docs/agents/sage/README.md)
- [Files and rules](../../docs/agents/sage/files-and-rules.md)
- [Key flows](../../docs/agents/sage/flows.md)
