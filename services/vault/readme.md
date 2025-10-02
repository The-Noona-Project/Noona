# 🗝️ Noona Vault

**Noona Vault** is the storage and authentication microservice for the Noona ecosystem. It manages data storage requests and routes them to the appropriate backend (MongoDB, Redis), and validates incoming requests with deterministic API tokens issued by Warden.

---

## 🚀 Features

- REST API for storing and retrieving data
- Supports **MongoDB** and **Redis**
- Simple token-based authentication for Noona services
- Extensible for future file/SFTP storage integrations

---

## ⚙️ Endpoints

### Health Check

`GET /v1/vault/health`

Returns `Vault is up and running`.

---

### Store Data

`POST /v1/vault/store`

**Body:**

```json
{
  "storageType": "mongo | redis",
  "key": "yourKeyIfRedis",
  "value": { "your": "data" },
  "collection": "collectionNameIfMongo"
}
````

---

### Get Data

`POST /v1/vault/get`

**Body:**

```json
{
  "storageType": "mongo | redis",
  "key": "yourKeyIfRedis",
  "collection": "collectionNameIfMongo",
  "query": { "your": "mongoQuery" }
}
```

---

## 🔐 Authentication

All routes (except health check) require a valid **service token** sent via the standard Authorization header:

```
Authorization: Bearer <service_token>
```

Tokens are provided to Vault through the `VAULT_TOKEN_MAP` environment variable. The value is a comma-separated list of `service:token` pairs (e.g. `noona-moon:moon-token,noona-sage:sage-token`). Requests presenting a token not present in the map will be rejected with `401 Unauthorized`.

---

## 📦 Environment Variables

| Variable         | Description                        | Example                     |
| ---------------- | ---------------------------------- | --------------------------- |
| `PORT`           | Port Vault listens on              | 4000                        |
| `VAULT_TOKEN_MAP` | Comma-separated `service:token` pairs | `noona-moon:moon123,noona-sage:sage456` |
| `MONGO_URI`      | MongoDB connection URI             | mongodb://noona-mongo:27017 |
| `REDIS_HOST`     | Redis host (default `noona-redis`) | noona-redis                 |

---

## 🐳 Running with Docker

```bash
docker build -f deployment/vault.Dockerfile -t noona-vault .
docker run -e MONGO_URI=mongodb://noona-mongo:27017 -e VAULT_TOKEN_MAP=noona-moon:moon123,noona-sage:sage456 -e REDIS_HOST=noona-redis -p 4000:4000 noona-vault
```

---

## 📝 Future Plans

* User authentication endpoints
* SFTP storage integration
* Advanced role-based permissions

---

### 🔧 Maintained by

**Noona Project**


