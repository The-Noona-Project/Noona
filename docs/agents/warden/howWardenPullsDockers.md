# How Warden Pulls Docker Images

## Image Resolution Starts In The Descriptor Layer

- Descriptors in [../../../services/warden/docker/noonaDockers.mjs](../../../services/warden/docker/noonaDockers.mjs)
  and [../../../services/warden/docker/addonDockers.mjs](../../../services/warden/docker/addonDockers.mjs) declare the
  managed images.
- Managed Noona image names are usually built through
  [../../../services/warden/docker/imageRegistry.mjs](../../../services/warden/docker/imageRegistry.mjs).
- The default namespace is `docker.darkmatterservers.com/the-noona-project` and the default tag is `latest`.

If you change registry, namespace, or managed image names, update docs and helper scripts such as
[../../../scripts/run-warden.sh](../../../scripts/run-warden.sh)
and [../../../scripts/run-warden.ps1](../../../scripts/run-warden.ps1).

## Docker Operations Live In `dockerUtilties.mjs`

[../../../services/warden/docker/dockerUtilties.mjs](../../../services/warden/docker/dockerUtilties.mjs) is the
canonical Docker helper file.

Important note:

- the filename is intentionally misspelled as `dockerUtilties.mjs`
- many imports already depend on that spelling
- do not rename it casually

This module handles:

- Docker network creation
- attaching Warden to the Docker network
- container existence checks
- image pulls and pull-progress formatting
- container removal/reuse helpers
- bind-mount directory creation for host paths

## Explicit Pull / Update Flow

The main explicit image-refresh path is `api.updateServiceImage()` in
[../../../services/warden/core/registerDiagnosticsApi.mjs](../../../services/warden/core/registerDiagnosticsApi.mjs).

That flow:

1. resolves the effective descriptor image
2. inspects the local image id and digests
3. runs `docker pull`
4. compares before/after image id and digest state
5. restarts the service if the image changed and restart was not disabled
6. refreshes the service update snapshot

If the descriptor image reference cannot be parsed into registry/digest-checkable form, Warden still records a snapshot
but marks digest support accordingly.

## Startup Auto-Updates

`registerBootApi.mjs` reuses `api.updateServiceImage()` for startup auto-updates.

Important behavior:

- minimal boot checks Sage and Moon when `AUTO_UPDATES=true`
- full boot checks bootstrap services first, then the remaining managed services
- full boot defers restart/recreate effects until the staged lifecycle startup finishes deciding what needs recreation

This means startup auto-updates are part of lifecycle orchestration, not a separate system.

## Container Reuse Versus Recreate

Warden does not always destroy containers after a pull or restart-like action.

- normal boot uses `reuseStoppedContainer: true`
- `restartService()` recreates the specific service
- normal ecosystem stop/restart keeps containers unless removal is requested
- factory reset is the destructive path that removes containers and can also clean Docker artifacts

If you change pull/update logic, be careful not to accidentally turn normal restart flows into destructive recreation.

## Bind Mount Preparation

Before container start, Docker helpers create host directories for bind mounts when the source looks like a real host
path.

Rules:

- named Docker volumes are not pre-created on the host
- Windows absolute paths are parsed specially
- host-path creation failures are logged as warnings, not silent no-ops

This matters for storage-root and config-path changes because Warden assumes the host directories exist or can be
created.

## Network And Socket Assumptions

Warden init always ensures the control `noona-network` and private `noona-data-network` Docker networks exist.

- Warden attaches itself to the control network only.
- Managed Mongo and Redis stay on the private data network only.
- Managed Vault is the bridge service that joins both networks.

Docker access comes from the active Docker client resolved by `createWarden.mjs`. If image pulls or container detection
start failing, check the Docker socket/endpoint path first before changing descriptor logic.

## Safe Change Rules

- change descriptor images first, not scattered hard-coded pull logic
- keep update snapshot behavior intact when you touch image-refresh logic
- preserve the distinction between read-only update checks and actual pull/recreate operations
- update docs and scripts when image namespace assumptions change
