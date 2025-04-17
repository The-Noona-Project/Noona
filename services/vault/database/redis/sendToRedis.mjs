/**
 * @fileoverview
 * Stores a value in Redis under a specified key using a Redis client.
 * Returns false on client error or failure to write.
 *
 * @module sendToRedis
 */

import { printResult, printError } from '../../noona/logger/logUtils.mjs';

/**
 * Sets a value in Redis under the given key.
 *
 * @async
 * @function
 * @param {import('redis').RedisClientType} client - Redis client instance
 * @param {string} key - Redis key to set
 * @param {string} value - Value to store
 * @param {object} [options={}] - Optional Redis set options (e.g., { EX: 60 })
 * @returns {Promise<boolean>} Whether the operation was successful
 */
export async function sendToRedis(client, key, value, options = {}) {
    if (!client || typeof client.set !== 'function') {
        printError('[Redis] Invalid or disconnected client.');
        return false;
    }

    try {
        await client.set(key, value, options);
        printResult(`[Redis] Key "${key}" set successfully.`);
        return true;
    } catch (err) {
        printError(`[Redis] Failed to set key "${key}": ${err.message}`);
        return false;
    }
}
