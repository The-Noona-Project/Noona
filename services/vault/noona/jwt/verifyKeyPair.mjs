/**
 * @fileoverview
 * Validates that Vault's private key (from environment) matches the public key stored in Redis.
 * This confirms that JWTs signed by Vault can be verified by other services.
 *
 * @module verifyKeyPair
 */

import jwt from 'jsonwebtoken';
import { getFromRedis } from '../../database/redis/getFromRedis.mjs';
import {
    printDebug,
    printError,
    printResult
} from '../logger/logUtils.mjs';

/**
 * Verifies Vault’s private key against its stored Redis public key.
 *
 * - Fetches `NOONA:KEY:noona-vault:PUBLIC` from Redis
 * - Signs a test JWT with the private key
 * - Verifies it against the public key
 *
 * @async
 * @function
 * @param {import('redis').RedisClientType} redisClient - Active Redis client instance
 * @returns {Promise<boolean>} True if the key pair is valid, false if mismatched or missing
 *
 * @example
 * const isValid = await verifyVaultKeyPair(global.noonaRedisClient);
 */
export async function verifyVaultKeyPair(redisClient) {
    const serviceName = 'noona-vault';
    const redisKey = `NOONA:KEY:${serviceName}:PUBLIC`;

    printDebug('[KEYCHECK] Verifying Vault public/private key pair...');

    // Step 1: Fetch the public key from Redis
    const publicKey = await getFromRedis(redisClient, redisKey);
    if (!publicKey) {
        printError(`[KEYCHECK] ❌ Missing public key in Redis at: ${redisKey}`);
        return false;
    }

    // Step 2: Load private key from environment
    const privateKey = process.env.JWT_PRIVATE_KEY;
    if (!privateKey) {
        printError('[KEYCHECK] ❌ JWT_PRIVATE_KEY not set in environment');
        return false;
    }

    try {
        // Step 3: Generate and verify test JWT
        const token = jwt.sign({ check: 'noona' }, privateKey, {
            algorithm: 'RS256',
            expiresIn: '30s'
        });

        jwt.verify(token, publicKey, { algorithms: ['RS256'] });
        printResult('✅ [KEYCHECK] Vault JWT key pair is valid');
        return true;
    } catch (err) {
        printError(`[KEYCHECK] ❌ JWT key mismatch: ${err.message}`);
        return false;
    }
}
