# Moon Setup Troubleshooting

When running the Moon UI (`services/moon`) in isolation you may notice red errors in the browser console similar to the following:

```
Failed to load resource: the server responded with a status of 404 (Not Found) /api/setup/services
Failed to load resource: net::ERR_CONNECTION_REFUSED http://host.docker.internal:3002/health
```

These messages occur because Moon expects the supporting backend services to be online. Use the guidance below to resolve the most common issues.

## `GET /api/setup/services` returns 404

The Vite dev server that powers Moon proxies all `/api` calls to the Sage service on port `3004`. If Sage is not running, the proxy target does not exist and the request responds with a 404.

**Fix:** Start Sage before loading Moon.

```bash
cd services/sage
npm start
```

Wait until Sage finishes booting, then refresh the Moon UI. The setup wizard will now retrieve the list of installable services successfully.

## Portal health checks show `ERR_CONNECTION_REFUSED`

Moon probes several candidate URLs to detect if Portal is already online, including `http://host.docker.internal:3002/health`. When Portal (or Warden) is offline these checks fail with `ERR_CONNECTION_REFUSED`. This is expected behaviour while Portal is stopped.

**Fix:** Start Portal (and any dependency such as Warden) via Docker or by running the service manually. The errors disappear automatically once Portal responds to the health endpoint.

---

If you continue to see errors after bringing the backend services online, capture the console output and open an issue so we can investigate further.
