# Sage

Sage exposes orchestration and discovery endpoints for Moon and other Noona services.

## Raven integration

Sage automatically resolves the Raven base URL by querying Warden for installed services and
falling back to common Docker hostnames. When running Sage without Warden or when Raven is
exposed through a custom address, set one of the following environment variables:

- `RAVEN_BASE_URL` – Explicit base URL (e.g., `http://127.0.0.1:8080`).
- `RAVEN_INTERNAL_BASE_URL` – Optional internal network URL preferred over fallbacks.
- `RAVEN_DOCKER_URL` – Docker-specific hostname or overlay address for Raven.

You can also define `RAVEN_HOST`/`RAVEN_PORT` or `RAVEN_SERVICE_HOST` to compose a host and port
pair. These overrides ensure Sage can proxy library, search, and download requests through Raven
when auto-discovery fails.
