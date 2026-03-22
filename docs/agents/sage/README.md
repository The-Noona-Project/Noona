# Sage AI Notes

Sage is Noona's Moon-facing broker for setup, auth, user management, admin settings, and browser-safe Raven or
Portal actions.

## Read In This Order

- [files-and-rules.md](files-and-rules.md)
  Important files, invariants, and the tests most likely to catch regressions.
- [api-surface-and-boundaries.md](api-surface-and-boundaries.md)
  Route groups, auth gates, upstream ownership, and where Sage is allowed to proxy.
- [auth-bootstrap-and-state.md](auth-bootstrap-and-state.md)
  Pending-admin bootstrap, Discord OAuth, session storage, user defaults, and wizard-state persistence.
- [flows.md](flows.md)
  The high-value setup, settings, managed Kavita, and Raven recommendation flows.

## Core Concepts

- Moon should talk to Sage, not directly to Warden, Vault, Raven, or Portal.
  If that changes, it is a boundary redesign, not a small refactor.
- Sage is a broker, not the source of truth for most infrastructure state.
  Warden owns install and service lifecycle state, Vault owns persistent settings and users, Raven owns download and
  library state, and Portal owns metadata helpers.
- `createSetupClient.mjs` is the only supported Warden bridge inside Sage.
  It normalizes install payloads, carries the Warden bearer token, and discovers Warden across Docker and local-host
  fallback URLs.
- Setup completion changes auth behavior.
  Routes guarded by `requireSessionIfSetupCompleted` or `requireAdminSessionIfSetupCompleted` are intentionally open
  during first-run, then become protected once the wizard is marked complete.
- Sessions, Discord OAuth state, and wizard state try Vault Redis first and keep in-memory fallbacks.
  This is what lets first boot and partial-outage flows keep working.
- Managed Sage-to-Vault traffic is expected to use internal HTTPS plus explicit CA trust material.
  Packet/settings calls should fail closed on trust errors, while wizard-state storage may still keep its local
  fallback for first-run continuity.
  Managed Kavita setup is the exception on the setup surface: the optional stored-settings read or mirror may defer
  during Vault CA warm-up so provisioning can still complete.
- Sage seeds several admin settings in Vault on first successful admin persistence.
  Naming templates, onboarding message, default permissions, debug, worker settings, and VPN settings all originate in
  [../../../services/sage/app/createSageApp.mjs](../../../services/sage/app/createSageApp.mjs).
- VPN settings writes are validated in Sage before they reach Vault.
  Only the PIA provider is accepted, because Raven only supports PIA OpenVPN profiles.

## Most Common Edit Targets

- app wiring and shared auth or settings helpers:
  [../../../services/sage/app/createSageApp.mjs](../../../services/sage/app/createSageApp.mjs)
- Warden discovery and setup proxy behavior:
  [../../../services/sage/app/createSetupClient.mjs](../../../services/sage/app/createSetupClient.mjs)
- setup wizard, verification, Discord validation, and managed Kavita setup:
  [../../../services/sage/routes/registerSetupRoutes.mjs](../../../services/sage/routes/registerSetupRoutes.mjs)
- local auth, Discord OAuth, sessions, users, and default permissions:
  [../../../services/sage/routes/registerAuthRoutes.mjs](../../../services/sage/routes/registerAuthRoutes.mjs)
- admin settings, dangerous actions, and ecosystem restarts:
  [../../../services/sage/routes/registerSettingsRoutes.mjs](../../../services/sage/routes/registerSettingsRoutes.mjs)
- browser-facing Raven and recommendation flows:
  [../../../services/sage/routes/registerRavenRoutes.mjs](../../../services/sage/routes/registerRavenRoutes.mjs)
- Vault packet, Raven, Portal, and Discord clients:
  [../../../services/sage/clients/](../../../services/sage/clients/)
- wizard schema and persistence:
  [../../../services/sage/wizard/](../../../services/sage/wizard/)

## Cross-Service Touchpoints

- Warden:
  install, layout, service health, logs, config, updates, restart, and factory reset all proxy through Sage.
- Vault:
  auth users, settings documents, sessions, OAuth state, and wizard state all depend on Vault APIs when available.
- Moon:
  Moon depends on Sage's public contract for setup, login, user management, settings, and Raven browser actions.
- Portal:
  metadata matching and Raven title volume mapping stay in Portal, with Sage calling it on behalf of Moon.
- Raven:
  download, library, VPN, and recommendation approval side effects depend on Sage's Raven client.
  VPN rotate stays async-accepted, while VPN login-test returns Raven's final probe result directly to Moon.

## Update Checklist

- If install, login, permissions, or user-management behavior changes, update
  [../../../ServerAdmin.md](../../../ServerAdmin.md).
- If the Moon-visible setup, auth, or settings surface changes, update
  [../../../services/sage/README.md](../../../services/sage/README.md).
- If Warden proxy rules or upstream discovery change,
  update [api-surface-and-boundaries.md](api-surface-and-boundaries.md).
- If Vault client trust or fallback behavior changes,
  update [api-surface-and-boundaries.md](api-surface-and-boundaries.md)
  and [auth-bootstrap-and-state.md](auth-bootstrap-and-state.md).
- If sessions, bootstrap, or wizard persistence changes,
  update [auth-bootstrap-and-state.md](auth-bootstrap-and-state.md).
