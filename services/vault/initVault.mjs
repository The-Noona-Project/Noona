// services/vault/initVault.mjs

/**
 * @fileoverview
 * Vault microservice for handling secure MongoDB and Redis operations from other Noona services.
 */

import express from 'express';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { handlePacket } from '../../utilities/database/packetParser.mjs';
import { log, errMSG, debugMSG } from '../../utilities/etc/logger.mjs';

dotenv.config();

const app = express();
app.use(express.json());

// ====== ENV CONFIG ======
const PORT = process.env.PORT || 3005;
const JWT_SECRET = process.env.JWT_SECRET || 'noona-vault-dev-secret';
const JWT_EXPIRES_IN = '10m'; // 10 minutes
const WARDENPASSMAP = process.env.WARDENPASSMAP || ''; // e.g. noona-moon:pass1,noona-sage:pass2

// ====== PARSE PASSWORD MAP ======
const validPassMap = Object.fromEntries(
    WARDENPASSMAP.split(',')
        .map(pair => pair.trim())
        .filter(Boolean)
        .map(pair => {
            const [name, pass] = pair.split(':');
            return [name, pass];
        })
);

// ====== JWT UTIL ======
function createToken(serviceName) {
    return jwt.sign({ sub: serviceName }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

// ====== AUTH MIDDLEWARE ======
function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = auth.split(' ')[1];
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.serviceName = decoded.sub;
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
 * Service login
 */
app.post('/v1/vault/auth', (req, res) => {
    const { name, password } = req.body;

    if (!name || !password) {
        return res.status(400).json({ error: 'Missing name or password' });
    }

    const expected = validPassMap[name];
    if (!expected || expected !== password) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = createToken(name);
    debugMSG(`[Vault] ✅ Authenticated ${name}`);
    res.json({ token });
});

/**
 * Token refresh
 */
app.post('/v1/vault/refresh', (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const oldToken = auth.split(' ')[1];
    const decoded = verifyToken(oldToken);

    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const newToken = createToken(decoded.sub);
    debugMSG(`[Vault] 🔄 Refreshed token for ${decoded.sub}`);
    res.json({ token: newToken });
});

/**
 * Unified packet handler (secured)
 */
app.post('/v1/vault/handle', requireAuth, async (req, res) => {
    const packet = req.body;

    const result = await handlePacket(packet);
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    res.json(result);
});

// ====== START SERVER ======
app.listen(PORT, () => log(`Vault listening on port ${PORT}`));
