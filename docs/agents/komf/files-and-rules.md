# Komf Files And Rules

## Important Files

## App Boot And Config

- [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/Application.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/Application.kt)
  Entrypoint. Prefers `KOMF_CONFIG_DIR` over a CLI config path and then constructs `AppContext`.
- [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/AppContext.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/AppContext.kt)
  Main runtime factory. Loads config, sets log level, builds provider/media-server/notification modules, starts the
  embedded server, and rewrites config on live updates.
- [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/AppConfig.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/AppConfig.kt)
  Top-level typed config for server, Kavita, database, providers, and notifications.
- [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/ConfigLoader.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/ConfigLoader.kt)
  Reads `application.yml`, rewrites config-directory-aware paths, applies env overrides, and warns when no metadata
  providers are enabled.
- [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/ConfigWriter.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/ConfigWriter.kt)
  Writes updated config back to a file or config directory.

## Route Modules

- [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/ServerModule.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/ServerModule.kt)
  Registers `/api` routes, permissive CORS, SSE, status pages, static resources, and both Komga/Kavita route groups.
- [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/MetadataRoutes.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/MetadataRoutes.kt)
  Noona's most important route surface: providers, search, identify, series-details, match, and reset operations.
- [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/ConfigRoutes.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/ConfigRoutes.kt)
  Config read/patch plus the streaming MangaBaka DB update endpoint.
- [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/MediaServerRoutes.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/MediaServerRoutes.kt)
  Media-server connection and library listing routes.

## Build And Packaging

- [../../../services/komf/settings.gradle.kts](../../../services/komf/settings.gradle.kts)
  Module map for the vendored upstream project.
- [../../../services/komf/komf-app/build.gradle.kts](../../../services/komf/komf-app/build.gradle.kts)
  JVM 17 app module and shaded-jar entrypoint configuration.
- [../../../services/komf/gradle/libs.versions.toml](../../../services/komf/gradle/libs.versions.toml)
  Upstream dependency and app-version pins for this vendored snapshot.
- [../../../dockerfiles/komf.Dockerfile](../../../dockerfiles/komf.Dockerfile)
  Noona runtime image. Sets `KOMF_CONFIG_DIR=/config`, exposes `8085`, and points OCI labels back to the upstream
  GitHub project.

## Noona Integration Files

- [../../../services/warden/docker/addonDockers.mjs](../../../services/warden/docker/addonDockers.mjs)
  Warden descriptor for `noona-komf`, including the env contract Moon edits and the absence of a health check.
- [../../../services/warden/docker/komfConfigTemplate.mjs](../../../services/warden/docker/komfConfigTemplate.mjs)
  Default managed `application.yml` plus normalization for legacy Noona YAML content.
- [../../../services/moon/src/components/noona/settings/KomfApplicationEditor.tsx](../../../services/moon/src/components/noona/settings/KomfApplicationEditor.tsx)
  Structured UI editor for provider toggles, priorities, and a small credential subset.
- [../../../services/moon/src/components/noona/settings/komfConfig.ts](../../../services/moon/src/components/noona/settings/komfConfig.ts)
  YAML parsing, provider ordering, credential writes, fallback/raw-mode handling, and unknown-provider preservation.
- [../../../services/moon/src/components/noona/SetupWizard.tsx](../../../services/moon/src/components/noona/SetupWizard.tsx)
  Handles `KOMF_APPLICATION_YML` specially and hides `KOMF_KAVITA_API_KEY` in managed Kavita mode.
- [../../../services/portal/clients/komfClient.mjs](../../../services/portal/clients/komfClient.mjs)
  Portal's Komf HTTP client for search, identify, and series-details.
- [../../../services/portal/routes/registerPortalRoutes.mjs](../../../services/portal/routes/registerPortalRoutes.mjs)
  Portal routes that depend on Komf responses and convert failures into admin-facing metadata errors.
- [../../../services/portal/tests/komfClient.test.mjs](../../../services/portal/tests/komfClient.test.mjs)
  The clearest current regression coverage for Noona's Komf request contract.

## Rules

## Vendor Boundary Rules

- Treat Komf as an upstream project first and a Noona integration target second.
- Keep Noona-specific changes scoped to packaging, config wiring, route consumption, or explicitly requested vendor
  edits.
- If the change looks broadly useful outside Noona, consider whether it belongs upstream in
  [Snd-R/komf](https://github.com/Snd-R/komf).

## Runtime And Config Rules

- Managed Komf config lives in Warden's descriptor plus `komfConfigTemplate.mjs`, not in ad hoc service-local defaults.
- `KOMF_APPLICATION_YML` is written into `/config/application.yml` for managed Komf.
  Avoid hidden side channels for changing config.
- `KOMF_CONFIG_DIR` wins over a CLI config-file argument in `Application.kt`.
  In Noona's Docker image, `/config` is the effective source of truth unless you intentionally change the runtime.
- Config-directory mode rewrites important paths:
  database file becomes `/config/database.sqlite`,
  MangaBaka data becomes `/config/mangabaka`,
  and notification templates default to the config directory.
- `AppContext.refreshState(newConfig)` rebuilds modules and rewrites config, but it does not rebuild `ServerModule`.
  A persisted `server.port` change does not move the already-running listener until the process restarts.
- `ConfigLoader` currently reads `KOMF_METADATA_PROVIDERS_COMIC_VINE_SEARCH_LIMIT`, but the copied config object does
  not write that field back today.
  Do not rely on that env var without fixing and testing the loader path.

## API Rules

- Noona's critical Komf contract is the Kavita route group under `/api/kavita/*`.
- Portal depends directly on `/api/kavita/metadata/search`, `/identify`, and `/series-details`.
- Metadata contract changes usually affect Komf, Portal, Moon, and sometimes Raven together.
- Keep validation and error behavior stable enough for Portal's error mapping to remain meaningful.
- Komf currently has permissive CORS and no auth middleware.
  Treat it as a private internal service; do not assume route hardening exists elsewhere in the vendored app.
- Warden's `noona-komf` descriptor currently sets `health: null`.
  Do not assume there is a supported health endpoint or container healthcheck contract.

## Moon And Warden Rules

- Moon's Komf editor is a YAML transformer, not an alternate source of truth.
  If you change the YAML schema, update Moon's helper functions and Warden's default template together.
- Moon preserves unknown provider keys from YAML and title-cases them for display, but only known providers get custom
  credential fields.
- `moveKomfProvider()` rewrites priorities in increments of `10`; keep that behavior in mind if you change provider
  ordering semantics.

## Admin And Docs Rules

- Admin-visible metadata-flow or settings changes should update public/admin docs.
- If you change how Moon edits Komf config, update Moon docs and [../../../ServerAdmin.md](../../../ServerAdmin.md).

## Test Map

- No service-local Komf tests were found in this vendored checkout.
- [../../../services/portal/tests/komfClient.test.mjs](../../../services/portal/tests/komfClient.test.mjs)
  is the clearest regression coverage for the Portal-side Komf request contract.
- If you change route payloads, provider validation, or error mapping, add or update Portal tests in the same change.
