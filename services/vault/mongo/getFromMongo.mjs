/**
 * @fileoverview
 * Fetches documents from a MongoDB collection based on a query filter.
 *
 * @module getFromMongo
 */

import { getMongoDb } from './initMongo.mjs';
import { printDebug, printError } from '../../../utilities/logger/logUtils.mjs';

/**
 * Queries documents from the specified collection.
 *
 * @async
 * @function
 * @param {string} collectionName - MongoDB collection to query
 * @param {object} [filter={}] - Optional filter for MongoDB query
 * @returns {Promise<Array|null>} Array of documents or null if error/invalid DB
 */
export async function getFromMongo(collectionName, filter = {}) {
    const db = getMongoDb();
    if (!db) {
        printError('[Mongo] Database not connected');
        return null;
    }

    try {
        const collection = db.collection(collectionName);
        const docs = await collection.find(filter).toArray();
        printDebug(`[Mongo] Fetched ${docs.length} documents from "${collectionName}"`);
        return docs;
    } catch (err) {
        printError(`[Mongo] Failed to fetch documents from "${collectionName}": ${err.message}`);
        return null;
    }
}

// Re-export getMongoDb so routes can import from here
export { getMongoDb } from './initMongo.mjs';
