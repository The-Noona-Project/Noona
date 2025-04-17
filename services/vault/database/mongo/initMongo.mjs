/**
 * @fileoverview
 * Initializes a connection to MongoDB using Mongoose, with optional admin auth.
 * Makes the `db` instance available via `getMongoDb()`.
 *
 * @module initMongo
 */

import mongoose from 'mongoose';
import { printSection, printResult, printError, printDebug } from '../../noona/logger/logUtils.mjs';

let mongoDb = null;
const isDev = process.env.NODE_ENV === 'development';

/**
 * Establishes a MongoDB connection using environment config.
 *
 * @async
 * @function
 * @returns {Promise<{ client: typeof mongoose, db: object } | false>} Connection metadata or false on failure
 */
export default async function initMongo() {
    let mongoURL = process.env.MONGO_URL || 'mongodb://localhost:27017/noona';

    if (!mongoURL.includes('authSource=')) {
        const separator = mongoURL.includes('?') ? '&' : '?';
        mongoURL += `${separator}authSource=admin`;
    }

    printSection('MongoDB');
    if (isDev) printDebug(`MongoDB URL → ${mongoURL}`);

    try {
        const client = await mongoose.connect(mongoURL, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 10000,
            maxPoolSize: 10
        });

        mongoose.connection.on('error', (err) => {
            printError(`[MongoDB] Connection error: ${err.message}`);
        });

        mongoose.connection.on('disconnected', () => {
            printError('[MongoDB] Disconnected.');
        });

        mongoDb = mongoose.connection.db;
        printResult(`✅ Connected to MongoDB at ${mongoURL}`);
        return { client, db: mongoDb };
    } catch (err) {
        printError('❌ Failed to connect to MongoDB.');
        printDebug(`Authentication failed. Reason → ${err.message}`);
        return false;
    }
}

/**
 * Access the connected MongoDB database instance.
 *
 * @function
 * @returns {object|null} MongoDB DB instance or null if not connected
 */
export function getMongoDb() {
    return mongoDb;
}
