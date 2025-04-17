/**
 * @fileoverview
 * Express route to retrieve the list of Kavita item IDs that have already been notified.
 * Reads from a MongoDB document stored under `{ type: 'kavitaNotifiedIds' }`.
 *
 * @module mongoNotificationRead
 */

import express from 'express';
import { getMongoDb } from '../../../../mongo/initMongo.mjs';

const router = express.Router();

/**
 * GET /v2/mongodb/notifications/read
 *
 * Returns a list of notified item IDs from the `kavitaNotifications` collection.
 *
 * @name GET/mongodb/notifications/read
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<void>}
 */
router.get('/', async (req, res) => {
    const db = getMongoDb();
    if (!db) {
        return res.status(503).json({ success: false, message: 'MongoDB not available' });
    }

    try {
        const record = await db.collection('kavitaNotifications').findOne({ type: 'kavitaNotifiedIds' });
        const ids = record?.ids || [];

        res.status(200).json({ success: true, ids });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch IDs', error: err.message });
    }
});

/**
 * Route metadata for dynamic router use.
 * @type {{ path: string, method: string, authLevel: string, description: string }}
 */
export const routeMeta = {
    path: '/v2/mongodb/notifications/read',
    method: 'GET',
    authLevel: 'protected',
    description: 'Reads the current list of notified item IDs from MongoDB',
};

export default router;
