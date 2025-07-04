# 🗝️ Noona Vault

**Noona Vault** is the storage and authentication microservice for the Noona ecosystem. It manages data storage requests and routes them to the appropriate backend (MongoDB, Redis), and provides basic service authentication.

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

### Auth Test

`POST /v1/vault/auth`

Returns `{ "status": "authorized" }` if the `x-service-token` header is valid.

---

## 🔐 Authentication

All routes (except health check) require a valid **service token** sent in the header:

```
x-service-token: your_service_token
```

Tokens are set via the `SERVICE_TOKENS` environment variable as a comma-separated list.

---

## 📦 Environment Variables

| Variable         | Description                        | Example                     |
| ---------------- | ---------------------------------- | --------------------------- |
| `PORT`           | Port Vault listens on              | 4000                        |
| `SERVICE_TOKENS` | Comma-separated allowed tokens     | moon123,sage456,portal789   |
| `MONGO_URI`      | MongoDB connection URI             | mongodb://noona-mongo:27017 |
| `REDIS_HOST`     | Redis host (default `noona-redis`) | noona-redis                 |

---

## 🐳 Running with Docker

```bash
docker build -f deployment/vault.Dockerfile -t noona-vault .
docker run -e MONGO_URI=mongodb://noona-mongo:27017 \
           -e SERVICE_TOKENS=moon123,sage456 \
           -e REDIS_HOST=noona-redis \
           -p 4000:4000 noona-vault
```

---

## 📝 Future Plans

* User authentication endpoints
* SFTP storage integration
* Advanced role-based permissions

---

### 🔧 Maintained by

**Noona Project**


