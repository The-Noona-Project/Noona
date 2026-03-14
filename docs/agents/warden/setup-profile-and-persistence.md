# Warden Setup Profile And Persistence

## Public Setup Contract

`core/setupProfile.mjs` defines the browser-facing setup profile.

Current public shape:

- `version`
- `storageRoot`
- `kavita`
  `mode`, `baseUrl`, `apiKey`, `sharedLibraryPath`, `account`
- `komf`
  `mode`, `baseUrl`, `applicationYml`
- `discord`
  bot/client/guild fields, per-command role gates, join defaults
- `savedAt`

This is the stable browser contract. Moon and Sage should not have to understand raw descriptor internals.

## Legacy Normalization

`normalizePublicProfile()` and `normalizeSetupProfileSnapshot()` accept older setup shapes and map them into the v3
profile.

Important behavior:

- legacy `selected`, `selectedServices`, and `services` arrays are accepted
- legacy `values` maps are accepted
- legacy `values.*.NOONA_DATA_ROOT` imports into top-level `storageRoot`
- legacy `integrations.kavita` and `integrations.komf` shapes are accepted
- service aliases like `kavita` and `komf` are normalized to `noona-kavita` and `noona-komf`
- `POST /api/setup/config/normalize` uses the same normalization rules without writing files or restarting services

Do not break legacy import behavior unless the migration is explicit and tested.

## Secret Masking

The public secret placeholder is `********`.

Mask-aware behavior:

- `toPublicSetupSnapshot(..., {maskSecrets: true})` replaces configured secret fields with the placeholder
- restore logic in `setupProfile.mjs` treats the placeholder as "reuse the current stored secret"
- `startWardenServer.mjs` applies the same idea to service config responses and writes

This is how Moon can save/import JSON without forcing admins to retype unchanged secrets.

## Normalize-Only Import Route

`startWardenServer.mjs` exposes `POST /api/setup/config/normalize` for review-only imports.

It:

1. parses legacy or current setup JSON
2. restores masked secrets from the current saved snapshot when possible
3. returns the normalized public profile back to Moon

It does not validate storage-root ownership, persist files, touch runtime overrides, or restart the ecosystem. Those
checks still belong to the real save path.

## Derived Internal Selection

The public profile is not the final install plan.

`deriveSetupProfileInternals()` computes:

- `selected`
- `selectionMode`
- `values`

Current derived rules:

- Portal and Raven are always selected in a normal managed setup profile
- managed Kavita adds `noona-kavita`
- managed Komf adds `noona-komf`
- `storageRoot` stays top-level setup metadata and is not mirrored into per-service runtime overrides
- Kavita and Komf managed/external modes rewrite the correct downstream env fields
- setup save and restore paths only persist derived env keys that belong to the editable runtime schema

If the public profile changes, update the derivation rules too.

## Snapshot Paths

`createWarden.mjs` reads and writes the setup snapshot in multiple locations.

Canonical path:

- `<NOONA_DATA_ROOT>/wardenm/noona-settings.json`

Mirrors kept for compatibility:

- `<NOONA_DATA_ROOT>/noona-settings.json`
- `<NOONA_DATA_ROOT>/warden/setup-wizard-state.json`

Warden reads these in order and writes all of them on save.

## Runtime Config Snapshot

Runtime service overrides are also mirrored locally.

Path:

- `<NOONA_DATA_ROOT>/warden/service-runtime-config.json`

This snapshot contains per-service env overrides and host-port overrides that survive restarts and help cold-boot
recovery.

## Runtime Config Restore Precedence

When Warden loads persisted runtime config, the current precedence is:

1. setup snapshot `values`
2. settings-store service config documents
3. local runtime snapshot file

Important nuance:

- later sources mostly backfill because merge order preserves values already loaded from earlier sources
- if the settings store is unavailable, Warden can still continue with the local runtime snapshot fallback

This precedence is subtle and easy to break. Do not "simplify" it without tracing restore behavior first.

## Save And Apply Flow

`api.saveSetupConfig()` in `createWarden.mjs` does more than write a file when `apply=true`.

It:

1. validates and normalizes the payload
2. writes the setup snapshot and mirror files
3. applies only the derived editable runtime config to the in-memory runtime state
4. persists that runtime config
5. stops the current ecosystem
6. restarts into minimal or full mode based on the resolved selection state

If any part of apply fails, Warden throws a `WardenApplyError` and attempts rollback:

- restore the previous setup snapshot or clear the new one
- restore the previous runtime config state

## Clearing Persisted Boot State

`clearPersistedBootState()` removes:

- the setup snapshot and mirror files
- the local runtime config snapshot
- in-memory runtime overrides
- wizard state, when the wizard-state client is available

Factory reset depends on this. Changes here affect both restore behavior and the post-reset boot path.

## Data Root Defaults

`storageLayout.mjs` resolves `NOONA_DATA_ROOT` with platform-aware defaults:

- Windows: `%APPDATA%\\noona`
- non-Windows: `/mnt/user/noona`

Use the storage helpers instead of open-coding path rules in random Warden modules.
