// services/vault/initVault.mjs

/**
 * @fileoverview
 * Vault microservice for handling secure MongoDB and Redis operations from other Noona services.
 */

import express from 'express';
import dotenv from 'dotenv';
import { handlePacket } from '../../utilities/database/packetParser.mjs';
import { log, errMSG, debugMSG, warn } from '../../utilities/etc/logger.mjs';

dotenv.config();

const app = express();
app.use(express.json());

// ====== ENV CONFIG ======
const PORT = process.env.PORT || 3005;
const VAULT_TOKEN_MAP = process.env.VAULT_TOKEN_MAP || '';

// ====== PARSE TOKEN MAP ======
const tokenPairs = VAULT_TOKEN_MAP.split(',')
    .map(pair => pair.trim())
    .filter(Boolean)
    .map(pair => {
        const [service, token] = pair.split(':');
        return [service?.trim(), token?.trim()];
    })
    .filter(([service, token]) => Boolean(service && token));

const tokensByService = Object.fromEntries(tokenPairs);
const serviceByToken = Object.fromEntries(tokenPairs.map(([service, token]) => [token, service]));

if (!tokenPairs.length) {
    warn('[Vault] ⚠️ No service tokens were loaded. Protected routes will reject all requests.');
} else {
    const serviceList = tokenPairs.map(([service]) => service).join(', ');
    log(`[Vault] Loaded API tokens for: ${serviceList}`);
}

// ====== AUTH MIDDLEWARE ======
function extractBearerToken(req) {
    const authHeader = req.headers.authorization || '';
    if (typeof authHeader !== 'string') return null;

    const [scheme, token] = authHeader.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
        return null;
    }

    return token.trim();
}

function requireAuth(req, res, next) {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const serviceName = serviceByToken[token];
    if (!serviceName) {
        debugMSG(`[Vault] ❌ Unknown token presented: ${token.slice(0, 6)}***`);
        return res.status(401).json({ error: 'Unauthorized service token' });
    }

    req.serviceName = serviceName;
    next();
}

// ====== ROUTES ======

/**
 * Health check route
 */
app.get('/v1/vault/health', (req, res) => {
    res.send('Vault is up and running');
});

/**
 * Unified packet handler (secured)
 */
app.post('/v1/vault/handle', requireAuth, async (req, res) => {
    const packet = req.body;

    debugMSG(`[Vault] Handling packet from ${req.serviceName}`);
    const result = await handlePacket(packet);
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    res.json(result);
});

// ====== START SERVER ======
app.listen(PORT, () => log(`Vault listening on port ${PORT}`));
