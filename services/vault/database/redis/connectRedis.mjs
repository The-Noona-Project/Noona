/**
 * @fileoverview
 * Creates and connects a Redis client using environment configuration.
 * On success, returns the Redis client instance; on failure, returns null.
 *
 * @module connectRedis
 */

import { createClient } from 'redis';
import { printDebug, printError, printResult } from '../../noona/logger/logUtils.mjs';

/**
 * Asynchronously connects to a Redis database.
 *
 * @async
 * @function
 * @returns {Promise<import('redis').RedisClientType|null>} Redis client instance or null if failed
 */
export default async function connectRedis() {
    const redisURL = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
        const client = createClient({ url: redisURL });

        client.on('error', (err) => {
            printError(`Redis Client Error: ${err.message}`);
        });

        await client.connect();
        printResult(`Connected to Redis at ${redisURL}`);
        return client;
    } catch (error) {
        printError(`Error connecting to Redis: ${error.message}`);
        return null;
    }
}
