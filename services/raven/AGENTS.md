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
- Keep a top-of-file Javadoc header on every first-party Raven `.java` file. The header must describe the file, list a
  few related Raven files, and include `Times this file has been edited: N`.
- When editing a first-party Raven `.java` file, refresh that edit counter using the file's git history count plus the
  current change, and update Javadocs for public types, public methods, and any non-trivial helpers you touch.

## Start Here

- [Public README](readme.md)
- [AI overview](../../docs/agents/raven/README.md)
- [Files and rules](../../docs/agents/raven/files-and-rules.md)
- [Flows](../../docs/agents/raven/flows.md)
- [Storage, settings, and runtime](../../docs/agents/raven/storage-settings-and-runtime.md)
