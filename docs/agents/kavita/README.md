# Kavita AI Notes

This is a Noona-managed Kavita checkout with Noona-specific container and login-handoff behavior layered on top.

## Start Here

- [files-and-rules.md](files-and-rules.md)
- [Noona Dockerfile](../../../dockerfiles/kavita.Dockerfile)
- [Container entrypoint](../../../services/kavita/entrypoint.sh)
- [Noona bootstrap helper](../../../services/kavita/noona-bootstrap-admin.sh)

## Change Map

- container or bootstrap behavior: Dockerfile and root scripts
- Noona login handoff: account controller and login UI touchpoints
- broad upstream Kavita work: only when the task explicitly calls for it
