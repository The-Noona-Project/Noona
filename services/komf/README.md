# Noona Komf Service

This repository includes a Noona-managed Komf checkout. In Noona, Komf is the metadata helper used for Kavita matching
and enrichment flows.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Komf AI docs](../../docs/agents/komf/README.md)
- [Noona Dockerfile](../../dockerfiles/komf.Dockerfile)
- [Application entrypoint](komf-app/src/main/kotlin/snd/komf/app/Application.kt)
- [Metadata routes](komf-app/src/main/kotlin/snd/komf/app/api/MetadataRoutes.kt)
- [Application build](komf-app/build.gradle.kts)

## What This Service Does

- powers metadata search and match flows for Noona
- supports Portal and Moon when admins review or apply metadata matches
- runs as a managed service inside the Docker + Warden stack

## Who It Is For

- Server admins troubleshooting metadata matching
- Contributors changing Noona's managed Komf behavior

## When An Admin Needs To Care

- when metadata search or apply flows fail
- when updating managed Komf settings
- when Portal or Moon can no longer resolve Komf-backed matches

## How It Fits Into Noona

Warden manages Komf, Moon exposes the settings surface, and Portal uses the Komf APIs during metadata workflows. Admins
normally operate it through Noona rather than as a standalone deployment.

## Next Steps

- Admin install and operations: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/komf/README.md](../../docs/agents/komf/README.md)
