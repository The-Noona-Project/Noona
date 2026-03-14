# Warden Boot And Restore Flows

## Startup Mode Selection

- `createWarden.mjs` derives `BOOT_MODE`, `DEBUG`, and `SUPER_MODE` from env.
- Minimal services are fixed to:
  `noona-sage`, `noona-moon`
- Required core data services are fixed to:
  `noona-mongo`, `noona-redis`, `noona-vault`
- Managed network placement is fixed to:
  `noona-mongo` and `noona-redis` on `noona-data-network` only,
  `noona-vault` on both `noona-network` and `noona-data-network`
- Default full boot order is:
  `noona-mongo -> noona-redis -> noona-vault -> noona-sage -> noona-moon -> noona-kavita -> noona-raven -> noona-komf -> noona-portal -> noona-oracle`

## `init()` Boot Decision

`api.init()` in `createWarden.mjs` decides whether to boot minimal or full:

1. ensure Docker connectivity
2. ensure the Docker control and data networks exist
3. attach the Warden container to the control network
4. ask whether setup is completed
5. if not completed, check whether installed managed services imply a restore path
6. boot full when setup is complete, `DEBUG=super`, or installed managed services exist
7. otherwise boot minimal

## Full Boot Staging

`registerBootApi.mjs` does not always start every selected service in one pass.

When persisted runtime config has not finished loading yet:

1. Start the required bootstrap services first.
2. Wait for Mongo and Redis through Docker health instead of direct Warden-side network probes.
3. Wait for persisted runtime config to load, retrying a few times.
4. Apply startup auto-update checks with restarts deferred.
5. Restart bootstrap services only if a config change or pulled image requires it.
6. Start the remaining managed services, optionally forcing recreation for services whose image changed.

This staging exists so Vault-backed config and managed Kavita access are available before Portal and Komf are recreated.

## Vault TLS During Boot

- When Warden is itself running inside a Linux container, it verifies that `NOONA_DATA_ROOT` is bind-mounted into the
  Warden container at the same absolute host path before starting managed Vault.
- Warden resolves the shared Vault storage root, syncs managed TLS env, and reuses or generates the internal CA and
  Vault leaf certificate under `NOONA_DATA_ROOT/<vault-folder>/tls`.
- Managed Vault clients default to `https://noona-vault:3005` and load the CA from `VAULT_CA_CERT_PATH`.
- Missing or invalid managed TLS material should fail boot or client initialization rather than silently dropping back
  to plain HTTP.

## Managed Kavita During Boot

- Boot and install flows treat `noona-kavita` specially.
- After managed Kavita starts, Warden can provision or recover its API key and inject that into dependent services such
  as Portal and Komf.
- During restore boot, Warden prefers login-only recovery and existing container env values before attempting more
  invasive provisioning.

## Persisted Selection Resolution

Warden determines the managed lifecycle set in this order:

1. setup snapshot `selectionMode` / `selected`
2. installed managed containers, when Docker is reachable
3. full fallback lifecycle set, ordered through `orderServicesForLifecycle`

Selection states:

- `minimal`: boot only the minimal services
- `selected`: boot required core services + minimal services + the selected managed services
- `unspecified`: fall back to installed-container detection or the broad lifecycle fallback

## Runtime Config Restore

Runtime override loading happens before or during boot and has a specific precedence:

1. setup snapshot `values`
2. persisted settings-store service config
3. local runtime snapshot file

Later sources mainly backfill missing values because merge order favors values already loaded from earlier sources. This
is easy to break if you change the restore merge logic casually.

If the settings-store read fails, Warden marks persisted runtime config as not fully loaded and may proceed using the
local snapshot fallback after retrying.

## Minimal Boot

Minimal boot starts Sage and Moon only.

- Sage health URL: `http://noona-sage:3004/health`
- Moon health URL comes from the descriptor and `WEBGUI_PORT`, defaulting to `http://noona-moon:3000/`

If `AUTO_UPDATES` is enabled, Warden checks Sage and Moon images before minimal startup.

## Start / Stop / Restart

- `startEcosystem()` chooses minimal vs full unless the caller forces one.
- `stopEcosystem()` stops the resolved managed lifecycle in reverse order unless it is restricted to tracked containers
  only.
- `restartEcosystem()` is a stop followed by a start with the same lifecycle helpers.
- Normal stop/restart keeps containers unless removal is explicitly requested.

## Factory Reset

Factory reset requires `confirm: "FACTORY_RESET"`.

It:

1. stops and removes managed containers
2. optionally deletes Raven downloads
3. optionally deletes Noona Docker artifacts
4. clears the persisted setup snapshot
5. clears the local runtime snapshot
6. clears in-memory runtime overrides
7. resets wizard state when available
8. boots back into the non-complete setup path

Any behavior change here needs matching updates in [../../../ServerAdmin.md](../../../ServerAdmin.md).
