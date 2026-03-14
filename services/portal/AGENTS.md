# Portal Agent Guide

Read this before editing `services/portal`.

## Role

Portal handles Discord bot behavior, onboarding tokens, recommendation messaging, and Kavita bridge flows.

## Hard Rules

- Keep [README.md](README.md) public-facing and focused on how Portal fits into Noona.
- If Discord onboarding, command gates, Kavita login handoff, or recommendation behavior changes, update Moon/admin docs
  in the same change.
- Keep deeper operational detail in [../../docs/agents/portal/](../../docs/agents/portal/).
- Command or onboarding changes should also update the relevant Moon settings surfaces when needed.

## Start Here

- [Public README](README.md)
- [AI overview](../../docs/agents/portal/README.md)
- [Files and rules](../../docs/agents/portal/files-and-rules.md)
- [Key flows](../../docs/agents/portal/flows.md)
