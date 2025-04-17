/**
 * @fileoverview
 * Initializes connections to MongoDB, Redis, and MariaDB for Noona-Vault.
 * Stores connected clients globally and prints a summarized status table.
 *
 * @module databaseManager
 */

import initMongo from './mongo/initMongo.mjs';
import initRedis from './redis/initRedis.mjs';
import initMariaDB from './mariadb/initMariadb.mjs';

import {printDbSummary} from '../noona/logger/printDbSummary.mjs';
import {printSection, printDebug, printResult} from '../noona/logger/logUtils.mjs';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Initializes database connections and populates global connection handles:
 *
 * - `global.noonaMongoClient` for MongoDB
 * - `global.noonaRedisClient` for Redis
 * - `global.noonaMariaConnection` for MariaDB
 *
 * Also prints a health summary for logging/debugging purposes.
 *
 * @async
 * @function
 * @returns {Promise<void>} Resolves once all databases are initialized
 *
 * @global {import('mongodb').MongoClient} global.noonaMongoClient
 * @global {import('redis').RedisClientType} global.noonaRedisClient
 * @global {import('mysql2/promise').Connection} global.noonaMariaConnection
 */
export async function initializeDatabases() {
    const results = [];

    printSection('🧠 Booting Database Grid');

    // ───────────── MongoDB ─────────────
    printResult('Connecting to MongoDB...');
    const mongo = await initMongo();
    if (isDev) {
        printDebug(`Mongo URL: ${process.env.MONGO_URL || 'mongodb://localhost:27017/noona'}`);
    }
    results.push({
        name: 'MongoDB',
        status: !!mongo,
        info: process.env.MONGO_URL || 'mongodb://localhost:27017/noona'
    });
    if (mongo?.client) global.noonaMongoClient = mongo.client;

    // Placeholder for further database initialization logic

    // Summarize the results
    printDbSummary(results);
}
