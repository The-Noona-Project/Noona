# Komf Flows

## Managed Startup Flow

- Warden owns the managed `noona-komf` descriptor and default env values.
- Moon edits the Komf YAML as `KOMF_APPLICATION_YML`.
- Warden writes that YAML into `/config/application.yml` for the container and may mount a host config directory if
  `KOMF_CONFIG_HOST_MOUNT_PATH` is set.
- The Komf image starts with `KOMF_CONFIG_DIR=/config`, so
  [../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/Application.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/Application.kt)
  prefers the directory-backed config automatically.
- `ConfigLoader` then applies env overrides like `KOMF_KAVITA_BASE_URI`, `KOMF_KAVITA_API_KEY`, and
  `KOMF_LOG_LEVEL` on top of YAML.
- `AppContext` builds provider, media-server, and notification modules, then starts the embedded server on the port
  captured at process start.

## Metadata Match Search Flow

- Moon asks Portal for metadata matches.
- Portal either uses Komf standalone search or series-aware search, depending on the route and available IDs.
- Portal's Komf client calls `/api/kavita/metadata/search`.
- Komf resolves the metadata service in this order:
  explicit `libraryId`,
  otherwise the library inferred from `seriesId`,
  otherwise the default metadata service.
- Results come back as provider/title/resultId records that Portal normalizes for Moon.
- If the selected provider is disabled for that library, Komf errors before Moon ever sees a match result.

## Metadata Apply And Details Flow

- Moon approves or previews a metadata match through Portal.
- When a `provider` and `providerSeriesId` pair is supplied, Portal calls Komf identify.
- Portal's Komf client posts `seriesId`, optional `libraryId`, `provider`, and `providerSeriesId` to
  `/api/kavita/metadata/identify`.
- Komf queues metadata work and returns a job id.
- Portal may also request `/api/kavita/metadata/series-details` before apply so the UI can inspect books, chapters, and
  volume ranges.
- Portal then continues its own cover-sync and Raven title-mapping logic around that result.
- A change that looks "purely Komf" can still break Moon messaging, cover sync, or recommendation approval UX.

## Moon Settings Flow

- Moon's settings page exposes a structured Komf editor rather than only a raw textarea.
- Admins can reorder providers, toggle them on or off, and fill a small set of provider credentials.
- Unknown provider keys are preserved, but only known providers get custom labels and credential controls.
- The raw YAML editor remains the fallback when parsing fails or advanced editing is needed.
- In managed Kavita mode, Moon hides `KOMF_KAVITA_API_KEY` from the generic env form because Noona derives it from the
  managed Kavita flow.
- After save, Sage forwards the service config update into Warden, and Warden restarts Komf if requested.

## Direct Config Patch Flow

- Komf also exposes `/api/config` read and patch routes.
- A patch request updates `AppConfig`, rebuilds modules, and writes config back through `ConfigWriter`.
- In Noona, this is not the primary admin path.
  The supported admin path is still Moon -> Sage -> Warden managed service config.
- If you change Komf's direct config patch behavior, think through whether Noona actually uses it or whether the
  Warden-managed flow is the real contract to preserve.
- Port changes made through `/api/config` are persisted but do not move the already-running listener until restart.

## Failure And Debugging Flow

- Invalid managed YAML causes Moon's structured editor to fall back to raw mode.
- Disabling every metadata provider leaves Komf running but effectively unable to find new metadata; `ConfigLoader`
  logs a warning for that case.
- Missing `KOMF_KAVITA_BASE_URI` or `KOMF_KAVITA_API_KEY` breaks Kavita connectivity and usually surfaces as failed
  metadata calls rather than a clean startup rejection.
- Warden does not define a Komf healthcheck, so route probes and logs matter more than container health state.
- Portal's admin-facing metadata errors explicitly tell people to inspect `/config/application.yml metadataProviders`
  and restart `noona-komf`.

## Regression Hotspots

- metadata route validation and query/body requirements
- provider enablement resolution by library
- YAML schema changes that break Moon's parser/editor
- provider credential key names and defaults
- Kavita route-path or payload changes that break Portal's Komf client
- startup/config-path behavior that breaks Warden-managed `/config` mounts
