# Raven

Raven is Noona's downloader and library worker. It searches supported sources, builds the downloaded files, tracks job
state, and keeps the managed library in sync.

## Quick Navigation

- [Server admin guide](../../ServerAdmin.md)
- [Repo overview](../../README.md)
- [Service rules](AGENTS.md)
- [Raven AI docs](../../docs/agents/raven/README.md)
- [Controllers](src/main/java/com/paxkun/raven/controller/)
- [Core services](src/main/java/com/paxkun/raven/service/)
- [Build file](build.gradle)
- [Tests](src/test/java/com/paxkun/raven/)

## What Raven Does

- searches titles and queues downloads
- creates the library files Noona serves
- tracks active and historical download state
- supports import checks and metadata-related library repair flows

## Who It Is For

- Server admins managing downloads and library sync
- Contributors working on downloader, scraper, or worker logic

## When An Admin Needs To Care

- when downloads, imports, or sync jobs fail
- when tuning worker, naming, or VPN-related settings
- when checking that downloaded content actually landed on disk

## How It Fits Into Noona

Raven runs behind Moon, Sage, Portal, and Warden. Admins usually control it from Moon rather than calling Raven
directly.

## Next Steps

- Admin install and operations: [../../ServerAdmin.md](../../ServerAdmin.md)
- Internal editing guide: [../../docs/agents/raven/README.md](../../docs/agents/raven/README.md)
