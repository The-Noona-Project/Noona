/**
 * @fileoverview
 * Entry point for Noona-Vault. Initializes databases, configures Express middleware,
 * mounts REST API routes, and handles lifecycle events including graceful shutdown.
 *
 * This script is designed to be containerized (Docker) and runs the Vault microservice
 * which handles secure storage, JWT distribution, and database operations.
 *
 * @version 1.0.1
 * @module initmain
 */

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import chalk from 'chalk';

import { initializeDatabases } from './database/databaseManager.mjs';
import { mountRoutesV2 } from './noona/restAPI/routeManagerV2.mjs';
import {
    printBanner,
    printDivider,
    printSection,
    printResult,
    printError,
    printDebug
} from './noona/logger/logUtils.mjs';
import { validateEnv } from './noona/logger/validateEnv.mjs';

// ─────────────────────────────────────────────────────────────
// 🌐 Validate Required Environment Variables
// ─────────────────────────────────────────────────────────────
validateEnv(
    [
        'PORT',
        'MONGO_URL',
        'REDIS_URL',
        'MARIADB_HOST',
        'MARIADB_USER',
        'MARIADB_PASSWORD',
        'MARIADB_DATABASE'
    ],
    ['NODE_ENV']
);

const app = express();
const PORT = process.env.PORT || 3120;
let server = null;

// Display boot banner
printBanner('Noona Vault');
printDivider();

/**
 * Log unhandled promise rejections to help catch async bugs.
 * @param {any} reason - Reason for the rejection
 */
process.on('unhandledRejection', (reason) => {
    printError('⚠️ Unhandled Promise Rejection:');
    console.error(reason);
});

/**
 * Bootstraps the Noona-Vault application.
 * - Initializes databases
 * - Sets up middleware
 * - Mounts REST routes
 * - Starts the Express server
 */
(async () => {
    try {
        const isDev = process.env.NODE_ENV?.toLowerCase() === 'development';
        if (isDev) {
            printSection('🔍 Debug Mode Active');
            printDebug(`PORT = ${PORT}`);
            printDebug(`NODE_ENV = ${process.env.NODE_ENV}`);
            printDebug(`MONGO_URL = ${process.env.MONGO_URL}`);
            printDebug(`REDIS_URL = ${process.env.REDIS_URL}`);
            printDebug(`MARIADB_HOST = ${process.env.MARIADB_HOST}`);
            printDebug(`MARIADB_DATABASE = ${process.env.MARIADB_DATABASE}`);
            printDivider();
        }

        printSection('📦 Initializing Databases');
        await initializeDatabases();
        printResult('✅ All database clients connected');

        printSection('🧩 Setting Up Middleware');
        app.use(cors());
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        app.use(morgan('dev'));
        printResult('✅ Express middleware ready');

        printSection('🔁 Mounting REST API Routes');
        await mountRoutesV2(app); // ✅ V2 routes only
        printResult('✅ Routes mounted');

        printSection('🚀 Starting API Server');
        server = app.listen(PORT, () => {
            printResult(`✅ Vault API listening on port ${PORT}`);
            printDivider();
            console.log(chalk.bold.cyan('[Noona-Vault] Vault is ready and awaiting secure orders.'));
            printDivider();
        });
    } catch (err) {
        printError('❌ Error during initialization:');
        console.error(err);
        process.exit(1);
    }
})();

/**
 * Gracefully shuts down all services and connections on termination signals.
 * @param {string} signal - Signal type (e.g., 'SIGINT', 'SIGTERM')
 */
function handleShutdown(signal) {
    printDivider();
    printSection(`💤 ${signal} received — Shutting down Noona-Vault`);

    const closeTasks = [
        global.noonaMongoClient?.close?.(),
        global.noonaRedisClient?.quit?.(),
        global.noonaMariaConnection?.end?.()
    ];

    if (server?.close) {
        closeTasks.push(new Promise(resolve => server.close(resolve)));
    }

    Promise.allSettled(closeTasks)
        .then(() => {
            printResult('✅ All services and connections closed. Vault secure.');
            process.exit(0);
        })
        .catch(err => {
            printError('❌ Error during shutdown:');
            console.error(err);
            process.exit(1);
        });
}

// Bind shutdown handler
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
