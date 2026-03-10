# Kavita Service Guide

> Start in [`services/kavita`](./). This service is a vendored Kavita upstream checkout with Noona-specific container and bootstrap files layered on top at the service root.

## Quick Navigation

- [Service README](README.md)
- [Solution file](Kavita.sln)
- [Backend entrypoints](API/Program.cs)
- [Backend startup wiring](API/Startup.cs)
- [Backend controllers](API/Controllers/)
- [Backend services](API/Services/)
- [Default config](API/config/appsettings.json)
- [Angular web app](UI/Web/)
- [Angular source](UI/Web/src/)
- [Frontend README](UI/Web/README.md)
- [Shared .NET library](Kavita.Common/)
- [Backend tests](API.Tests/)
- [Benchmarks](API.Benchmark/)
- [Container entrypoint](entrypoint.sh)
- [Noona bootstrap helper](noona-bootstrap-admin.sh)
- [Noona Dockerfile](../../dockerfiles/kavita.Dockerfile)
- [Warden Kavita descriptor](../warden/docker/noonaDockers.mjs)
- [Portal Kavita client](../portal/clients/kavitaClient.mjs)
- [Moon Kavita proxy routes](../moon/src/app/api/noona/portal/kavita/)

## How to Navigate

1. From the repository root, run `cd services/kavita`.
2. If you need the full project in Rider or Visual Studio, open `Kavita.sln`.
3. Work in `API/` for ASP.NET Core startup, controllers, domain services, data access, and configuration.
4. Work in `UI/Web/` for Angular changes. Most UI code lives under `UI/Web/src/app/`, with assets and theming under `UI/Web/src/assets/` and `UI/Web/src/theme/`.
5. Use `Kavita.Common/` for shared configuration, helpers, and cross-project utilities.
6. Use `API.Tests/` for backend coverage and `API.Benchmark/` only when performance work is explicitly in scope.

## Noona-Specific Touchpoints

- Root-level runtime scripts (`entrypoint.sh`, `noona-bootstrap-admin.sh`) plus [../../dockerfiles/kavita.Dockerfile](../../dockerfiles/kavita.Dockerfile) are the first places to look for Noona-managed behavior.
- `API/Controllers/AccountController.cs` and `API/config/appsettings.json` are the main backend touchpoints for first-admin and bootstrap flows.
- Warden service registration and env injection live in [`../warden/docker/noonaDockers.mjs`](../warden/docker/noonaDockers.mjs).
- Portal's Kavita API client lives in [`../portal/clients/kavitaClient.mjs`](../portal/clients/kavitaClient.mjs).
- Moon's proxy routes for Kavita-backed UI actions live in [`../moon/src/app/api/noona/portal/kavita/`](../moon/src/app/api/noona/portal/kavita/).

## Working Rules

- Keep upstream Kavita changes narrowly scoped and separate from Noona container/bootstrap changes whenever possible.
- Update [README.md](README.md) when startup behavior, bootstrap flow, config, or major navigation paths change.
- Check for deeper local docs before changing a subsystem, especially [UI/Web/README.md](UI/Web/README.md) for frontend workflow details.

## Testing Expectations

- Backend changes: run `dotnet test API.Tests/API.Tests.csproj`.
- Broad .NET changes: run `dotnet test Kavita.sln`.
- Frontend changes: run the relevant `npm` script from `UI/Web/` such as `npm run build`, `npm run lint`, or `npm run start-proxy`.
- If you skip tests, note the reason in the final handoff.
