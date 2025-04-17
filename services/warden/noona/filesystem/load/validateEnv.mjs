// noona/logger/validateEnv.mjs

import chalk from 'chalk';
import {
    printDivider,
    printSection,
    printResult,
    printWarning,
    printError,
    printDebug
} from '../../logger/logUtils.mjs';

/**
 * 🌱 Validates required and optional environment variables.
 * Exits the process if any required variables are missing.
 *
 * @param {string[]} requiredKeys - Environment variables that must be set.
 * @param {string[]} [optionalKeys=[]] - Environment variables that are optional but recommended.
 */
export function validateEnv(requiredKeys = [], optionalKeys = []) {
    printSection('🌱 Validating Environment Variables');

    const missingRequired = [];
    const missingOptional = [];

    for (const key of requiredKeys) {
        if (!process.env[key]) missingRequired.push(key);
    }

    for (const key of optionalKeys) {
        if (!process.env[key]) missingOptional.push(key);
    }

    const isDev = process.env.NODE_ENV?.trim().toLowerCase() === 'development';
    if (isDev) {
        printDivider();
        printDebug('Development mode enabled. Listing all validated environment variables:');
        const allKeys = [...requiredKeys, ...optionalKeys];
        for (const key of allKeys) {
            if (process.env[key]) {
                console.log(`  ${chalk.green('✔')} ${chalk.bold(key)} = ${process.env[key]}`);
            } else {
                console.log(`  ${chalk.red('✖')} ${chalk.bold(key)} is missing`);
            }
        }
        printDivider();
    }

    if (missingRequired.length > 0) {
        printDivider();
        printError('Missing Required Environment Variables:\n');
        for (const key of missingRequired) {
            console.log(`  ${chalk.redBright('•')} ${chalk.bold(key)}`);
        }
        printDivider();
        console.log();
        process.exit(1);
    }

    if (missingOptional.length > 0) {
        printWarning('Missing Optional Environment Variables:\n');
        for (const key of missingOptional) {
            console.log(`  ${chalk.yellow('•')} ${chalk.bold(key)}`);
        }
        console.log();
    }

    printResult('Environment validated');
    printDivider();
}

/**
 * Use this function in initmain.mjs like so:
 *
 * validateEnv(
 *   [
 *     // Required: Core Runtime
 *     'NODE_ENV',
 *     'JWT_SECRET',
 *     'JWT_PRIVATE_KEY_PATH',
 *     'JWT_PUBLIC_KEY_PATH',
 *     'VAULT_JWT',
 *
 *     // Required: Vault Databases
 *     'MONGO_USER',
 *     'MONGO_PASSWORD',
 *     'MONGO_DATABASE',
 *     'REDIS_URL',
 *     'MARIADB_USER',
 *     'MARIADB_PASSWORD',
 *     'MARIADB_DATABASE',
 *
 *     // Required: Vault API Port
 *     'VAULT_PORT'
 *   ],
 *   [
 *     // Optional: Portal Features
 *     'PORTAL_PORT',
 *     'DISCORD_CLIENT_ID',
 *     'DISCORD_TOKEN',
 *     'KAVITA_API_KEY',
 *     'KAVITA_SERVER_URL',
 *     'VAULT_API_URL',
 *     'PORTAL_JWT_SECRET',
 *
 *     // Optional: Port Overrides
 *     'MONGODB_PORT',
 *     'MARIADB_PORT',
 *
 *     // Optional: Internal health timer
 *     'CHECK_INTERVAL_HOURS'
 *   ]
 * );
 */
