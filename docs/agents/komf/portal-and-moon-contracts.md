# Komf Portal And Moon Contracts

This note is about the Noona-side contract around Komf. Most breakages agents cause here do not come from deep Kotlin
logic; they come from drifting the Portal client, Moon editor, or Warden-managed YAML away from what Komf actually
accepts.

## Portal Client Contract

Portal's Komf client lives in
[../../../services/portal/clients/komfClient.mjs](../../../services/portal/clients/komfClient.mjs).

Current public methods:

- `searchSeriesMetadata(name, {seriesId, libraryId})`
  validates a non-empty name and calls `GET /api/kavita/metadata/search`
- `identifySeriesMetadata({seriesId, libraryId, provider, providerSeriesId})`
  validates all required identifiers and calls `POST /api/kavita/metadata/identify`
- `getSeriesMetadataDetails({provider, providerSeriesId, libraryId})`
  validates `provider` and `providerSeriesId` and calls `GET /api/kavita/metadata/series-details`

Important client behavior:

- numeric IDs are normalized to positive integers before sending
- IDs are stringified in the outbound query/body payload
- non-`2xx` responses throw an `Error` with attached `status` and `body`
- the client defaults to a `10000` ms timeout

Regression coverage for that contract lives in
[../../../services/portal/tests/komfClient.test.mjs](../../../services/portal/tests/komfClient.test.mjs).

## Portal Route Assumptions

Portal route wiring lives in
[../../../services/portal/routes/registerPortalRoutes.mjs](../../../services/portal/routes/registerPortalRoutes.mjs).

Important Noona assumptions:

- standalone metadata search uses Komf first when configured
- title-match apply uses Komf identify when a provider result is chosen
- admin-facing failure text explicitly tells people to check Komf `/config/application.yml metadataProviders`
- some failure text also tells admins to restart `noona-komf` and, in Kavita metadata cases, `noona-kavita`

If you change route paths, payloads, or error shape, update both the Portal client and the Portal route-layer messaging.

## Moon YAML Editor Contract

Moon's Komf editor lives in:

- [../../../services/moon/src/components/noona/settings/KomfApplicationEditor.tsx](../../../services/moon/src/components/noona/settings/KomfApplicationEditor.tsx)
- [../../../services/moon/src/components/noona/settings/komfConfig.ts](../../../services/moon/src/components/noona/settings/komfConfig.ts)

Important editor behavior:

- it parses YAML into a mutable object model, not a separate typed Komf schema
- provider ordering is derived from `metadataProviders.defaultProviders.*.priority`
- moving a provider rewrites priorities in steps of `10`
- unknown provider keys are preserved and shown with a generated label
- only `malClientId` and `comicVineApiKey` get dedicated credential fields today
- `mangaUpdates` gets `mode: API` inserted if the key is present without a mode
- parse failures fall back to raw-editor mode instead of silently dropping config

This means upstream provider additions are often partly supported automatically, but not fully surfaced in Moon until
you update the known-provider definitions and any credential UI.

## Setup Wizard Contract

Moon's setup flow handles Komf specially in
[../../../services/moon/src/components/noona/SetupWizard.tsx](../../../services/moon/src/components/noona/SetupWizard.tsx).

Important behavior:

- `KOMF_APPLICATION_YML` is hidden from the generic env-field list and edited through the dedicated Komf editor
- `KOMF_KAVITA_API_KEY` is hidden in managed Kavita mode because Noona derives it from the managed install flow
- advanced/debug views can still expose lower-level detail, so raw YAML remains part of the supported troubleshooting
  path

## What Must Move Together

- If Komf route paths or payloads change:
  update Portal client code, Portal tests, and these agent docs.
- If Komf YAML shape changes:
  update Warden's default template, Moon's YAML helpers/editor, and the admin docs.
- If provider names or credential keys change:
  update Portal assumptions, Moon provider definitions, and any Warden default YAML that seeds those providers.
