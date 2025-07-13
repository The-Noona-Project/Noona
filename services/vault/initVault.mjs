// services/vault/initVault.mjs

/**
 * @fileoverview
 * Vault microservice for handling secure MongoDB and Redis operations from other Noona services.
 */

import express from 'express';
import dotenv from 'dotenv';
import { handlePacket } from '../../utilities/database/packetParser.mjs';
import { log, errMSG } from '../../utilities/etc/logger.mjs';

dotenv.config();

const app = express();
app.use(express.json());

// ====== ENV CONFIG ======
const SERVICE_TOKENS = process.env.SERVICE_TOKENS
    ? process.env.SERVICE_TOKENS.split(',')
    : [];

const PORT = process.env.PORT || 3005;

// ====== AUTH MIDDLEWARE ======
app.use((req, res, next) => {
    if (req.path === '/v1/vault/health') return next(); // allow health checks unauthenticated

    const token = req.headers['x-service-token'];
    if (!token || !SERVICE_TOKENS.includes(token)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid service token' });
    }
    next();
});

// ====== ROUTES ======

/**
 * Health check route
 */
app.get('/v1/vault/health', (req, res) => {
    res.send('Vault is up and running');
});

/**
 * Unified handler for Redis and MongoDB packets
 */
app.post('/v1/vault/handle', async (req, res) => {
    const packet = req.body;

    const result = await handlePacket(packet);

    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    res.json(result);
});

/**
 * Simple authorized route for testing token validity
 */
app.post('/v1/vault/auth', (req, res) => {
    res.json({ status: 'authorized' });
});

// ====== START SERVER ======
app.listen(PORT, () => log(`Vault listening on port ${PORT}`));
