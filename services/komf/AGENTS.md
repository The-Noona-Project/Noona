# Komf Service Guide

> Start in [`services/komf`](./). This service is a vendored Komf upstream checkout used by Noona as a managed
> metadata helper for Kavita matching and enrichment.

## Quick Navigation

- [Service README](README.md)
- [Root Gradle settings](settings.gradle.kts)
- [Root Gradle build](build.gradle.kts)
- [Application module build](komf-app/build.gradle.kts)
- [Application entrypoint](komf-app/src/main/kotlin/snd/komf/app/Application.kt)
- [Application context wiring](komf-app/src/main/kotlin/snd/komf/app/AppContext.kt)
- [API routes](komf-app/src/main/kotlin/snd/komf/app/api/)
- [Kavita event handler](komf-mediaserver/src/commonMain/kotlin/snd/komf/mediaserver/kavita/KavitaEventHandler.kt)
- [Kavita client adapter](komf-mediaserver/src/commonMain/kotlin/snd/komf/mediaserver/kavita/KavitaMediaServerClientAdapter.kt)
- [Metadata providers](komf-core/src/commonMain/kotlin/snd/komf/providers/)
- [Noona Dockerfile](../../dockerfiles/komf.Dockerfile)
- [Warden addon descriptor](../warden/docker/addonDockers.mjs)
- [Warden managed Komf config template](../warden/docker/komfConfigTemplate.mjs)
- [Moon Komf settings editor](../moon/src/components/noona/settings/KomfApplicationEditor.tsx)
- [Portal Kavita metadata routes](../portal/routes/registerPortalRoutes.mjs)

## Project Layout

- `komf-app/` contains the executable Ktor server and API route wiring.
- `komf-mediaserver/` contains media-server adapters and metadata update orchestration logic.
- `komf-core/` contains provider integrations, metadata models, and matching helpers.
- `komf-notifications/` contains Apprise and Discord notification integrations.
- `komf-api-models/` and `komf-client/` contain shared DTOs and typed client helpers.

## Build & Test Commands

Run from `services/komf`:

- `./gradlew :komf-app:shadowJar` - build the runnable fat jar.
- `./gradlew test` - run module tests across Komf projects.

Run from the repository root:

- `docker build -f dockerfiles/komf.Dockerfile -t <image> .` - build the managed Komf container image.

## Noona-Specific Touchpoints

- Managed service defaults, env fields, and runtime config keys live in
  [../warden/docker/addonDockers.mjs](../warden/docker/addonDockers.mjs).
- Generated managed `application.yml` handling lives in
  [../warden/docker/komfConfigTemplate.mjs](../warden/docker/komfConfigTemplate.mjs).
- Moon settings and edit flow for `KOMF_APPLICATION_YML` lives in
  [../moon/src/components/noona/settings/KomfApplicationEditor.tsx](../moon/src/components/noona/settings/KomfApplicationEditor.tsx).
- Portal metadata-match proxy routes that depend on Komf/Kavita behavior live in
  [../portal/routes/registerPortalRoutes.mjs](../portal/routes/registerPortalRoutes.mjs).

## Working Rules

- Keep upstream Komf logic changes scoped and avoid broad refactors unless requested.
- Do not add service-local Dockerfiles. Noona builds Komf
  from [../../dockerfiles/komf.Dockerfile](../../dockerfiles/komf.Dockerfile).
- Update [README.md](README.md) when runtime behavior, API routes, configuration keys, or build workflow changes.
- If you change managed config key behavior, update Warden and Moon docs/routes in the same change.
