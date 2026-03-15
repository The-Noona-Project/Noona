# Sage Auth, Bootstrap, And State

## Session Storage

- Session tokens are random `base64url` values generated in
  [../../../services/sage/app/createSageApp.mjs](../../../services/sage/app/createSageApp.mjs).
- Default storage prefix is `noona:session:`.
- TTL comes from `auth.sessionTtlSeconds`, then `NOONA_SESSION_TTL_SECONDS` or `AUTH_SESSION_TTL_SECONDS`, and falls
  back to `86400` seconds.
- Session writes go to in-memory storage first, then best-effort to Vault Redis.
  Reads prefer Vault Redis and refill the in-memory cache when possible.
- This fallback is intentional.
  First-run and partial Vault outages should not instantly kill every active browser session.

## Discord OAuth State

- OAuth state uses prefix `noona:discord:oauth:` and defaults to a `600` second TTL.
- Sage stores `mode`, `redirectUri`, `returnTo`, and `startedAt` under that state token.
- `returnTo` is normalized through `buildOauthRedirectTarget()`.
  Absolute URLs are only accepted when they share origin with the provided `redirectUri`.
- OAuth state is consumed once on callback and deleted from both memory and Vault Redis.

## First Admin Bootstrap

- Local bootstrap starts with `POST /api/auth/bootstrap`.
  Sage validates username and password, stores an in-memory pending admin, and returns `persisted: false`.
- The pending admin can log in before Vault user storage exists.
  `authenticatePendingAdmin()` is checked before Vault-backed auth.
- `POST /api/auth/bootstrap/finalize` persists the pending admin into Vault and rewrites the current session token so
  the browser stays logged in.
- Discord bootstrap skips the pending-admin state.
  `mode=bootstrap` on the OAuth callback writes the Discord identity directly as the admin user and creates a session.
- Bootstrap writes are not additive.
  `writeAdminToVault()` and `writeDiscordAdminToVault()` demote other admin users back to member defaults.

## User Storage And Permission Defaults

- Sage only exposes the full user-management surface when Vault user APIs are configured.
  Without them, user CRUD routes return `503`.
- Default member permissions live in the settings collection under `auth.default_member_permissions`.
- Normalization rules:
  `moon_login`, `mySubscriptions`, and `myRecommendations` are always present for default members.
- `manageRecommendations` implies `myRecommendations`.
- Admin users always receive `admin`.
  Non-admin users have `admin` stripped even if it was supplied in the request.
- New Discord logins auto-create a Noona account from the current default member permissions when no matching user
  exists.
- The active bootstrap account is protected.
  Normal user update, password-reset, and delete routes reject changes to that user.

## Wizard State

- Wizard state shape lives in
  [../../../services/sage/wizard/wizardStateSchema.mjs](../../../services/sage/wizard/wizardStateSchema.mjs).
- Current contract:
  `version = 2`,
  steps are `foundation`, `portal`, `raven`, and `verification`,
  default Redis key is `noona:wizard:state`.
- Wizard state is stored through Vault Redis at `/v1/vault/handle` when possible.
- The client also keeps a local fallback snapshot.
  `resetState()` with `null` clears that fallback, which is why a later read can drop back to default state after a
  reset.
- If `VAULT_CA_CERT_PATH` is missing or unreadable before managed Vault TLS exists, the wizard-state client skips the
  Vault fetch, logs the trust fallback once, and keeps using the local snapshot until
  `<NOONA_DATA_ROOT>/vault/tls/ca-cert.pem` is ready.
- That fallback is intentionally narrower than the general Vault packet client.
  Wizard state may wait for managed TLS, but regular Vault packets still stay HTTPS-only and use per-request CA trust
  when the runtime cannot update global defaults dynamically.
- This exception is only for wizard-state continuity.
  Packet/settings Vault clients should still fail closed on real trust errors after install.
- `createWizardStatePublisher()` maps service names into wizard steps so install progress can update the wizard
  without Moon knowing the raw lifecycle graph.
- `resolveSetupCompleted()` is just a cached read of `wizardState.completed`.
  The current cache window is `3000` ms.

## Seeded Settings And Shared State

- The first successful admin persistence calls `ensureDefaultSettings()`.
- That seeding path creates defaults for:
  downloads naming,
  Discord onboarding message,
  debug mode,
  default member permissions,
  download worker settings,
  and download VPN settings.
- Debug is special.
  Existing persisted debug state is reapplied to Sage's live logger mode during startup.

## Dangerous Action Confirmation

- Confirmation mode depends on auth provider.
- Local-auth users must confirm with their password, which reuses Vault-backed auth verification.
- Discord-auth users confirm by typing one of their current identity values such as username or Discord display name.
- This behavior affects Vault wipes and factory reset routes in
  [../../../services/sage/routes/registerSettingsRoutes.mjs](../../../services/sage/routes/registerSettingsRoutes.mjs).
