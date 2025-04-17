/**
 * @fileoverview
 * Express route to overwrite a service's public key in Redis.
 * This is used when a Noona service rotates its RSA key.
 *
 * @module redisPublicKeyUpdate
 */

import express from 'express';
import { sendToRedis } from '../../../../redis/sendToRedis.mjs';
import { printDebug, printError } from '../../../../../../utilities/logger/logUtils.mjs';

const router = express.Router();

/**
 * Updates (overwrites) the public key for a given service.
 *
 * @async
 * @function
 * @param {string} service - Name of the target service
 * @param {string} publicKey - PEM-encoded public key to store
 * @returns {Promise<boolean>} Whether the update succeeded
 */
export async function handleUpdateKey(service, publicKey) {
    const client = global.noonaRedisClient;
    const keyName = `NOONA:TOKEN:${service}`;
    if (!client) throw new Error('Redis unavailable');

    try {
        await sendToRedis(client, keyName, publicKey);
        printDebug(`[Vault] 🔄 Public key updated for ${service}`);
        return true;
    } catch (err) {
        printError(`[Vault] ❌ Failed to update key for ${service}: ${err.message}`);
        return false;
    }
}

/**
 * PUT /v2/redis/publicKey/update/:service
 *
 * Body: { publicKey: "<PEM key>" }
 *
 * Overwrites the Redis value for a service’s public key.
 */
router.put('/:service', async (req, res) => {
    const { service } = req.params;
    const { publicKey } = req.body;

    if (!publicKey) {
        return res.status(400).json({ success: false, msg: 'Missing publicKey' });
    }

    const ok = await handleUpdateKey(service, publicKey);
    if (!ok) return res.status(500).json({ success: false, msg: 'Update failed' });

    return res.status(200).json({
        success: true,
        msg: `Public key updated for ${service}`,
        keyName: `NOONA:TOKEN:${service}`
    });
});

/**
 * Route metadata used by Noona’s dynamic route loader.
 * @type {{ path: string, authLevel: string, description: string }}
 */
export const routeMeta = {
    path: '/v2/redis/publicKey/update/:service',
    authLevel: 'public',
    description: 'Update the stored public key for a service',
};

export default router;
