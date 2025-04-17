/**
 * @fileoverview
 * Express handler that returns the connection status for MongoDB, Redis, and MariaDB.
 * Uses the presence of global connection variables to determine whether each DB is online.
 *
 * @module databaseHealth
 */

/**
 * GET /v2/system/health/databaseHealth
 * Returns online/offline status and connection details for each supported database.
 *
 * @function
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<import('express').Response>} JSON response with database status
 */
export default async function databaseHealthHandler(req, res) {
    const results = {};

    // MongoDB
    if (global.noonaMongoClient) {
        results.mongo = {
            status: 'Online',
            url: process.env.MONGO_URL
        };
    } else {
        results.mongo = {
            status: 'Offline',
            url: process.env.MONGO_URL
        };
    }

    // Redis
    if (global.noonaRedisClient) {
        results.redis = {
            status: 'Online',
            url: process.env.REDIS_URL
        };
    } else {
        results.redis = {
            status: 'Offline',
            url: process.env.REDIS_URL
        };
    }

    // MariaDB
    if (global.noonaMariaConnection) {
        results.mariadb = {
            status: 'Online',
            host: process.env.MARIADB_HOST,
            user: process.env.MARIADB_USER,
            database: process.env.MARIADB_DATABASE
        };
    } else {
        results.mariadb = {
            status: 'Offline',
            host: process.env.MARIADB_HOST,
            user: process.env.MARIADB_USER,
            database: process.env.MARIADB_DATABASE
        };
    }

    return res.status(200).json(results);
}
