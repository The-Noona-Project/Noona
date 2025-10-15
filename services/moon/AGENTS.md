# Moon Service Front-End Guide

## Architecture Overview
- **Routing**: Moon uses React Router with route modules stored under `src/pages` and feature folders. Guarded entry points enforce authentication and setup completion before rendering workspace routes. Navigation guards live in `src/navigation/guards` and should coordinate with Sage-authored tokens to determine onboarding progress.
- **Shared State**: Cross-cutting UI state is maintained through React context providers in `src/state`. Keep context reducers pure and route all side effects through hooks that call Sage APIs. When introducing new global data, extend the `AppProviders` composition to keep setup-aware contexts available to guarded routes.
- **Sage Coordination**: Whenever Moon needs authoritative data (service inventory, install status, analytics), treat Sage as the source of truth. Prefer the typed API clients in `src/api/sage` and co-locate query keys with the hooks that consume them.

## Navigation Guards
- Centralize guard logic in `src/navigation/guards`. Guards should use shared context selectors and Sage health checks to confirm prerequisites before resolving routes.
- Add new guards alongside matching tests in `src/test/navigation`. Guards must remain framework-agnostic enough to run in Jest with DOM testing utilities.

## Setup Wizard Flow
The setup wizard is orchestrated by `src/setup/useSetupSteps.ts`, which sequences onboarding tasks and integrates with Sage and Raven.

- **Step Management**: `useSetupSteps` exposes the ordered steps, completion state, and transition callbacks consumed by `src/pages/Setup.tsx`. Maintain declarative step metadata so Chakra UI steppers remain in sync with analytics events.
- **API Hooks**: Each step invokes shared hooks that call Sage endpoints for service installation, Discord guild validation, and Raven detection. Keep these interactions idempotent and surface loading + error state through Chakra UI components.
- **Discord Validation**: Validation logic uses Sage to confirm Discord credentials before enabling community features. Ensure error surfaces use Chakra `Alert` patterns.
- **Raven Detection**: The wizard polls Sage for Raven availability and surfaces manual overrides when Raven is not auto-discovered. Align UI copy with the Raven configuration section in the docs.
- **Testing**: Add or update tests under `src/test/setup` whenever step logic or API contracts change. Mock Sage clients and Raven responses to validate transitions.

## Chakra UI Patterns
- Favor Chakra layout primitives (`Stack`, `Grid`, `Card`) with design tokens sourced from `src/theme`.
- Compose presentational components under feature folders (for example `src/setup/components`) and keep business logic in hooks.
- Use Chakra form controls alongside React Hook Form when capturing user input.

## Environment Configuration & Docs
- Reference [`docs/moon-env-config.md`](../../docs/moon-env-config.md) for environment variable behavior, Raven overrides, and the end-to-end setup experience.
- Any new configuration surfaces should map to environment keys documented there. Coordinate with Sage to add documentation updates when new keys are introduced.

## Testing & Tooling
- Primary tests reside in `src/test`. Mirror the folder structure of the modules under test.
- Use Jest and Testing Library helpers exported from `src/test/utils`.
- Snapshot tests should live alongside the matching feature folder under `src/test`.

## Environment Management
- Manage Moon-specific environment variables through `.env.local` in development and the deployment manifests under `deployment/moon`.
- Keep build-time env access centralized in `src/config`. Avoid scattering `import.meta.env` usages across components.
- When introducing new environment toggles, update both the docs and the setup wizard step metadata so the configuration panel reflects them.

