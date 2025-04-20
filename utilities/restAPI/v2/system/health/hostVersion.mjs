/**
 * @fileoverview
 * Express router that provides detailed version information for the Noona-Vault service,
 * including Node.js, Docker, and all connected databases (MongoDB, Redis, MariaDB).
 *
 * This route is useful for diagnostics, dashboard displays, or external service checks.
 *
 * @module hostVersion
 */

import express from 'express';
import { execSync } from 'child_process';
import { getMongoDb } from '../../../../mongo/initMongo.mjs';
import { printDebug, printError } from '../../../../../../utilities/logger/logUtils.mjs';

const router = express.Router();

/**
 * GET /v2/system/health/hostVersion
 *
 * Public route that returns version metadata:
 * - Service version (from requirements.txt)
 * - Node.js runtime version
 * - Docker server version (via CLI)
 * - MongoDB, Redis, and MariaDB versions
 *
 * @function
 * @name GET/hostVersion
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @returns {Promise<import('express').Response>} JSON containing version info
 */
router.get('/', async (req, res) => {
    const result = {
        success: true,
        service: 'noona-vault',
        version: process.env.npm_package_version || '0.0.0-dev',
        node: process.version,
        docker: null,
        databases: {}
    };

    // Docker Version
    try {
        const output = execSync('docker version --format "{{.Server.Version}}"').toString().trim();
        result.docker = output;
    } catch (err) {
        printError('[Version] Could not retrieve Docker version');
    }

    // MongoDB Version
    try {
        const db = getMongoDb();
        if (db) {
            const info = await db.admin().serverStatus();
            result.databases.mongo = info?.version || 'unknown';
        } else {
            printDebug('[Version] MongoDB DB object not found');
        }
    } catch (err) {
        printError(`[Version] MongoDB error: ${err.message}`);
    }

    // Redis Version
    try {
        const redis = global.noonaRedisClient;
        if (redis) {
            const info = await redis.info();
            const match = info.match(/redis_version:(\S+)/);
            result.databases.redis = match?.[1] || 'unknown';
        } else {
            printDebug('[Version] Redis client not found in global scope');
        }
    } catch (err) {
        printError(`[Version] Redis error: ${err.message}`);
    }

    // MariaDB Version
    try {
        const conn = global.noonaMariaConnection;
        if (conn) {
            const [rows] = await conn.query('SELECT VERSION() AS version');
            result.databases.mariadb = rows[0]?.version || 'unknown';
        } else {
            printDebug('[Version] MariaDB connection not found in global scope');
        }
    } catch (err) {
        printError(`[Version] MariaDB error: ${err.message}`);
    }

    printDebug('[Version] Version info sent to client');
    return res.status(200).json(result);
});

/**
 * Route metadata — used for automatic registration or docs.
 * @type {{ path: string, authLevel: string, description: string }}
 */
export const routeMeta = {
    path: '/v2/system/health/hostVersion',
    authLevel: 'public',
    description: 'Returns service, Node.js, Docker, and database versions'
};

export default router;
