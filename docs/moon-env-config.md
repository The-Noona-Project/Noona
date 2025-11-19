# Moon Setup Environment Configuration

Moon's setup wizard now runs inside the unified OneUI shell and surfaces every configurable environment variable per service before installation. When you select a service you land on a split layout: the OneUI navigation rail and header stay fixed on the left, while the main column renders the wizard with a stepper, context panel, and timeline. The shell also includes the new OneUI navigation buttons, mobile drawer, and color-mode toggle defined in `services/moon/src/components/Header.jsx`, so the docs below use OneUI terminology rather than the older Chakra labels.【F:services/moon/src/components/Header.jsx†L1-L139】

## OneUI layout and navigation cues

- **Stepper row.** `services/moon/src/pages/Setup.tsx` renders a OneUI-styled progress bar (`SetupStepper`) across the top of the wizard column. Each step tile shows status chips (current, complete, error) and optional badges, replacing the previous Chakra stepper copy.【F:services/moon/src/pages/Setup.tsx†L1-L126】【F:services/moon/src/setup/components/SetupStepper.tsx†L1-L192】
- **Context panel.** Step-specific content lives inside `SetupContextPanel` and inherits the OneUI card styles, so service configuration, Discord validation, and Raven controls all feel consistent. Navigation buttons (`SetupActionFooter`) track the active step and expose Next/Back affordances under the card body.【F:services/moon/src/pages/Setup.tsx†L128-L197】
- **Timeline rail.** The right-hand column (`SetupTimeline`) now mirrors the OneUI dashboard pattern: the top card lists foundation vs. additional services, while the bottom card shows wizard milestones with colored badges, retry counts, and refresh controls. This replaces the single log feed from the Chakra-era UI.【F:services/moon/src/pages/Setup.tsx†L160-L197】【F:services/moon/src/setup/components/SetupTimeline.tsx†L1-L213】
- **Shell gestures.** The new navigation drawer includes context-aware buttons, iconography, and a dedicated “Toggle Dark/Light Mode” action powered by the OneUI theme bridge. Mention these cues when directing administrators to a specific page during support sessions.【F:services/moon/src/components/Header.jsx†L61-L139】

## Environment editing experience

Selecting one or more services reveals a OneUI environment editor (`EnvironmentEditor.tsx`) that groups fields per service, inserts inline helper text, and shows a lock icon for read-only values. This mirrors the environment sections returned by `useSetupSteps.ts`, so the documentation’s terminology should match the UI labels (service display name, field label, warning text, read-only lock).【F:services/moon/src/setup/components/EnvironmentEditor.tsx†L1-L78】【F:services/moon/src/setup/useSetupSteps.ts†L28-L95】

The wizard still submits changes to Sage, which normalizes payloads for Warden before container creation, but the UI now highlights:

- **Foundation bootstrap indicators.** The Foundation step renders a “Bootstrap progress” list powered by `FoundationPanel.tsx`. Each row shows a OneUI status icon (pending spinner, success check, warning badge) plus context text (persist overrides, install core services, verify Redis).【F:services/moon/src/setup/components/FoundationPanel.tsx†L1-L64】
- **Wizard badges.** Timeline entries expose status chips such as pending/in-progress/complete/error and display the last actor/timestamp pulled from Sage’s wizard metadata. Administrators can watch these badges while toggling environment overrides to ensure the correct stage is updating.【F:services/moon/src/setup/components/SetupTimeline.tsx†L32-L213】
- **Error surfaces.** Every environment section and timeline card uses OneUI alert banners (info, success, error) rather than Chakra “Alert” callouts, so the docs should reference “OneUI inline status banners” whenever you describe validation feedback.【F:services/moon/src/setup/components/EnvironmentEditor.tsx†L13-L71】【F:services/moon/src/setup/components/RavenConfigurationPanel.tsx†L1-L104】

## Usage tips

- Leave defaults in place unless you have a specific reason to change them. The context panel includes a OneUI info banner reminding you that overrides persist across installs.
- Editable fields include descriptive hints and warnings pulled from the service descriptors; read-only values carry a gray lock icon so you can differentiate between enforced and optional keys at a glance.【F:services/moon/src/setup/components/EnvironmentEditor.tsx†L38-L71】
- The wizard issues the same Sage validation calls the backend enforces. Invalid payloads return actionable error banners above the affected card, and the stepper tile also flips into the “needs attention” badge until the issue is resolved.【F:services/moon/src/setup/components/SetupStepper.tsx†L51-L192】
- Monitor the Wizard status rail to confirm that new environment toggles (for example, enabling Raven, altering Portal callbacks) update the correct step. The refresh button on that rail re-syncs both the wizard metadata and verification summaries in one click.【F:services/moon/src/pages/Setup.tsx†L139-L158】【F:services/moon/src/setup/components/SetupTimeline.tsx†L129-L213】

Automated coverage lives in `services/sage/tests`, `services/warden/tests`, and the React setup wizard under `services/moon/src/setup/`.

## Raven manual configuration

If Warden cannot discover your Kavita container automatically, the Raven step provides both the familiar environment overrides *and* three OneUI status cards that visualize detection, installation, and health. The environment panel still exposes:

- **Raven Downloads Root (`APPDATA`)** – Directory *inside the Raven container* used for `Noona/raven/downloads`. Leave it blank for defaults or set `/kavita-data` (or similar) to align with a host bind mount.
- **Kavita Data Mount (`KAVITA_DATA_MOUNT`)** – Host path for your Kavita library. When provided, Warden mounts it into the container at the downloads root so Raven can persist assets alongside existing media.

The surrounding cards add new visual indicators so administrators can track manual overrides:

1. **Kavita data mount detection.** Shows a OneUI badge tied to the wizard status (`pending`, `in-progress`, `complete`, `error`, `skipped`), displays the last detected mount path, and lets you re-run detection via the **Detect mount** button. Use this when toggling between auto-detected and manual mounts.【F:services/moon/src/setup/components/RavenConfigurationPanel.tsx†L1-L132】
2. **Raven installation status.** Surfaces wizard detail/error text, last request/completion timestamps, and a persistent state label (“Installation requested”, “Installation failed”, etc.) so you know when to re-queue installs after editing environment variables.【F:services/moon/src/setup/components/RavenConfigurationPanel.tsx†L132-L189】
3. **Raven health.** Provides a dedicated **Check Raven health** button whose response time and status message help you confirm that new mount paths or credentials took effect. Timestamp text (“Last checked”) helps correlate health probes with backend logs.【F:services/moon/src/setup/components/RavenConfigurationPanel.tsx†L189-L217】

Supplying both environment values lets you steer the exact mapping (for example `/srv/kavita` on the host mounted to `/downloads` inside Raven). If you only provide the host path, Warden defaults the container path to `/kavita-data`. These overrides still flow through Sage to Warden, but the OneUI status cards ensure you can see which stage is waiting on your new configuration before moving on.
