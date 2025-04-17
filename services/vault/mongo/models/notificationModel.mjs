/**
 * @fileoverview
 * NotificationModel class for MongoDB storage of notified Kavita item metadata.
 * Provides methods for inserting and querying notification batches.
 *
 * @module notificationModel
 */

import { getMongoDb } from '../initMongo.mjs';
import { printError } from '../../../../utilities/logger/logUtils.mjs';

/**
 * MongoDB model for handling library notification persistence.
 */
export default class NotificationModel {
    constructor() {
        const mongo = getMongoDb();
        if (!mongo) throw new Error('MongoDB not initialized');
        this.collection = mongo.collection('kavita_notifications');
    }

    /**
     * Saves a batch of notification items into MongoDB.
     *
     * @param {string} batchId - Unique ID for the batch (e.g., timestamp or UUID)
     * @param {Array<Object>} items - Array of items to store
     * @returns {Promise<{ successCount: number }>} Count of successfully inserted documents
     */
    async saveNotifiedItems(batchId, items) {
        try {
            const docs = items.map(item => ({
                batchId,
                ...item,
                savedAt: new Date()
            }));

            const result = await this.collection.insertMany(docs);
            return { successCount: result.insertedCount || 0 };
        } catch (err) {
            printError('[MongoDB] Failed to save notification batch:');
            printError(err.message);
            return { successCount: 0 };
        }
    }

    /**
     * Returns the number of stored notification documents.
     *
     * @returns {Promise<number>} Total number of documents in the collection
     */
    async getStoredNotificationCount() {
        return await this.collection.countDocuments();
    }
}
