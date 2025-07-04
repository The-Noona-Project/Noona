# 🛡️ Warden

Warden is the **central orchestrator** for the Noona ecosystem. It manages containerized services using Docker, ensuring correct startup order, health checks, and network configuration.

---

## 🚀 Features

- Spawns Noona services in **controlled boot order**.
- Ensures required images are pulled before launch.
- Attaches itself and managed containers to the shared `noona-network`.
- Tracks and gracefully shuts down running containers on exit.
- Supports **minimal mode** for rapid development and **super mode** for full stack deployment.

---

## ⚙️ Usage

### 1. **Minimal Mode**

Launches essential services only:
- `noona-redis`
- `noona-sage`
- `noona-moon`

```bash
DEBUG=false node initWarden.mjs
````

### 2. **Super Mode**

Launches **all services** in the correct dependency order:

1. noona-sage
2. noona-moon
3. noona-redis
4. noona-mongo
5. noona-vault
6. noona-raven

```bash
DEBUG=super node initWarden.mjs
```

---

## 📝 Environment Variables

| Variable | Description                                       | Default |
| -------- | ------------------------------------------------- | ------- |
| `DEBUG`  | Controls launch mode. Use `super` for full stack. | `false` |

---

## 📦 Project Structure

```
warden/
├── docker/
│   ├── addonDockers.mjs        # Definitions for addon services (e.g. Redis, Mongo)
│   ├── noonaDockers.mjs        # Definitions for core Noona services
│   └── dockerUtilties.mjs      # Docker management utility functions
├── initWarden.mjs              # Main entry point for Warden
└── README.md                   # This file
```

---

## 🔄 Boot Order Logic

In **super mode**, services are launched sequentially with health checks between each to ensure:

✅ Dependencies are ready before dependents boot
✅ Stability of the full stack during deployments or local development

---

## 🛑 Shutdown

Warden traps `SIGINT` and `SIGTERM` to gracefully stop and remove all tracked containers before exiting.

---

## 💡 Future Enhancements

* Container-level health check definitions in `noonaDockers.mjs` and `addonDockers.mjs`
* Live log streaming aggregation to central monitoring
* External addon management via dedicated `addonDockers` modules

---

## 👨‍💻 Maintainers

* **Owner:** CaptainPax

---

