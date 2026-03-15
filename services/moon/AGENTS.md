# Moon Agent Guide

Read this before editing `services/moon`.

## Role

Moon is Noona's web UI for setup, login, settings, users, downloads, and recommendations.

## Hard Rules

- Keep [README.md](README.md) public-facing and task-oriented.
- Preserve Moon's task-based settings and setup flows unless the change explicitly redesigns them.
- If setup, login, permissions, or admin workflows change, update [../../ServerAdmin.md](../../ServerAdmin.md) and the
  matching Moon agent docs.
- Keep route and implementation detail in [../../docs/agents/moon/](../../docs/agents/moon/), not here.

## Start Here

- [Public README](README.md)
- [AI overview](../../docs/agents/moon/README.md)
- [Files and rules](../../docs/agents/moon/files-and-rules.md)
- [API and proxy boundaries](../../docs/agents/moon/api-and-proxy-boundaries.md)
- [Setup, auth, and UI state](../../docs/agents/moon/setup-auth-and-ui-state.md)
- [Key flows](../../docs/agents/moon/flows.md)
