# Moon Setup Troubleshooting

Moon now renders inside the OneUI shell, so most runtime issues surface as inline status banners, colored badges in the stepper, or alerts embedded inside the Raven cards. Use the guidance below to interpret those cues and resolve common backend problems.

When running the Moon UI (`services/moon`) in isolation you may notice red errors in the browser console similar to the following:

```
Failed to load resource: the server responded with a status of 404 (Not Found) /api/setup/services
Failed to load resource: net::ERR_CONNECTION_REFUSED http://host.docker.internal:3002/health
```

These messages occur because Moon expects the supporting backend services to be online. The OneUI stepper (`SetupStepper.tsx`) will usually mark the impacted step with a red “Attention” badge, and the wizard status rail (`SetupTimeline.tsx`) will show the failing API in its detail text. Use the guidance below to resolve the most common backend issues before returning to the UI.【F:services/moon/src/setup/components/SetupStepper.tsx†L51-L192】【F:services/moon/src/setup/components/SetupTimeline.tsx†L90-L213】

## `GET /api/setup/services` returns 404

The Vite dev server that powers Moon proxies all `/api` calls to the Sage service on port `3004`. If Sage is not running, the proxy target does not exist and the request responds with a 404.

**Fix:** Start Sage before loading Moon.

```bash
cd services/sage
npm start
```

Wait until Sage finishes booting, then refresh the Moon UI. The setup wizard will now retrieve the list of installable services successfully and the OneUI stepper tile for “Foundation services” should flip back to the neutral state.

## Portal health checks show `ERR_CONNECTION_REFUSED`

Moon probes several candidate URLs to detect if Portal is already online, including `http://host.docker.internal:3002/health`. When Portal (or Warden) is offline these checks fail with `ERR_CONNECTION_REFUSED`. This is expected behaviour while Portal is stopped.

**Fix:** Start Portal (and any dependency such as Warden) via Docker or by running the service manually. The errors disappear automatically once Portal responds to the health endpoint, and the Portal step’s badge in the OneUI stepper/timeline will progress from “pending” back to “complete.”

---

### Interpreting OneUI warnings

- **Environment editor alerts.** Read-only keys show a gray lock and cannot be edited; validation problems render as red inline banners above the affected card. Confirm backend availability before editing to avoid cascading errors.【F:services/moon/src/setup/components/EnvironmentEditor.tsx†L13-L71】
- **Raven cards.** The Kavita detection, installation status, and health cards render their own badges and timestamps. If Raven-specific checks fail, the relevant card will highlight the error message even when the rest of the wizard is healthy, helping you focus on storage or mount issues without re-running foundation steps.【F:services/moon/src/setup/components/RavenConfigurationPanel.tsx†L1-L217】
- **Shell notifications.** The OneUI navigation drawer (Header.jsx) keeps the color-mode toggle and route list available even when the wizard errors, so you can quickly jump to other service dashboards while backend teams investigate.【F:services/moon/src/components/Header.jsx†L61-L139】

---

If you continue to see errors after bringing the backend services online, capture the console output and open an issue so we can investigate further.
