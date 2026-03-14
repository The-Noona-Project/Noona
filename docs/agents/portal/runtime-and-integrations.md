# Portal Runtime And Integrations

## Config Contract

- Config loads through [portalConfig.mjs](../../../services/portal/config/portalConfig.mjs).
- Required non-Discord config is:
  `KAVITA_API_KEY`, `VAULT_BASE_URL`, and one of `VAULT_ACCESS_TOKEN` or `VAULT_API_TOKEN`.
- Managed installs now default `VAULT_BASE_URL` to `https://noona-vault:3005`.
  When Vault uses HTTPS, Portal also needs `VAULT_CA_CERT_PATH`.
- Discord config is optional, but if any Discord env is present then all of these are required:
  `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`.
- Portal defaults managed service URLs when not overridden:
  `noona-kavita:5000`, `noona-komf:8085`, `noona-raven:8080`, and `noona-warden:4001`.
- Public/user-facing links should prefer external URLs when configured:
  `KAVITA_EXTERNAL_URL` and `MOON_BASE_URL`.

## Join And Token Defaults

- Join defaults come from `PORTAL_JOIN_DEFAULT_ROLES` and `PORTAL_JOIN_DEFAULT_LIBRARIES`.
- Default roles are `*,-admin`.
- Default libraries are `*`.
- Onboarding token storage defaults to Redis namespace `portal:onboarding` with a 900-second TTL.

## Client Boundaries

- [vaultClient.mjs](../../../services/portal/clients/vaultClient.mjs)
    - Reads/writes `portal/<discordId>` secrets.
    - Stores recommendations in `portal_recommendations`.
    - Stores subscriptions in `portal_subscriptions`.
    - Provides Redis helpers used by the DM queue and onboarding flows.
    - Loads the managed Vault CA before HTTPS requests instead of disabling TLS verification globally.
- [ravenClient.mjs](../../../services/portal/clients/ravenClient.mjs)
    - Searches Raven titles.
    - Reads library, title, and download status/history/summary.
    - Updates title metadata and applies chapter-volume maps.
- [komfClient.mjs](../../../services/portal/clients/komfClient.mjs)
    - Searches metadata.
    - Applies provider-series identify calls.
    - Fetches series-details used to derive Raven volume maps.
- [kavitaClient.mjs](../../../services/portal/clients/kavitaClient.mjs)
    - Manages users, roles, libraries, scans, title search, metadata status, metadata matches, and cover art.
    - Resolves configured role/library expressions like `*`, `-admin`, and explicit ids or names.
- [wardenClient.mjs](../../../services/portal/clients/wardenClient.mjs)
    - Is intentionally read-only.
    - Current use is install progress, installed service discovery, and recent service history.

## Warden Boundary

- Portal should not become a second Warden control plane by accident.
- Today Warden is used to:
  resolve live install activity for bot presence
  resolve Moon service URLs for recommendation/admin-comment links
  inspect recent service history for display logic
- If a task wants to add start/stop/install mutations through Portal, treat that as a higher-risk design change.

## Runtime Services

- [portalRuntime.mjs](../../../services/portal/app/portalRuntime.mjs) creates all upstream clients before deciding
  whether to start Discord.
- If Discord is enabled, Portal also starts:
  `presenceUpdater`
  `recommendationNotifier`
  `subscriptionNotifier`
- The HTTP server still starts after Discord boot. Discord is not a separate process.

## Helpful Environment Flags

- `PORTAL_REDIS_NAMESPACE`
- `PORTAL_TOKEN_TTL`
- `PORTAL_ACTIVITY_POLL_MS`
- `PORTAL_RECOMMENDATION_POLL_MS`
- `PORTAL_HTTP_TIMEOUT`
- `REQUIRED_GUILD_ID`
- `REQUIRED_ROLE_<COMMAND>`

## Useful Editing Reminders

- External URL handling matters because Moon and Discord messages should not leak internal container-only URLs when a
  public URL is configured.
- Config validation is part of the product behavior. Tests in
  [config.test.mjs](../../../services/portal/tests/config.test.mjs) are a good first read before changing env rules.
- The route file is large because Portal is the browser-facing bridge for several subsystems. Prefer adding helpers
  instead of making `registerPortalRoutes.mjs` even more monolithic when possible.
