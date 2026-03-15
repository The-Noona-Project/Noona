# Sage API Surface And Boundaries

## Route Modules

- setup and install surface:
  [../../../services/sage/routes/registerSetupRoutes.mjs](../../../services/sage/routes/registerSetupRoutes.mjs)
- auth and users:
  [../../../services/sage/routes/registerAuthRoutes.mjs](../../../services/sage/routes/registerAuthRoutes.mjs)
- admin settings and destructive actions:
  [../../../services/sage/routes/registerSettingsRoutes.mjs](../../../services/sage/routes/registerSettingsRoutes.mjs)
- browser-facing Raven and recommendations:
  [../../../services/sage/routes/registerRavenRoutes.mjs](../../../services/sage/routes/registerRavenRoutes.mjs)

## Public Route Groups

- public:
  `GET /health`, `GET /api/pages`
- setup and wizard:
  `/api/setup/services`,
  `/api/setup/layout`,
  `/api/setup/config`,
  `/api/setup/config/normalize`,
  `/api/setup/status`,
  `/api/setup/install`,
  `/api/setup/services/validate`,
  `/api/setup/services/preview`,
  `/api/setup/services/install/progress`,
  `/api/setup/services/installation/logs`,
  `/api/setup/services/:name/health`,
  `/api/setup/services/:name/logs`,
  `/api/setup/wizard/*`,
  `/api/wizard/*`,
  `/api/setup/verification/*`,
  `/api/setup/services/:name/test`
- setup helpers:
  `/api/setup/services/noona-portal/discord/validate`,
  `/api/setup/services/noona-portal/discord/roles`,
  `/api/setup/services/noona-portal/discord/channels`,
  `/api/setup/services/noona-kavita/service-key`,
  `/api/setup/services/noona-raven/detect`
- auth:
  `/api/auth/bootstrap*`,
  `/api/auth/discord/config`,
  `/api/auth/discord/start`,
  `/api/auth/discord/callback`,
  `/api/auth/login`,
  `/api/auth/status`,
  `/api/auth/logout`,
  `/api/auth/users*`
- admin settings:
  `/api/settings/debug`,
  `/api/settings/discord/onboarding-message`,
  `/api/settings/downloads/*`,
  `/api/settings/services*`,
  `/api/settings/ecosystem/*`,
  `/api/settings/factory-reset`,
  `/api/settings/vault/*`
- authenticated media:
  `/api/media/background-track`
- Raven and recommendations:
  `/api/raven/*`,
  `/api/recommendations*`,
  `/api/myrecommendations*`,
  `/api/mysubscriptions*`

## Boundary Rules

- Moon and the browser should only consume Sage's HTTP contract.
  They should not speak directly to Warden, Vault, Raven, or Portal.
- Sage is allowed to proxy into:
  Warden for install and lifecycle state,
  Vault for users, settings, sessions, and wizard state,
  Raven for library or download actions,
  Portal for metadata helpers,
  Discord for OAuth and setup validation.
- Sage should not become a second source of truth for service config.
  If a value belongs to Warden, write it through Warden; if it belongs to Vault, write it through Vault.

## Auth Gates

- `/health` is public.
- Setup and wizard routes are intentionally usable before setup completes.
  They rely on `resolveSetupCompleted()` instead of a separate explicit install-mode flag.
- `registerSettingsRoutes.mjs` applies `requireAdminSessionIfSetupCompleted` to `/api/settings`.
  Before setup completion the surface stays reachable for first-run; after completion it becomes admin-only.
- `registerMediaRoutes.mjs` applies `requireSessionIfSetupCompleted` to `/api/media`.
  Moon should consume the track through its own `/api/noona/media/background-track` proxy instead of linking the Sage
  route directly in the browser UI.
- `registerRavenRoutes.mjs` applies `requireSessionIfSetupCompleted` to the Raven and recommendation path groups.
- User-management routes require `user_management`.
  Some auth config routes become admin-only once setup is complete.
- Session creation always requires `moon_login`, even if the user exists and authenticated successfully.

## Upstream Discovery And Ownership

## Warden

- Implementation:
  [../../../services/sage/app/createSetupClient.mjs](../../../services/sage/app/createSetupClient.mjs)
- URL discovery order:
  explicit client URLs, then `WARDEN_BASE_URL`, `WARDEN_INTERNAL_BASE_URL`, `WARDEN_DOCKER_URL`, then
  `WARDEN_HOST` or `WARDEN_SERVICE_HOST` plus `WARDEN_PORT`, then Docker or localhost fallbacks.
- Auth:
  `Authorization: Bearer <token>` from the explicit client token or `WARDEN_API_TOKEN` or `WARDEN_ACCESS_TOKEN`.
- Public health now distinguishes transport readiness from bootstrap readiness.
  Sage should treat Warden `ready: false` as "process is alive but startup is still in progress", not as a completed
  control-plane boot.

## Vault

- Implementations:
  [../../../services/sage/clients/vaultPacketClient.mjs](../../../services/sage/clients/vaultPacketClient.mjs),
  [../../../services/sage/wizard/wizardStateClient.mjs](../../../services/sage/wizard/wizardStateClient.mjs)
- Both clients require a Vault API token and retry across explicit plus environment-derived endpoints.
- Managed defaults expect `https://noona-vault:3005` plus `VAULT_CA_CERT_PATH`.
  Packet/settings traffic should fail closed if the CA material is missing or invalid.
- Trust handling now has two layers:
  mutate runtime default CAs when the Node version supports it, otherwise attach the CA per request through fetch
  options.
- Packet operations split between:
  `/v1/vault/handle` for Mongo and Redis packets,
  `/api/users*` for user CRUD and authentication.
- Wizard-state storage may still fall back locally when Vault trust material is unavailable during first-run or partial
  outage paths.
  Missing pre-install CA material should short-circuit before fetch and only log once, but do not copy that fallback
  pattern into the general Vault packet client casually.

## Raven And Portal

- Implementations:
  [../../../services/sage/clients/ravenClient.mjs](../../../services/sage/clients/ravenClient.mjs),
  [../../../services/sage/clients/portalClient.mjs](../../../services/sage/clients/portalClient.mjs)
- Candidate order:
  explicit Sage config, then Warden-discovered service URLs, then environment fallbacks.
- Successful endpoints are promoted and cached, so one healthy candidate can mask others until the next failure.

## Discord

- Setup validation and resource creation use
  [../../../services/sage/clients/discordSetupClient.mjs](../../../services/sage/clients/discordSetupClient.mjs).
- OAuth login and callback handling live in
  [../../../services/sage/routes/registerAuthRoutes.mjs](../../../services/sage/routes/registerAuthRoutes.mjs) and
  the shared helpers in [../../../services/sage/app/createSageApp.mjs](../../../services/sage/app/createSageApp.mjs).

## Error Model

- Caller mistakes should throw or return `SetupValidationError` and surface as `400`.
- Upstream outages, unexpected responses, or persistence failures generally surface as `502`.
- Keep browser-facing errors concise and token-safe.
  Route handlers should not leak raw upstream headers, stack traces, or auth material.
