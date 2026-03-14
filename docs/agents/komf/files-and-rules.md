# Komf Files And Rules

## Important Files

- [komf-app/src/main/kotlin/snd/komf/app/api/MetadataRoutes.kt](../../../services/komf/komf-app/src/main/kotlin/snd/komf/app/api/MetadataRoutes.kt):
  metadata API surface used by Noona.
- [../../../services/warden/docker/komfConfigTemplate.mjs](../../../services/warden/docker/komfConfigTemplate.mjs):
  managed `application.yml` template.
- [../../../services/moon/src/components/noona/settings/KomfApplicationEditor.tsx](../../../services/moon/src/components/noona/settings/KomfApplicationEditor.tsx):
  Moon editor for managed config.
- [../../../services/portal/routes/registerPortalRoutes.mjs](../../../services/portal/routes/registerPortalRoutes.mjs):
  Portal bridge routes that depend on Komf behavior.

## Rules

- Managed Komf config lives in Warden's template and service settings flow, not in ad hoc service-local defaults.
- Metadata contract changes usually affect Komf, Portal, Moon, and sometimes Raven together.
- Admin-visible metadata-flow changes should update public/admin docs.
