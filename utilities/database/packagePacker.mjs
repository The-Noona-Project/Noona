// utilities/database/packagePacker.mjs

/**
 * @fileoverview
 * Utility to create valid Vault packets for MongoDB and Redis.
 * Ensures structural consistency and input validation for services that communicate with Vault.
 */

const allowedMongoOps = ['insert', 'find', 'update'];
const allowedRedisOps = ['set', 'get', 'del'];

/**
 * Creates a packet for MongoDB-based Vault operations.
 *
 * @param {'insert' | 'find' | 'update'} operation - Mongo operation type
 * @param {string} collection - MongoDB collection name
 * @param {object} data - Document (insert), query (find), or update object
 * @param {object} [options] - Optional fields for update/query/upsert
 * @returns {object} Vault packet
 * @throws {Error} If inputs are invalid
 */
export function packMongo(operation, collection, data, options = {}) {
    if (!allowedMongoOps.includes(operation)) {
        throw new Error(`Invalid Mongo operation: ${operation}`);
    }
    if (!collection || typeof collection !== 'string') {
        throw new Error('Mongo collection name must be a non-empty string');
    }

    const payload = {
        collection,
        ...(operation === 'insert' && { data }),
        ...(operation === 'find' && { query: data }),
        ...(operation === 'update' && {
            query: options.query || {},
            update: data,
            upsert: options.upsert || false,
        }),
    };

    return {
        storageType: 'mongo',
        operation,
        payload,
    };
}

/**
 * Creates a packet for Redis-based Vault operations.
 *
 * @param {'set' | 'get' | 'del'} operation - Redis operation type
 * @param {string} key - Redis key
 * @param {*} [value] - Value to set (only for 'set')
 * @param {number} [ttl] - Optional time-to-live in seconds (only for 'set')
 * @returns {object} Vault packet
 * @throws {Error} If inputs are invalid
 */
export function packRedis(operation, key, value, ttl) {
    if (!allowedRedisOps.includes(operation)) {
        throw new Error(`Invalid Redis operation: ${operation}`);
    }
    if (!key || typeof key !== 'string') {
        throw new Error('Redis key must be a non-empty string');
    }

    const payload = { key };

    if (operation === 'set') {
        if (typeof value === 'undefined') {
            throw new Error('Redis SET operation requires a value');
        }
        payload.value = value;
        if (ttl) {
            if (typeof ttl !== 'number' || ttl <= 0) {
                throw new Error('TTL must be a positive number (in seconds)');
            }
            payload.ttl = ttl;
        }
    }

    return {
        storageType: 'redis',
        operation,
        payload,
    };
}
