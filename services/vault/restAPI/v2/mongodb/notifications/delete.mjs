/**
 * @fileoverview
 * Express route to delete the record that stores Kavita notification IDs in MongoDB.
 * This resets notification tracking (e.g., after a re-import or full rescan).
 *
 * @module mongoNotificationDelete
 */

import express from 'express';
import { getMongoDb } from '../../../../mongo/initMongo.mjs';

const router = express.Router();

/**
 * DELETE /v2/mongodb/notifications/delete
 *
 * Deletes the document with `{ type: 'kavitaNotifiedIds' }` from the `kavitaNotifications` collection.
 *
 * @name DELETE/mongodb/notifications/delete
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
router.delete('/', async (req, res) => {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, message: 'MongoDB not available' });

    try {
        const result = await db.collection('kavitaNotifications').deleteOne({ type: 'kavitaNotifiedIds' });

        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'No record found to delete' });
        }

        res.status(200).json({ success: true, message: 'IDs deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to delete IDs', error: err.message });
    }
});

/**
 * Metadata for dynamic route loaders.
 * @type {{ path: string, method: string, authLevel: string, description: string }}
 */
export const routeMeta = {
    path: '/v2/mongodb/notifications/delete',
    method: 'DELETE',
    authLevel: 'protected',
    description: 'Deletes the stored notified IDs from MongoDB',
};

export default router;
