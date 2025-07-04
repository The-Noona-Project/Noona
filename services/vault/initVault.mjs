// services/vault/initVault.mjs

import express from 'express';
import dotenv from 'dotenv';
import connectMongo from '../../utilities/database/mongo/mongoClient.mjs';
import redis from '../../utilities/database/redis/redisClient.mjs';
import { log, errMSG } from '../../utilities/etc/logger.mjs';

dotenv.config();

const app = express();
app.use(express.json());

// ====== ENV CONFIG ======
const SERVICE_TOKENS = process.env.SERVICE_TOKENS
    ? process.env.SERVICE_TOKENS.split(',')
    : [];

const PORT = process.env.PORT || 4000;

// ====== AUTH MIDDLEWARE ======
app.use((req, res, next) => {
    if (req.path === '/v1/vault/health') return next(); // skip auth for health check

    const token = req.headers['x-service-token'];
    if (!token || !SERVICE_TOKENS.includes(token)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid service token' });
    }
    next();
});

// ====== ROUTES ======

// Health check
app.get('/v1/vault/health', (req, res) => {
    res.send('Vault is up and running');
});

// Store data
app.post('/v1/vault/store', async (req, res) => {
    const { storageType, key, value, collection } = req.body;

    try {
        if (storageType === 'redis') {
            await redis.set(key, JSON.stringify(value));
            log(`Stored key "${key}" in Redis`);
            res.json({ status: 'stored in redis' });

        } else if (storageType === 'mongo') {
            const db = await connectMongo();
            const result = await db.collection(collection).insertOne(value);
            log(`Inserted document into ${collection} with _id: ${result.insertedId}`);
            res.json({ status: 'stored in mongo', id: result.insertedId });

        } else {
            res.status(400).json({ error: 'Invalid storageType, use "redis" or "mongo"' });
        }

    } catch (err) {
        errMSG('Vault store error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Retrieve data
app.post('/v1/vault/get', async (req, res) => {
    const { storageType, key, collection, query } = req.body;

    try {
        if (storageType === 'redis') {
            const data = await redis.get(key);
            if (!data) return res.status(404).json({ error: 'Key not found in redis' });
            log(`Fetched key "${key}" from Redis`);
            res.json({ data: JSON.parse(data) });

        } else if (storageType === 'mongo') {
            const db = await connectMongo();
            const result = await db.collection(collection).findOne(query);
            if (!result) return res.status(404).json({ error: 'Document not found' });
            log(`Fetched document from ${collection} matching ${JSON.stringify(query)}`);
            res.json({ data: result });

        } else {
            res.status(400).json({ error: 'Invalid storageType, use "redis" or "mongo"' });
        }

    } catch (err) {
        errMSG('Vault get error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Auth test route (simple for now)
app.post('/v1/vault/auth', (req, res) => {
    res.json({ status: 'authorized' });
});

// ====== SERVER START ======
app.listen(PORT, () => log(`Vault listening on port ${PORT}`));

