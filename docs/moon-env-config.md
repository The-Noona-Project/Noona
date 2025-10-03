# Moon Setup Environment Configuration

The Moon setup wizard now surfaces every configurable environment variable per service before installation. When you select one or more services you will see a configuration panel that lists the variables, their defaults, and any warnings associated with them. Read-only fields (for example auto-generated Vault tokens) appear with a lock icon and cannot be modified.

The wizard submits your changes to Sage, which forwards a normalized payload to Warden. Warden merges the overrides into each container's descriptor before the Docker containers are created, ensuring that advanced users can tailor ports, base URLs, or other settings when necessary.

## Usage tips

- Leave the defaults in place unless you have a specific reason to change them. The panel includes a prominent warning to emphasise this.
- Editable fields include descriptive hints and warnings pulled from the underlying service descriptors.
- All submitted values are validated server-side. Invalid payloads are rejected with actionable error messages.

This flow is covered by automated tests in `services/sage/tests` and `services/warden/tests`, and the Vue UI rendering the panel lives in `services/moon/src/pages/Setup.vue`.
