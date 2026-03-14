# Kavita Agent Guide

Read this before editing `services/kavita`.

## Role

This is a Noona-managed Kavita checkout with Noona-specific container, bootstrap, and login-handoff integration layered on top.

## Hard Rules

- Keep [README.md](README.md) about Noona-managed behavior, not a full upstream manual.
- Keep upstream Kavita changes narrowly scoped unless the task explicitly asks for broader vendor work.
- If bootstrap, entrypoint, or Noona login-handoff behavior changes, update the matching agent docs and admin docs.
- Store deep implementation detail in [../../docs/agents/kavita/](../../docs/agents/kavita/).

## Start Here

- [Public README](README.md)
- [AI overview](../../docs/agents/kavita/README.md)
- [Files and rules](../../docs/agents/kavita/files-and-rules.md)
