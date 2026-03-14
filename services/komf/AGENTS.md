# Komf Agent Guide

Read this before editing `services/komf`.

## Role

This is a Noona-managed Komf checkout used for metadata matching and enrichment in the Noona stack.

## Hard Rules

- Keep [README.md](README.md) focused on Noona-managed behavior.
- Keep upstream Komf changes scoped unless broader vendor work is explicitly requested.
- If managed config, metadata endpoints, or Noona integration behavior changes, update the matching agent docs and any
  affected admin docs.
- Store deeper implementation detail in [../../docs/agents/komf/](../../docs/agents/komf/).

## Start Here

- [Public README](README.md)
- [AI overview](../../docs/agents/komf/README.md)
- [Files and rules](../../docs/agents/komf/files-and-rules.md)
- [API and config](../../docs/agents/komf/api-and-config.md)
- [Portal and Moon contracts](../../docs/agents/komf/portal-and-moon-contracts.md)
- [Key flows](../../docs/agents/komf/flows.md)
