/**
 * @fileoverview
 * Express route that stores a list of "notified" item IDs in MongoDB under a known document key.
 * Used to persist which Kavita items have been previously announced, avoiding duplicates.
 *
 * @module mongoNotificationCreate
 */

import express from 'express';
import { getMongoDb } from '../../../../mongo/initMongo.mjs';

const router = express.Router();

/**
 * POST /v2/mongodb/notifications/create
 *
 * Request Body:
 * ```json
 * {
 *   "ids": ["abc123", "def456", ...]
 * }
 * ```
 *
 * Stores the given IDs under a document with `{ type: 'kavitaNotifiedIds' }`.
 *
 * @name POST/mongodb/notifications/create
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
router.post('/', async (req, res) => {
    const db = getMongoDb();
    if (!db) return res.status(503).json({ success: false, message: 'MongoDB not available' });

    try {
        const { ids } = req.body;
        if (!Array.isArray(ids)) {
            return res.status(400).json({ success: false, message: 'ids must be an array' });
        }

        await db.collection('kavitaNotifications').updateOne(
            { type: 'kavitaNotifiedIds' },
            { $set: { ids, updatedAt: new Date() } },
            { upsert: true }
        );

        res.status(200).json({ success: true, message: 'IDs stored successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to store IDs', error: err.message });
    }
});

/**
 * Metadata for dynamic route loaders.
 * @type {{ path: string, method: string, authLevel: string, description: string }}
 */
export const routeMeta = {
    path: '/v2/mongodb/notifications/create',
    method: 'POST',
    authLevel: 'protected',
    description: 'Stores a list of notified item IDs in MongoDB',
};

export default router;
