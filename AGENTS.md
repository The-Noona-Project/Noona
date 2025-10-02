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
