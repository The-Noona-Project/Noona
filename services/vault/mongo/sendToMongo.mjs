/**
 * @fileoverview
 * Inserts documents into a MongoDB collection.
 * Used to persist bulk or single entries in Noona-Vault’s DB layer.
 *
 * @module sendToMongo
 */

import { getMongoDb } from './initMongo.mjs';
import { printResult, printError } from '../../../utilities/logger/logUtils.mjs';

/**
 * Inserts documents into a collection.
 *
 * @async
 * @function
 * @param {string} collectionName - Collection to insert into
 * @param {Array<object>} documents - Documents to insert
 * @returns {Promise<boolean>} Whether the insert was successful
 */
export async function sendToMongo(collectionName, documents) {
    const db = getMongoDb();
    if (!db) {
        printError('[Mongo] Database not connected');
        return false;
    }

    try {
        const collection = db.collection(collectionName);
        const result = await collection.insertMany(documents);
        printResult(`[Mongo] Inserted ${result.insertedCount} document(s) into "${collectionName}"`);
        return true;
    } catch (err) {
        printError(`[Mongo] Failed to insert documents: ${err.message}`);
        return false;
    }
}
