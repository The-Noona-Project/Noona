# Agent Guidelines

## Repository Overview
- Root contains top-level documentation and configuration files such as `README.md`, `LICENSE`, and `coderabbit.yaml`.
- Primary code is organized under the `services` and `utilities` directories. Deployment-related manifests live under `deployment`, while higher-level project documentation is under `docs`.

## Navigating the Project
1. Start at the repository root (`/workspace/Noona`).
2. Use `ls` to explore major directories:
   - `services/` – service-specific source code and related assets.
   - `utilities/` – shared helpers, scripts, or tooling utilities.
   - `deployment/` – infrastructure, CI/CD, and deployment descriptors.
   - `docs/` – supplementary guides, architectural diagrams, and reference material.
3. Within each directory, prefer `ls` for listing, and `rg <pattern>` for searching specific symbols or text.
4. Always look for nested `AGENTS.md` files when entering a subdirectory; they may contain additional, more specific conventions.

## Service-Specific Guides
Detailed workflow, testing, and style expectations for each service live (or will soon live) alongside the code for that service. Whenever you begin work in one of the following areas, open the corresponding guide located at `services/<service>/AGENTS.md` for authoritative instructions.

| Service | Scope & Responsibilities | Guide Location (when available) |
| --- | --- | --- |
| Warden | Request authentication, access control, and session management. | `services/warden/AGENTS.md` |
| Vault | Secrets storage, encryption flows, and credential lifecycle tooling. | `services/vault/AGENTS.md` |
| Portal | Public-facing APIs, routing, and request/response orchestration. | `services/portal/AGENTS.md` |
| Sage | Business rules, analytics pipelines, and decisioning logic. | `services/sage/AGENTS.md` |
| Moon | Front-end client, UI composition, and user interaction flows. | `services/moon/AGENTS.md` |
| Raven | Notifications, messaging adapters, and asynchronous job handling. | `services/raven/AGENTS.md` |

Consult these service guides **before** modifying code inside their directories so you follow the correct patterns, tests, and deployment expectations. If a service-specific guide has not been authored yet, coordinate with maintainers to confirm interim conventions.

## Development Flow
1. Identify scope and read any relevant documentation in `docs/`.
2. Locate the target module inside `services/` or `utilities/`.
3. Implement changes following the coding standards described in the closest `AGENTS.md`.
4. Update or add unit tests that cover new or modified functionality.
5. Run the applicable test suites locally before committing.
6. Document changes succinctly in commits and PR descriptions.

## Testing Expectations
- Write unit tests alongside feature work or bug fixes to maintain coverage.
- Use the project's preferred test runner (consult service-specific docs or package.json/cargo.toml/etc. as appropriate).
- Ensure tests pass locally (`npm test`, `pytest`, `cargo test`, etc.) before submitting changes.
- If adding new functionality, include tests that validate both nominal and edge cases.

## General Tips
- Keep commits focused and descriptive.
- Follow existing patterns and respect linting or formatting rules enforced by the repository.
- Seek additional guidance from maintainers if project-specific testing instructions exist within service directories.
