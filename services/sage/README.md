# Sage (Noona Stack 2.2)

Sage is the setup and proxy service for Noona. It fronts Warden install APIs, Discord setup helpers, and Raven
download/library routes for Moon and other clients.

## Quick Navigation

- [Service rules](AGENTS.md)
- [Stack overview](../../README.md)
- [Entrypoint](initSage.mjs)
- [App builder](app/createSageApp.mjs)
- [Setup client](app/createSetupClient.mjs)
- [Route modules](routes/)
- [Auth routes](routes/registerAuthRoutes.mjs)
- [Raven routes](routes/registerRavenRoutes.mjs)
- [Setup routes](routes/registerSetupRoutes.mjs)
- [Managed Kavita setup client](clients/managedKavitaSetupClient.mjs)
- [Downstream clients](clients/)
- [Wizard state](wizard/)
- [Tests](tests/)
- [Root docs](../../docs/)

## Core Responsibilities

- Proxy setup/install/status requests to Warden.
- Expose Discord setup validation helpers for Portal onboarding.
- Own Moon auth state, Discord OAuth config, Discord callback handling, Discord-linked user/session management, and
  the default permission template used when a Discord user signs in for the first time.
- Proxy Raven search/download/library/status routes.
- Serve Vault-backed recommendation records for Moon's recommendations page.
- Persist Vault-backed Raven naming and per-thread worker speed-limit settings for Moon.
- Normalize downstream failures into consistent API responses.

## Common Endpoint Groups

- Setup: `/api/setup/*`
    - `POST /api/setup/install?async=true` now proxies Warden's accepted/background install mode and returns the
      current install-progress snapshot immediately so Moon can keep polling instead of waiting on a long request.
- Managed Kavita setup: `/api/setup/services/noona-kavita/service-key`
    - waits for managed `noona-kavita`, accepts optional first-admin credentials from Moon or falls back to managed
      `noona-kavita` `KAVITA_ADMIN_*` env overrides from Warden, retries the full first-user `login -> register`
      acquisition flow when Kavita returns a transient first-user registration error before the account exists,
      including startup-time 5xx responses from Kavita's account API, reuses an existing Kavita auth key when one is
      already present, creates a named key only when needed, stores the reusable key
      metadata in `noona_settings`, and patches selected
      managed services
      (`noona-portal`, `noona-raven`, `noona-komf`) with the generated key plus the managed `http://noona-kavita:5000`
      base URL.
- Discord setup helpers: `/api/setup/services/noona-portal/discord/*`
    - validation now performs a real bot login, returns the detected application/client id, lists accessible guilds, and
      loads roles/channels when a guild is selected, falling back to Discord's REST guild resources when the gateway
      collections come back empty.
- Moon auth and Discord OAuth: `/api/auth/*`
    - `/api/auth/discord/config` stores the Discord OAuth client id/secret used by Moon setup and login.
    - `/api/auth/discord/start` creates a full Discord OAuth round-trip for callback testing, setup bootstrap, or normal
      Moon login.
    - `/api/auth/discord/callback` exchanges the code with Discord, records callback tests, bootstraps the first admin,
      auto-creates first-time Discord users from the configured default permission template, and signs in
      Discord-linked Moon users.
  - `/api/auth/users/*` now verifies Vault persistence on user edits and infers legacy Discord-linked records from
    stored Discord ids or `discord.<id>` lookup keys so Moon permission saves cannot report false success. Sage now
    emits the canonical `library_management` and `download_management` permissions while still accepting the legacy
    `lookup_new_title`, `download_new_title`, and `check_download_missing_titles` names on write, and it now updates
    users by stable lookup fields instead of serialized Mongo `_id` values so permission edits persist through Vault.
  - `/api/auth/users/default-permissions` reads and updates the default permission set used for new Discord-linked
    Moon accounts.
- Download settings: `/api/settings/downloads/*`
    - `/api/settings/downloads/naming` stores Raven naming templates in Vault.
    - `/api/settings/downloads/workers` stores per-thread Raven speed limits (`threadRateLimitsKbps`) in Vault.
      It accepts plain KB/s numbers plus `mb` / `gb` suffixes on write, and normalizes unlimited entries to `-1`.
- Raven proxy: `/api/raven/*`
    - `/api/raven/library/latest` exposes the Home page latest-title feed to any authenticated Moon session after
      setup, without opening the full library routes.
    - Library listing/title/file routes require `library_management` after setup completes.
    - Search, queue, download-status/history, and library-wide sync routes require `download_management` after setup
      completes.
- Recommendations admin routes: `/api/recommendations*`
    - `GET /api/recommendations` and `GET /api/recommendations/:id` require `manageRecommendations` and return
      normalized recommendation records (including timeline events such as `created`, `approved`, `denied`,
      `comment`, `download-started`, and `download-completed`).
    - `POST /api/recommendations/:id/approve` requires `manageRecommendations`, queues Raven download (`searchId` +
      `selectedOptionIndex`), marks the recommendation approved, and records an approval timeline event.
    - `POST /api/recommendations/:id/deny` requires `manageRecommendations`, marks the recommendation denied, stores
      optional denial reason, and records a denial timeline event.
    - `POST /api/recommendations/:id/comments` requires `manageRecommendations` and appends an admin comment timeline
      event.
    - `DELETE /api/recommendations/:id` requires `manageRecommendations` and closes/deletes the selected recommendation,
      retrying with a field-based fallback query when legacy/serialized `_id` values do not match Vault's stored Mongo
      `_id` type.
- Recommendations user routes: `/api/myrecommendations*`
    - `GET /api/myrecommendations` and `GET /api/myrecommendations/:id` require `myRecommendations` (or
      `manageRecommendations`) and return only recommendation records owned by the signed-in Discord user unless the
      caller is a manager.
    - `POST /api/myrecommendations/:id/comments` requires `myRecommendations` (or `manageRecommendations`) and appends a
      user/admin timeline reply event.

## Key Environment Variables

| Variable                                       | Purpose                                                                                  |
|------------------------------------------------|------------------------------------------------------------------------------------------|
| `API_PORT`                                     | Sage listener port (defaults in runtime)                                                 |
| `SERVICE_NAME`                                 | Service label used in logs                                                               |
| `SERVER_IP`                                    | Optional fallback LAN host for browser redirects when no explicit base URL is configured |
| `WARDEN_BASE_URL`                              | Preferred Warden base URL override                                                       |
| `RAVEN_BASE_URL`                               | Preferred Raven base URL override                                                        |
| `RAVEN_INTERNAL_BASE_URL` / `RAVEN_DOCKER_URL` | Additional Raven discovery overrides                                                     |

## Local Commands

```bash
cd services/sage
npm install
npm run start
npm test
```

## Documentation Rule

When adding or changing Sage routes, update this README and include links to the exact route/client files touched so
Moon and platform maintainers can trace behavior quickly.
