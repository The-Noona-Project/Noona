# Noona-Warden

**Noona-Warden** is the master service manager of The Noona Project. It hooks into the Docker socket to monitor and control other services (like `noona-vault` and `noona-portal`), and manages secure internal authentication via daily-rotated JWT tokens.

---

## Features

- Secure internal JWT token generation
- Daily secret rotation using date + salt
- Publishes secrets to Redis for verification
- Controls Docker containers via `dockerode`
- Health checks and auto-start for other Noona services
- Can be expanded with update-checking, image pulling, and more

---

## Token Architecture

Warden generates and signs JWT tokens each day. These tokens are used internally for inter-service authentication.

See [jwt-architecture.md](./docs/jwt-architecture.md) for more details.

---

## Redis Usage

| Key | Purpose |
|-----|---------|
| `noona:warden:jwt-secret` | Stores daily secret for token verification |
| `noona:auth:latest-token` | (optional) Signed JWT to share with services |
| `noona:services:<name>:status` | (optional) Tracks container health or status |

---

## Docker Setup

Make sure to mount the Docker socket:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock