# Sage Flows

## Setup Proxy And Wizard Flow

- Sage is the browser-facing path into Warden setup, install, and service-management APIs.
  Moon should not need to know Warden host discovery, tokens, or the real managed-service set.
- `createSetupClient.mjs` discovers Warden in this order:
  explicit `baseUrl` or `baseUrls`, then `WARDEN_BASE_URL`, `WARDEN_INTERNAL_BASE_URL`, `WARDEN_DOCKER_URL`,
  then `WARDEN_HOST` or `WARDEN_SERVICE_HOST` plus `WARDEN_PORT`, then Docker or localhost fallbacks such as
  `http://noona-warden:4001`.
- Warden bearer auth comes from the explicit client token or `WARDEN_API_TOKEN` or `WARDEN_ACCESS_TOKEN`.
- `normalizeServiceInstallPayload()` is the shared validation path for install, preview, and validation routes.
  It accepts either raw names or `{name, env}` entries, strips empty env keys, and rewrites `kavita` to
  `noona-kavita`.
- Setup route groups:
  service catalog and layout, setup snapshot GET, normalize POST, save POST, install and install progress, service logs
  or health,
  wizard metadata or state, wizard step reset or broadcast, verification, service test endpoints, Discord setup
  helpers, managed Kavita service-key provisioning, and Raven mount detection.
- Setup-config routes preserve Warden's original HTTP status and JSON error payload when Warden responded.
  Moon should only see Sage `502` errors when the Sage-to-Warden proxy itself failed.
- Read-only setup calls now tolerate Warden cold starts.
  `listServices`, `getSetupConfig`, `getStorageLayout`, and `getInstallProgress` retry for a bounded window when Warden
  is reachable but still reports `ready: false` or is returning transient upstream bootstrap errors.
- Wizard state is written through `wizardStateClient`.
  Vault Redis is preferred, but a local in-process fallback lets setup continue before Vault is installed.
- Verification is not advisory.
  `/api/setup/wizard/complete` refuses to finish until verification checks ran and all supported checks passed.

## Managed Kavita Provisioning Flow

- `POST /api/setup/services/noona-kavita/service-key` is Sage's bridge between Moon, Warden, and Kavita.
- Moon uses that route for live setup-summary preparation, not for the initial direct install submit path.
  Direct install should save the snapshot and let Warden provision managed Kavita after `noona-kavita` starts.
- The flow:
  load current `noona-kavita` plus target service configs from Warden, using Sage's trusted `includeSecrets` opt-in
  when the summary path needs reusable managed-service env values; inspect existing target env keys; try stored
  Sage-side service-account settings; optionally provision or log into Kavita; then patch target service env and ask
  Warden to restart those services.
- Those Warden updates must stay narrow.
  Only send the consumer-specific Kavita env keys back to Warden, not the full service env map, or Warden will reject
  server-managed fields such as `SERVICE_NAME`.
- Masked setup placeholders are not usable Kavita credentials.
  Sage can still reuse an existing managed API key, but if live provisioning still needs the admin password it now
  returns a validation error that asks the admin to re-enter it.
- Redacted Warden config responses are not reusable key candidates either.
  Sage only gets raw target-service env values through Warden's Sage-only `includeSecrets` path; plain redacted
  `********` placeholders still must not be treated as candidate keys.
- Target services are intentionally limited to `noona-portal`, `noona-raven`, and `noona-komf`.
- Existing target-service keys that Warden already injected during install are reused directly on the summary path so
  Sage does not force a second Kavita admin login after install.
- Stored or recovered API keys are still not trusted blindly.
  Sage validates those fallback candidates through Kavita's plugin-auth endpoint before it persists the key into
  downstream config.
- If one candidate fails validation, Sage keeps trying other candidates before it attempts to create a fresh auth key.
- Provisioned account and API-key details are mirrored into the Sage settings collection under
  `setup.managedKavitaServiceAccount`.
- That settings mirror is now best-effort during first boot.
  If Vault trust is still warming up and `vault/tls/ca-cert.pem` is not mounted yet, Sage skips the optional read or
  mirror and still completes service-key provisioning for the selected managed services.

## Auth, Bootstrap, And User Flow

- Local bootstrap starts with `POST /api/auth/bootstrap`.
  This only creates an in-memory pending admin; it is not persisted until an authenticated admin finalizes it.
- `POST /api/auth/bootstrap/finalize` writes the pending admin to Vault, seeds default settings, and keeps the current
  session alive by rewriting the session token.
- Discord OAuth has three modes:
  `test`, `bootstrap`, and `login`.
- Saving Discord OAuth config treats the masked secret placeholder as "reuse the current stored client secret" when one
  already exists.
- `test` validates the Discord auth config and stores `lastTestedAt` plus `lastTestedUser`.
- `bootstrap` is only allowed before setup completes.
  It writes the Discord identity directly as the admin account and creates a session immediately.
- `login` matches or auto-creates a Discord-linked Noona user from the default member permissions, refreshes Discord
  profile fields, then requires `moon_login` before returning a session token.
- Local login first checks the in-memory pending admin, then Vault-backed users.
- User-management endpoints are permission-gated by `user_management`, not only by `admin`.
- Role and permission normalization matters:
  `manageRecommendations` implies `myRecommendations`, admin users always gain `admin`, and non-admin roles strip the
  `admin` permission back out.

## Settings, Restart, And Destructive Action Flow

- `registerSettingsRoutes.mjs` mounts `app.use('/api/settings', requireAdminSessionIfSetupCompleted)`.
  After setup completes, the entire settings surface expects an authenticated admin path.
- Debug updates write the setting in Vault, update Sage's live logger mode, and best-effort propagate to Warden,
  Raven, and Vault.
- Download naming, worker settings, VPN config, and Discord onboarding message all persist into the settings
  collection, not into Warden snapshots.
- VPN settings writes reject any provider other than `pia`.
- VPN test-login preserves the stored password when the caller sends the masked placeholder `********`, then returns
  Raven's final probe result instead of a queued-job acknowledgement.
- VPN rotate still behaves as an async-accepted action, but Sage now preserves Raven's returned success or failure
  status instead of always flattening it into `202`.
- Service config, restart, image update, and ecosystem lifecycle endpoints proxy back into Warden through
  `setupClient`.
- Warden-backed settings routes preserve upstream HTTP status and JSON payloads when Warden replied.
  Moon should only see a Sage-generated `502` here when the Sage-to-Warden hop itself failed, not when Warden already
  returned a concrete validation, conflict, or not-found response.
- Vault wipes and factory reset are intentionally two-phase:
  confirm identity or password, wipe or ask Warden to wipe, then queue or request an ecosystem restart rather than
  trying to rebuild state inline inside Sage.

## Raven And Recommendation Flow

- `registerRavenRoutes.mjs` puts `/api/raven`, `/api/recommendations`, `/api/myrecommendations`, and
  `/api/mysubscriptions` behind `requireSessionIfSetupCompleted`.
- Raven client discovery prefers explicit Sage config, then Warden-discovered `hostServiceUrl` or health URLs, then
  Docker or localhost defaults.
- Recommendation approval is more than a status flip.
  Sage may create a Raven title, pre-seed Portal's volume mapping, queue work in Raven, and append timeline events into
  Vault-backed recommendation documents.
- Recommendation comments, approvals, denials, and queue outcomes are timeline-driven.
  If those document shapes change, Moon and any admin review tooling will feel it.
