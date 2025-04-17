/**
 * @fileoverview
 * Initializes a Redis connection and performs Vault JWT key verification.
 * Returns the Redis client if successful, or false if connection or key validation fails.
 *
 * @module initRedis
 */

import connectRedis from './connectRedis.mjs';
import { verifyVaultKeyPair } from '../../../utilities/jwt/verifyKeyPair.mjs';
import {
    printSection,
    printResult,
    printError,
    printDebug
} from '../../../utilities/logger/logUtils.mjs';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Initializes Redis and verifies Vault JWT keypair on startup.
 *
 * @async
 * @function
 * @returns {Promise<{ client: import('redis').RedisClientType } | false>} Redis client container or false
 */
export default async function initRedis() {
    printSection('Redis Initialization');

    try {
        const client = await connectRedis();
        if (!client) {
            printError('❌ Redis connection failed: No client returned.');
            return false;
        }

        if (isDev) {
            const redisURL = process.env.REDIS_URL || 'redis://localhost:6379';
            printDebug(`Redis URL: ${redisURL}`);
        }

        // 🔐 Validate keypair using the connected Redis client
        const validKeys = await verifyVaultKeyPair(client);
        if (!validKeys) {
            printError('❌ Vault JWT key pair validation failed.');
            return false;
        }

        printResult(`✅ Connected to Redis`);
        return { client };
    } catch (err) {
        printError('❌ Redis connection failed.');
        printDebug(err.message || 'Unknown Redis error');
        return false;
    }
}
