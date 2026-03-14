# Raven Files And Rules

## Important Files

- [src/main/java/com/paxkun/raven/controller/](../../../services/raven/src/main/java/com/paxkun/raven/controller/): HTTP
  contracts.
- [src/main/java/com/paxkun/raven/service/](../../../services/raven/src/main/java/com/paxkun/raven/service/): download
  orchestration, workers, naming, and library logic.
- [build.gradle](../../../services/raven/build.gradle): build and dependency baseline.

## Rules

- Preserve `.noona` manifest compatibility unless a migration is part of the change.
- Raven's disk layout and naming behavior are admin-visible and belong in public/admin docs when changed.
- Vault-backed worker or VPN settings need cross-service thinking because Moon and Sage surface them.
