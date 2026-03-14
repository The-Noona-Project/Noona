# How Warden Pulls Docker Images

## Main Path

1. Descriptors in [docker/noonaDockers.mjs](../../../services/warden/docker/noonaDockers.mjs)
   and [docker/addonDockers.mjs](../../../services/warden/docker/addonDockers.mjs) declare the managed images.
2. [docker/imageRegistry.mjs](../../../services/warden/docker/imageRegistry.mjs) resolves the registry and namespace
   defaults.
3. [docker/dockerUtilties.mjs](../../../services/warden/docker/dockerUtilties.mjs) performs the Docker pull and
   container lifecycle work.
4. Install or restart routes
   in [core/registerServiceManagementApi.mjs](../../../services/warden/core/registerServiceManagementApi.mjs) use those
   helpers for explicit admin actions.
5. Boot-time auto-update checks in [core/registerBootApi.mjs](../../../services/warden/core/registerBootApi.mjs) use the
   same descriptor-driven image information.

## Practical Rules

- Add or change managed images in the descriptor layer first.
- If an image name or namespace changes, update public/admin docs and any helper scripts that mention it.
- Keep descriptor env metadata aligned with the real runtime behavior so Moon and setup flows stay truthful.
