# Moon Setup Environment Configuration (Legacy)

Moon has been fully replaced by the OnceUI deployment wizard served from `deployment/webServer.mjs`. The guidance in this file is preserved only for historical context. For current environment and workflow details, follow the OnceUI wizard guide in [docs/onceui-deployment-wizard.md](./onceui-deployment-wizard.md).

Key differences to keep in mind when migrating from Moon:

- The OnceUI wizard streams NDJSON logs directly in the browser instead of relying on Moon's Chakra-based modal dialogs.
- Environment overrides are edited through the OnceUI JSON settings card, and writes go straight to `PATCH /api/settings` before builds or starts.
- All lifecycle actions (build, push/pull, start/stop, clean, delete) are exposed as OnceUI cards and call the deployment server's `/api/*` endpoints.

If you still have screenshots or runbooks mentioning Moon, label them as **legacy** and point readers to the OnceUI workflow instead of attempting to replicate the Moon screens.
