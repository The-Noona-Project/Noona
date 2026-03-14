# Komf AI Notes

Komf is a Noona-managed checkout of the upstream metadata service used to enrich Kavita libraries. Most of the Kotlin
implementation is upstream; Noona mainly owns how Komf is built, configured, wired into Warden, and consumed by Moon
and Portal.

## Read In This Order

- [files-and-rules.md](files-and-rules.md)
  Important files, vendor-boundary rules, and the runtime invariants agents usually trip over first.
- [api-and-config.md](api-and-config.md)
  Live Ktor route groups, config-path precedence, env overrides, and Noona-managed YAML behavior.
- [portal-and-moon-contracts.md](portal-and-moon-contracts.md)
  The exact Noona client/editor contract that breaks when Komf routes or YAML shape drift.
- [flows.md](flows.md)
  Startup, metadata search/apply, managed settings, and the main failure paths.

## Upstream Context

- Upstream Komf project:
  [Snd-R/komf](https://github.com/Snd-R/komf)
- Noona vendors this codebase and packages it into the `noona-komf` image, but many behavioral changes still belong
  conceptually to upstream Komf.
- If you are fixing broadly useful metadata-provider behavior rather than a Noona-specific integration seam, keep the
  upstream repo in mind and show them some love.

## Core Concepts

- The primary Noona runtime path is `noona-komf` on port `8085`, started from
  [../../../dockerfiles/komf.Dockerfile](../../../dockerfiles/komf.Dockerfile) with `KOMF_CONFIG_DIR=/config`.
- `Application.kt` prefers `KOMF_CONFIG_DIR` over a CLI config-file argument.
  In Noona's Docker flow that means `/config/application.yml` wins unless you intentionally change the image/runtime.
- The main Noona API contract is the Kavita route group under `/api/kavita/*`.
  Portal currently depends on `/api/kavita/metadata/search`, `/identify`, and `/series-details`.
- Warden is the source of truth for managed Komf config.
  Moon edits `KOMF_APPLICATION_YML`, Warden writes it into `/config/application.yml`, and Komf reads it at boot.
- Moon's structured Komf editor is a YAML transformer, not a second config model.
  If the YAML schema changes, update the Warden template and Moon helpers in the same change.
- Komf has permissive CORS and no built-in auth layer in `ServerModule`.
  Treat it as an internal service contract, not a standalone hardened public API.
- There are currently no service-local Komf tests in this vendored tree.
  The most relevant regression coverage for Noona's Komf usage lives in Portal's client tests.

## Most Common Edit Targets

- startup, config loading, and live reload:
  [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/Application.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/Application.kt),
  [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/AppContext.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/AppContext.kt),
  [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/ConfigLoader.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/ConfigLoader.kt),
  [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/ConfigWriter.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/ConfigWriter.kt)
- route registration and request handling:
  [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/ServerModule.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/ServerModule.kt),
  [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/MetadataRoutes.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/MetadataRoutes.kt),
  [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/ConfigRoutes.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/ConfigRoutes.kt)
- managed YAML defaults and normalization:
  [../../../services/warden/docker/komfConfigTemplate.mjs](../../../services/warden/docker/komfConfigTemplate.mjs),
  [../../../services/warden/docker/addonDockers.mjs](../../../services/warden/docker/addonDockers.mjs),
  [../../../services/moon/src/components/noona/settings/komfConfig.ts](../../../services/moon/src/components/noona/settings/komfConfig.ts),
  [../../../services/moon/src/components/noona/settings/KomfApplicationEditor.tsx](../../../services/moon/src/components/noona/settings/KomfApplicationEditor.tsx)
- Portal consumption and regression coverage:
  [../../../services/portal/clients/komfClient.mjs](../../../services/portal/clients/komfClient.mjs),
  [../../../services/portal/routes/registerPortalRoutes.mjs](../../../services/portal/routes/registerPortalRoutes.mjs),
  [../../../services/portal/tests/komfClient.test.mjs](../../../services/portal/tests/komfClient.test.mjs)
- Noona packaging and module layout:
  [../../../services/komf/settings.gradle.kts](../../../services/komf/settings.gradle.kts),
  [../../../services/komf/komf-app/build.gradle.kts](../../../services/komf/komf-app/build.gradle.kts),
  [../../../dockerfiles/komf.Dockerfile](../../../dockerfiles/komf.Dockerfile)

## Cross-Service Touchpoints

- Warden owns the `noona-komf` descriptor, env fields, default `application.yml`, and `/config` mount semantics.
- Moon owns the structured Komf editor and setup-wizard handling for `KOMF_APPLICATION_YML`.
- Portal owns the main user-facing search, identify, and series-details contract that calls Komf.
- Kavita is the primary media-server integration in Noona's managed Komf flow.

## Update Checklist

- If managed Komf config, metadata route behavior, or Kavita integration changes, update
  [../../../services/komf/README.md](../../../services/komf/README.md) and the matching agent docs.
- If Moon's Komf editor or setup behavior changes, update the Moon agent docs and
  [../../../ServerAdmin.md](../../../ServerAdmin.md).
- If Portal's Komf route contract changes, update
  [../../../services/portal/clients/komfClient.mjs](../../../services/portal/clients/komfClient.mjs),
  [../../../services/portal/tests/komfClient.test.mjs](../../../services/portal/tests/komfClient.test.mjs),
  and the Portal agent docs in the same change.
