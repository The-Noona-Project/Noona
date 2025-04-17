/**
 * @fileoverview
 * Retrieves the value for a specified Redis key using a Redis client instance.
 * Returns null if the client is invalid or if the key does not exist.
 *
 * @module getFromRedis
 */

import { printDebug, printError } from '../../../utilities/logger/logUtils.mjs';

/**
 * Gets a value from Redis using a given key.
 *
 * @async
 * @function
 * @param {import('redis').RedisClientType} client - Connected Redis client
 * @param {string} key - Redis key to retrieve
 * @returns {Promise<string|null>} The string value if found, or null if not found/error
 */
export async function getFromRedis(client, key) {
    if (!client || typeof client.get !== 'function') {
        printError('[Redis] Invalid or disconnected client.');
        return null;
    }

    try {
        const value = await client.get(key);
        if (value === null) {
            printDebug(`[Redis] Key "${key}" not found.`);
        }
        return value;
    } catch (err) {
        printError(`[Redis] Failed to get key "${key}": ${err.message}`);
        return null;
    }
}
