# Moon Setup Environment Configuration

The Moon setup wizard now surfaces every configurable environment variable per service before installation. When you select one or more services you will see a configuration panel that lists the variables, their defaults, and any warnings associated with them. Read-only fields (for example auto-generated Vault tokens) appear with a lock icon and cannot be modified.

The wizard submits your changes to Sage, which forwards a normalized payload to Warden. Warden merges the overrides into each container's descriptor before the Docker containers are created, ensuring that advanced users can tailor ports, base URLs, or other settings when necessary.

## Usage tips

- Leave the defaults in place unless you have a specific reason to change them. The panel includes a prominent warning to emphasise this.
- Editable fields include descriptive hints and warnings pulled from the underlying service descriptors.
- All submitted values are validated server-side. Invalid payloads are rejected with actionable error messages.

This flow is covered by automated tests in `services/sage/tests` and `services/warden/tests`, and the Vue UI rendering the panel lives in `services/moon/src/pages/Setup.vue`.

## Raven manual configuration

If Warden cannot discover your Kavita container automatically, the setup wizard now exposes two optional fields for Raven:

- **Raven Downloads Root (`APPDATA`)** – The directory *inside the container* that Raven should treat as the base for `Noona/raven/downloads`. Leave this blank to fall back to Raven's default, or set it to a path such as `/kavita-data` when you want to bind a dedicated mount.
- **Kavita Data Mount (`KAVITA_DATA_MOUNT`)** – The host path that contains your Kavita library data. When provided, Warden binds this directory into the container at the downloads root so Raven can persist files alongside your existing library.

Supplying both values lets you steer the exact mapping (for example `/srv/kavita` on the host mounted to `/downloads` inside Raven). If you only provide the host path, Warden defaults the container path to `/kavita-data`. These overrides are forwarded to Warden, which now injects the corresponding environment variables and Docker volume mapping before Raven starts.
