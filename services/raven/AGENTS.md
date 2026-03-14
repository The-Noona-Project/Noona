# Raven Agent Guide

Read this before editing `services/raven`.

## Role

Raven is Noona's downloader, scraper, and library worker service.

## Hard Rules

- Keep [readme.md](readme.md) focused on how Raven fits into Noona.
- If download storage, naming, manifests, worker behavior, or admin-facing repair flows change, update admin docs in the
  same change.
- Keep implementation detail in [../../docs/agents/raven/](../../docs/agents/raven/).
- Preserve `.noona` manifest compatibility unless the change explicitly includes a migration plan.

## Start Here

- [Public README](readme.md)
- [AI overview](../../docs/agents/raven/README.md)
- [Files and rules](../../docs/agents/raven/files-and-rules.md)
