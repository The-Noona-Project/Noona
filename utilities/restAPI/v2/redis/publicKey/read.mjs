/**
 * @fileoverview
 * Express route to fetch the public key of a service from Redis.
 * Commonly used by services like Noona-Portal to retrieve their validation key.
 *
 * @module redisPublicKeyRead
 */

import express from 'express';
import { getFromRedis } from '../../../../redis/getFromRedis.mjs';
import { printDebug, printError } from '../../../../../../utilities/logger/logUtils.mjs';

const router = express.Router();

/**
 * Retrieves the public key for a given service from Redis.
 *
 * @async
 * @function
 * @param {string} service - Service name (used in Redis key name)
 * @returns {Promise<string|null>} The PEM-formatted public key, or null if not found
 */
export async function handleReadKey(service) {
    const client = global.noonaRedisClient;
    const keyName = `NOONA:TOKEN:${service}`;
    if (!client) throw new Error('Redis unavailable');

    try {
        const key = await getFromRedis(client, keyName);
        if (!key) {
            printError(`[Vault] ❌ Key not found for ${service}`);
            return null;
        }
        printDebug(`[Vault] ✅ Key read for ${service}`);
        return key;
    } catch (err) {
        printError(`[Vault] ❌ Failed to read key for ${service}: ${err.message}`);
        return null;
    }
}

/**
 * GET /v2/redis/publicKey/read/:service
 *
 * Fetches the stored public key for a service from Redis.
 * Returns metadata about the key including length and format.
 */
router.get('/:service', async (req, res) => {
    const { service } = req.params;
    const key = await handleReadKey(service);

    if (!key) {
        return res.status(404).json({ success: false, msg: 'Key not found' });
    }

    return res.status(200).json({
        success: true,
        publicKey: key,
        metadata: {
            format: 'PEM',
            length: key.length,
            source: 'Redis',
            keyName: `NOONA:TOKEN:${service}`
        }
    });
});

/**
 * Route metadata used by Noona’s dynamic route loader.
 * @type {{ path: string, authLevel: string, description: string }}
 */
export const routeMeta = {
    path: '/v2/redis/publicKey/read/:service',
    authLevel: 'public',
    description: 'Get the stored public key for a service',
};

export default router;
