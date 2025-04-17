/**
 * @fileoverview
 * Returns the currently connected MongoDB database instance.
 * Assumes `initMongo()` has already been called.
 *
 * @module connectMongo
 */

import { getMongoDb } from './initMongo.mjs';

/**
 * Retrieves the connected MongoDB DB instance.
 *
 * @function
 * @returns {object|null} MongoDB DB or null if not initialized
 */
export async function connectToMongo() {
    return getMongoDb();
}
 