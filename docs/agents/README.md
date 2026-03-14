# Noona AI Docs

This tree is the internal knowledge base for future AI contributors.

Audience split:

- public and self-hosters: root and service `README.md`
- server admins: [../../ServerAdmin.md](../../ServerAdmin.md)
- AI contributors: this folder and the service `AGENTS.md` files

## How To Use This Tree

1. Start with the service folder `README.md`.
2. Read `files-and-rules.md` before editing important code paths.
3. Open `flows.md` or a focused note only when the task touches that workflow.

## Standard Format

- `README.md`: start here, role, and file map
- `files-and-rules.md`: important files, invariants, and editing rules
- `flows.md`: key workflows and cross-service handoffs
- focused notes: deeper topics that are too specific for the generic files

## Update Rules

- If users or self-hosters need to know, update the nearest public README.
- If server admins need to know, update [../../ServerAdmin.md](../../ServerAdmin.md).
- If internal ownership, invariants, or workflows change, update the relevant file in this tree.

## Service Index

- [Warden](warden/README.md)
- [Moon](moon/README.md)
- [Portal](portal/README.md)
- [Sage](sage/README.md)
- [Raven](raven/README.md)
- [Vault](vault/README.md)
- [Kavita](kavita/README.md)
- [Komf](komf/README.md)
