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
- Wizard state is written through `wizardStateClient`.
  Vault Redis is preferred, but a local in-process fallback lets setup continue before Vault is installed.
- Verification is not advisory.
  `/api/setup/wizard/complete` refuses to finish until verification checks ran and all supported checks passed.

## Managed Kavita Provisioning Flow

- `POST /api/setup/services/noona-kavita/service-key` is Sage's bridge between Moon, Warden, and Kavita.
- The flow:
  load current `noona-kavita` plus target service configs from Warden, inspect existing target env keys, try stored
  Sage-side service-account settings, optionally provision or log into Kavita, then patch target service env and ask
  Warden to restart those services.
- Target services are intentionally limited to `noona-portal`, `noona-raven`, and `noona-komf`.
- If multiple target services already contain different Kavita API keys, Sage returns `409` instead of picking one.
- Provisioned account and API-key details are mirrored into the Sage settings collection under
  `setup.managedKavitaServiceAccount`.

## Auth, Bootstrap, And User Flow

- Local bootstrap starts with `POST /api/auth/bootstrap`.
  This only creates an in-memory pending admin; it is not persisted until an authenticated admin finalizes it.
- `POST /api/auth/bootstrap/finalize` writes the pending admin to Vault, seeds default settings, and keeps the current
  session alive by rewriting the session token.
- Discord OAuth has three modes:
  `test`, `bootstrap`, and `login`.
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
- VPN test-login preserves the stored password when the caller sends the masked placeholder `********`.
- Service config, restart, image update, and ecosystem lifecycle endpoints proxy back into Warden through
  `setupClient`.
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
