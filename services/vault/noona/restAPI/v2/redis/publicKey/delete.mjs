/**
 * @fileoverview
 * Express route to delete a stored public key for a service from Redis.
 * Used when a service is decommissioned or needs a clean reset.
 *
 * @module redisPublicKeyDelete
 */

import express from 'express';
import { printDebug, printError } from '../../../../logger/logUtils.mjs';

const router = express.Router();

/**
 * Deletes a Redis key corresponding to a service's public key.
 *
 * @async
 * @function
 * @param {string} service - The service name (e.g., 'noona-portal')
 * @returns {Promise<boolean>} Whether the deletion succeeded
 */
export async function handleDeleteKey(service) {
    const client = global.noonaRedisClient;
    const keyName = `NOONA:TOKEN:${service}`;

    if (!client) {
        printError('[Vault] ❌ Redis client unavailable');
        return false;
    }

    try {
        const deleted = await client.del(keyName);
        if (deleted) {
            printDebug(`[Vault] 🗑️ Deleted Redis key for ${service}`);
            return true;
        } else {
            printError(`[Vault] ⚠️ Redis key not found for ${service}`);
            return false;
        }
    } catch (err) {
        printError(`[Vault] ❌ Failed to delete Redis key for ${service}: ${err.message}`);
        return false;
    }
}

/**
 * DELETE /v2/redis/publicKey/delete/:service
 *
 * Deletes the stored public key for a service.
 */
router.delete('/:service', async (req, res) => {
    const { service } = req.params;

    const success = await handleDeleteKey(service);
    if (!success) {
        return res.status(404).json({
            success: false,
            msg: `Public key not found or failed to delete for ${service}`
        });
    }

    return res.status(200).json({
        success: true,
        msg: `Public key deleted for ${service}`,
        keyName: `NOONA:TOKEN:${service}`
    });
});

/**
 * Route metadata used by Noona’s dynamic route loader.
 * @type {{ path: string, authLevel: string, description: string }}
 */
export const routeMeta = {
    path: '/v2/redis/publicKey/delete/:service',
    authLevel: 'public',
    description: 'Delete the stored public key for a service',
};

export default router;
