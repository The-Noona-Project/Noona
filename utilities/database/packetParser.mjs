// utilities/database/packetParser.mjs

/**
 * @fileoverview
 * Parses and executes Vault packets by routing to MongoDB or Redis.
 * Ensures safety, validation, and returns uniform responses.
 */

import connectMongo from './mongo/mongoClient.mjs';
import redis from './redis/redisClient.mjs';
import { log, warn, errMSG } from '../etc/logger.mjs';

const allowedOps = {
    mongo: ['insert', 'find', 'update'],
    redis: ['set', 'get', 'del'],
};

/**
 * Handles a Vault-formatted packet and executes the desired database operation.
 *
 * @param {object} packet - Packet sent to Vault
 * @param {'mongo' | 'redis'} packet.storageType - Type of database
 * @param {string} packet.operation - Operation to perform
 * @param {object} packet.payload - Payload details (key/value/query/etc.)
 * @returns {Promise<object>} Result or error object
 */
export async function handlePacket(packet) {
    const { storageType, operation, payload } = packet;

    if (!['mongo', 'redis'].includes(storageType)) {
        return { error: 'Invalid storageType: must be "mongo" or "redis"' };
    }

    if (!allowedOps[storageType].includes(operation)) {
        return { error: `Unsupported operation "${operation}" for ${storageType}` };
    }

    try {
        if (storageType === 'mongo') {
            const db = await connectMongo();
            const { collection, query = {}, data = {}, update = {}, upsert = false } = payload;

            if (!collection) {
                return { error: 'Mongo packet missing "collection"' };
            }

            const col = db.collection(collection);

            switch (operation) {
                case 'insert': {
                    const result = await col.insertOne(data);
                    log(`[Vault] Inserted document into "${collection}"`);
                    return { status: 'ok', insertedId: result.insertedId };
                }

                case 'find': {
                    const result = await col.findOne(query);
                    log(`[Vault] Queried "${collection}" with`, query);
                    return result ? { status: 'ok', data: result } : { error: 'No document found' };
                }

                case 'update': {
                    const result = await col.updateOne(query, update, { upsert });
                    log(`[Vault] Updated "${collection}" with`, query);
                    return {
                        status: 'ok',
                        matched: result.matchedCount,
                        modified: result.modifiedCount,
                    };
                }

                default:
                    return { error: 'Unhandled Mongo operation' };
            }
        }

        if (storageType === 'redis') {
            const { key, value, ttl } = payload;

            switch (operation) {
                case 'set':
                    if (!key || typeof value === 'undefined') {
                        return { error: 'Redis SET requires "key" and "value"' };
                    }
                    const payloadStr = JSON.stringify(value);
                    if (ttl) {
                        await redis.set(key, payloadStr, 'EX', parseInt(ttl, 10));
                        log(`[Vault] SET key="${key}" with TTL=${ttl}`);
                    } else {
                        await redis.set(key, payloadStr);
                        log(`[Vault] SET key="${key}"`);
                    }
                    return { status: 'ok' };

                case 'get': {
                    const raw = await redis.get(key);
                    if (!raw) return { error: 'Key not found in Redis' };
                    log(`[Vault] GET key="${key}"`);
                    return { status: 'ok', data: JSON.parse(raw) };
                }

                case 'del': {
                    const deleted = await redis.del(key);
                    log(`[Vault] DEL key="${key}"`);
                    return { status: 'ok', deleted };
                }

                default:
                    return { error: 'Unhandled Redis operation' };
            }
        }

    } catch (err) {
        errMSG(`[Vault] Packet processing error: ${err.message}`);
        return { error: 'Internal server error' };
    }
}
