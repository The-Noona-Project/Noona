/**
 * @fileoverview
 * Parses and executes Vault packets by routing to MongoDB or Redis.
 * Ensures safety, validation, and returns uniform responses.
 */

import connectMongo from './mongo/mongoClient.mjs';
import redis from './redis/redisClient.mjs';
import { log, warn, errMSG } from '../etc/logger.mjs';

const allowedOps = {
    mongo: ['insert', 'find', 'findMany', 'update'],
    redis: ['set', 'get', 'del'],
};

/**
 * Handles a Vault-formatted packet and executes the desired database operation.
 *
 * @param {object} packet
 * @returns {Promise<object>} result
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
                    log(`[Vault] 🧾 Inserted into "${collection}"`);
                    return { status: 'ok', insertedId: result.insertedId };
                }

                case 'find': {
                    const result = await col.findOne(query);
                    log(`[Vault] 🔍 Queried "${collection}"`);
                    return result ? { status: 'ok', data: result } : { error: 'No document found' };
                }

                case 'findMany': {
                    const cursor = col.find(query);
                    const results = await cursor.toArray();
                    log(`[Vault] 📚 Queried many from "${collection}" (count=${results.length})`);
                    return { status: 'ok', data: results };
                }

                case 'update': {
                    const result = await col.updateOne(query, update, { upsert });
                    log(`[Vault] 🔧 Updated "${collection}"`);
                    return {
                        status: 'ok',
                        matched: result.matchedCount,
                        modified: result.modifiedCount,
                    };
                }
            }
        }

        if (storageType === 'redis') {
            const { key, value, ttl } = payload;

            switch (operation) {
                case 'set': {
                    const payloadStr = JSON.stringify(value);
                    if (ttl) {
                        await redis.set(key, payloadStr, 'EX', parseInt(ttl, 10));
                        log(`[Vault] 🧠 SET Redis key="${key}" with TTL=${ttl}s`);
                    } else {
                        await redis.set(key, payloadStr);
                        log(`[Vault] 🧠 SET Redis key="${key}"`);
                    }
                    return { status: 'ok' };
                }

                case 'get': {
                    const raw = await redis.get(key);
                    if (!raw) return { error: 'Key not found in Redis' };
                    log(`[Vault] 📤 GET Redis key="${key}"`);
                    return { status: 'ok', data: JSON.parse(raw) };
                }

                case 'del': {
                    const deleted = await redis.del(key);
                    log(`[Vault] ❌ DEL Redis key="${key}"`);
                    return { status: 'ok', deleted };
                }
            }
        }

    } catch (err) {
        errMSG(`[Vault] ❗ Packet processing error: ${err.message}`);
        return { error: 'Internal server error' };
    }
}
