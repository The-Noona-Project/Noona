# Vault Files And Rules

## Important Files

- [app/createVaultApp.mjs](../../../services/vault/app/createVaultApp.mjs): app wiring.
- [auth/tokenAuth.mjs](../../../services/vault/auth/tokenAuth.mjs): bearer-token parsing.
- [auth/servicePolicy.mjs](../../../services/vault/auth/servicePolicy.mjs): service-level authorization boundaries.
- [routes/](../../../services/vault/routes/): system, user, and secret APIs.
- [users/](../../../services/vault/users/): user normalization and auth helpers.
- [utilities/database/packetParser.mjs](../../../utilities/database/packetParser.mjs): packet dispatch.

## Rules

- Preserve service-level auth boundaries unless the policy change is explicit and documented.
- Packet-handler behavior must stay predictable and should return consistent shapes.
- User/auth changes are admin-visible and should update public/admin docs when they affect operations.
