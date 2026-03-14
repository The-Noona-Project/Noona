# Komf API And Config

## Live Route Shape

The embedded Ktor server is registered in
[../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/ServerModule.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/ServerModule.kt).

Important global details:

- static resources are served at `/`
- main API lives under `/api`
- both `/api/komga/*` and `/api/kavita/*` are registered
- deprecated route groups are still mounted for compatibility
- CORS is currently wide open with `anyHost()` and no auth middleware
- `IllegalArgumentException` becomes `400`
- `IllegalStateException` becomes `500`

Main route groups under `/api`:

- `/config`
- `/jobs`
- `/notifications`
- `/komga/metadata/*`
- `/komga/media-server/*`
- `/kavita/metadata/*`
- `/kavita/media-server/*`

For Noona, the most important live surface is the Kavita group:

- `/api/kavita/metadata/providers`
- `/api/kavita/metadata/search`
- `/api/kavita/metadata/series-cover`
- `/api/kavita/metadata/identify`
- `/api/kavita/metadata/series-details`
- `/api/kavita/metadata/match/library/:libraryId/series/:seriesId`
- `/api/kavita/metadata/match/library/:libraryId`
- `/api/kavita/metadata/reset/library/:libraryId/series/:seriesId`
- `/api/kavita/metadata/reset/library/:libraryId`
- `/api/kavita/media-server/connected`
- `/api/kavita/media-server/libraries`

## Route Semantics That Matter In Noona

- `GET /api/kavita/metadata/providers`
  optionally takes `libraryId` and returns providers enabled for that library; without it Komf uses the default
  metadata service.
- `GET /api/kavita/metadata/search`
  requires `name`. If `libraryId` is absent but `seriesId` is present, Komf resolves the library from the series before
  choosing a metadata service.
- `POST /api/kavita/metadata/identify`
  requires `seriesId`, `provider`, and `providerSeriesId`. If `libraryId` is missing, Komf derives it from the target
  series before queueing work.
- `GET /api/kavita/metadata/series-details`
  requires `provider` and `providerSeriesId`; `libraryId` is optional and changes whether Komf resolves a
  library-specific provider set or the default service.
- `GET /api/kavita/metadata/series-cover`
  is stricter and requires `libraryId`, `provider`, and `providerSeriesId`.
- provider HTTP failures caught as `ResponseException` are forwarded with the upstream status code and body text.

Portal's Komf client currently depends directly on:

- metadata search
- identify
- series-details

## Portal Contract

Portal client implementation:
[../../../services/portal/clients/komfClient.mjs](../../../services/portal/clients/komfClient.mjs)

Current request mapping:

- search:
  `GET /api/kavita/metadata/search?name=...&seriesId=...&libraryId=...`
- identify:
  `POST /api/kavita/metadata/identify`
- series details:
  `GET /api/kavita/metadata/series-details?provider=...&providerSeriesId=...&libraryId=...`

Portal route behavior:

- `title-match/search` uses Komf for standalone metadata lookup
- `title-match` prefers Komf when available and only falls back to Kavita metadata lookup if Komf is absent
- `title-match/apply` uses Komf identify when a `provider` and `providerSeriesId` pair is supplied
- Portal error text explicitly tells admins to check Komf `/config/application.yml metadataProviders` and restart
  `noona-komf`

If those routes, payload shapes, or error assumptions change, update Portal's client and metadata error mapping
together.

## Config Loading Rules

Runtime entrypoint:
[../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/Application.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/Application.kt)

Loader implementation:
[../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/ConfigLoader.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/config/ConfigLoader.kt)

Resolution rules are:

- if `KOMF_CONFIG_DIR` is set, `Application.kt` passes that directory into `AppContext`
- otherwise, if a file path is passed on the command line, Komf loads that file
- otherwise, `ConfigLoader.default()` looks for `./application.yml`
- if no readable default file exists, it falls back to `AppConfig()`

Post-processing then overrides pieces of YAML with environment variables.

Important active env overrides:

- `KOMF_KOMGA_BASE_URI`
- `KOMF_KOMGA_USER`
- `KOMF_KOMGA_PASSWORD`
- `KOMF_KAVITA_BASE_URI`
- `KOMF_KAVITA_API_KEY`
- `KOMF_SERVER_PORT`
- `KOMF_LOG_LEVEL`
- `KOMF_METADATA_PROVIDERS_MAL_CLIENT_ID`
- `KOMF_METADATA_PROVIDERS_COMIC_VINE_API_KEY`
- `KOMF_METADATA_PROVIDERS_BANGUMI_TOKEN`
- `KOMF_APPRISE_URLS`
- `KOMF_DISCORD_WEBHOOKS`

Current footgun:

- `ConfigLoader` reads `KOMF_METADATA_PROVIDERS_COMIC_VINE_SEARCH_LIMIT`, but the copied config object does not
  currently write that override back.
  Do not assume the env var works in this vendored copy without fixing and testing it.

Config-directory-aware paths:

- database file becomes `<configDir>/database.sqlite`
- MangaBaka DB dir becomes `<configDir>/mangabaka`
- notifications template dir becomes the config directory

## Config Persistence And Reload

- `AppContext.refreshState(newConfig)` updates `appConfig`, rebuilds provider/media-server/notification modules, and
  writes config back through `ConfigWriter`.
- `PATCH /api/config` therefore persists config changes to the active config path, but it does not recreate the
  embedded server.
- A `server.port` change can be written to config but the process still listens on the original port until restart.

## Noona Managed Config

Warden descriptor and defaults:

- [../../../services/warden/docker/addonDockers.mjs](../../../services/warden/docker/addonDockers.mjs)
- [../../../services/warden/docker/komfConfigTemplate.mjs](../../../services/warden/docker/komfConfigTemplate.mjs)

Current Noona-managed env surface:

- `KOMF_KAVITA_BASE_URI`
- `KOMF_KAVITA_API_KEY`
- `KOMF_LOG_LEVEL`
- `KOMF_CONFIG_HOST_MOUNT_PATH`
- `KOMF_APPLICATION_YML`

Important behavior:

- Moon edits `KOMF_APPLICATION_YML`
- Warden writes that YAML into `/config/application.yml` before managed Komf starts
- `KOMF_CONFIG_HOST_MOUNT_PATH` can swap the default `/config` backing folder for a host mount
- `normalizeManagedKomfConfigContent()` upgrades the legacy Noona YAML template to the current reduced-cover default
- Warden's `noona-komf` descriptor currently has `health: null`, so container liveness is inferred indirectly

## Moon Editor Contract

Moon's structured editor is split across:

- [../../../services/moon/src/components/noona/settings/KomfApplicationEditor.tsx](../../../services/moon/src/components/noona/settings/KomfApplicationEditor.tsx)
- [../../../services/moon/src/components/noona/settings/komfConfig.ts](../../../services/moon/src/components/noona/settings/komfConfig.ts)

Current editor behavior:

- provider toggles and priorities rewrite `metadataProviders.defaultProviders`
- provider moves reassign priorities in steps of `10`
- unknown provider keys from YAML are preserved and shown with a generated title-cased label
- credential fields currently cover only `malClientId` and `comicVineApiKey`
- raw YAML editor appears in debug/fallback cases or when parsing fails
- `mangaUpdates` keeps `mode: API` if not already set

If the upstream YAML schema shifts, the editor helper and the default template must be updated together.

## Build And Packaging

- Noona builds the shaded app jar from `:komf-app:shadowJar`
- the `komf-app` module targets JVM 17 and sets main class `snd.komf.app.ApplicationKt`
- runtime image is JRE 17 plus a Python venv for `apprise`
- default runtime env sets `KOMF_CONFIG_DIR=/config`
- image labels point back to the upstream GitHub project:
  [Snd-R/komf](https://github.com/Snd-R/komf)
