# Repository Agent Guidelines

This repository contains Noona Stack 2.2. Follow these rules when editing.

## Core Rules

- Keep changes scoped to the requested task.
- Preserve unrelated user changes; do not revert work you did not make.
- Check for nested `AGENTS.md` files before editing a service directory.
- Update docs when runtime behavior, endpoints, config, or workflows change.

## Repository Map

- [Root README](README.md)
- [services/](services/)
- [utilities/](utilities/)
- [docs/](docs/)
- [scripts/](scripts/)

## Service Guides (Open Before Editing)

| Service | Agent Guide                                            | README                                                 |
|---------|--------------------------------------------------------|--------------------------------------------------------|
| Warden  | [services/warden/AGENTS.md](services/warden/AGENTS.md) | [services/warden/readme.md](services/warden/readme.md) |
| Moon    | [services/moon/AGENTS.md](services/moon/AGENTS.md)     | [services/moon/README.md](services/moon/README.md)     |
| Portal  | [services/portal/AGENTS.md](services/portal/AGENTS.md) | [services/portal/README.md](services/portal/README.md) |
| Sage    | [services/sage/AGENTS.md](services/sage/AGENTS.md)     | [services/sage/README.md](services/sage/README.md)     |
| Raven   | [services/raven/AGENTS.md](services/raven/AGENTS.md)   | [services/raven/readme.md](services/raven/readme.md)   |
| Vault   | [services/vault/AGENTS.md](services/vault/AGENTS.md)   | [services/vault/readme.md](services/vault/readme.md)   |

## Documentation Rules

- README update rule: if behavior changes, update the nearest README in the same change.
- README navigation rule: include a short `## Quick Navigation` section with markdown links to related files/folders (
  entrypoint, core modules, tests, and adjacent docs).
- Cross-link rule: when adding or moving major docs, update [README.md](README.md) and this file so links stay accurate
  on GitHub.
- Use markdown links for paths in docs (`[label](relative/path)`), not plain text path dumps.

## Recommended Workflow

1. Read the closest service `AGENTS.md` and README.
2. Implement the change in the correct service directory.
3. Add or update tests for changed behavior.
4. Update README links/notes for touched workflows.
5. Run relevant tests before finalizing.

## Testing Expectations

- Prefer service-local test commands from each service README.
- Keep test coverage aligned with new route contracts, config parsing, and integration points.
- If tests are skipped, document why.
