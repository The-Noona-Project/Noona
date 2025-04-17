/**
 * @fileoverview
 * Express route that generates a new RSA public key for a service and stores it in Redis.
 * This route is public and used by other Noona services to initialize their secure identity.
 *
 * @module redisPublicKeyCreate
 */

import express from 'express';
import { sendToRedis } from '../../../../../database/redis/sendToRedis.mjs';
import { printDebug, printError } from '../../../../logger/logUtils.mjs';
import { generateKeyPair } from '../../../../jwt/generateKeyPair.mjs';

const router = express.Router();

/**
 * Generates an RSA keypair and stores the public key in Redis.
 *
 * @async
 * @function
 * @param {string} service - The service name (used as Redis key suffix)
 * @returns {Promise<{ success: boolean, publicKey?: string }>}
 */
export async function handleCreateKey(service) {
    const client = global.noonaRedisClient;
    const keyName = `NOONA:TOKEN:${service}`;

    if (!client) {
        printError('[Vault] ❌ Redis client unavailable');
        return { success: false };
    }

    try {
        const { publicKey } = await generateKeyPair();
        await sendToRedis(client, keyName, publicKey);
        printDebug(`[Vault] 🔐 Public key generated and stored for ${service}`);
        return { success: true, publicKey };
    } catch (err) {
        printError(`[Vault] ❌ Failed to generate/store key for ${service}: ${err.message}`);
        return { success: false };
    }
}

/**
 * POST /v2/redis/publicKey/create
 * Body: { service: "noona-portal" }
 *
 * Returns 201 with key and Redis key name if successful.
 */
router.post('/', async (req, res) => {
    const { service } = req.body;

    if (!service) {
        printError('[Vault] ❌ Missing service name in request body');
        return res.status(400).json({
            success: false,
            msg: 'Missing required field: service'
        });
    }

    const { success, publicKey } = await handleCreateKey(service);

    if (!success) {
        return res.status(500).json({
            success: false,
            msg: 'Failed to generate/store public key'
        });
    }

    return res.status(201).json({
        success: true,
        msg: `Public key generated and stored for ${service}`,
        publicKey,
        keyName: `NOONA:TOKEN:${service}`
    });
});

/**
 * Route metadata used by Noona's dynamic route loader.
 * @type {{ path: string, authLevel: string, description: string }}
 */
export const routeMeta = {
    path: '/v2/redis/publicKey/create',
    authLevel: 'public',
    description: 'Generates and stores a public key for a service',
};

export default router;
