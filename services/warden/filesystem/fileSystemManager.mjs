/**
 * @fileoverview
 * Handles file system setup, default config generation, config loading, and validation.
 * Enters setup mode if the config file contains placeholder values.
 */

import { buildFolderTree } from './build/buildTree.mjs';
import { buildConfig } from './build/buildConfig.mjs';
import { loadConfig, configFilePath as CONFIG_PATH } from './load/loadConfig.mjs';
import { validateEnv } from './load/validateEnv.mjs';
import {
    printResult,
    printDivider,
    printSection,
    printError,
    printWarning,
    printNote
} from '../../../utilities/logger/logUtils.mjs';

import fs from 'fs';

/**
 * Checks if the config file still contains placeholder values.
 * This is used to determine whether Warden should boot into setup mode.
 * @returns {boolean} true if placeholders are detected, false if config appears valid.
 */
function configHasPlaceholders() {
    try {
        const contents = fs.readFileSync(CONFIG_PATH, 'utf8');
        const lower = contents.toLowerCase();
        return (
            lower.includes('your_discord_token_here') ||
            lower.includes('your_discord_client_id_here') ||
            lower.includes('your_required_guild_id_here') ||
            lower.includes('your_required_role') ||
            lower.includes('your_notification_channel_id_here') ||
            lower.includes('your_kavita_api_key_here')
        );
    } catch (err) {
        printError(`Failed to validate config.yml for placeholders: ${err.message}`);
        return true;
    }
}

/**
 * Manages the entire filesystem setup lifecycle:
 * - Builds folder tree
 * - Generates default config (if missing)
 * - Loads config into process.env
 * - Validates env vars
 * - Triggers setup mode if config contains placeholders
 */
export async function manageFiles() {
    try {
        printDivider();
        printSection('FILE SYSTEM MANAGEMENT: Starting file system management');

        await buildFolderTree();
        await buildConfig();
        await loadConfig();

        if (configHasPlaceholders()) {
            printWarning('! 🚩 Setup mode active — configuration is incomplete.');
            printNote('🔻 › › Please edit the config.yml file at:');
            printResult(CONFIG_PATH);
            printNote('Then restart Noona-Warden.');
            printDivider();
            process.exit(0);
        }

        validateEnv(
            [
                'NODE_ENV',
                'JWT_SECRET',
                'VAULT_JWT',
                'MONGO_URL',
                'REDIS_URL',
                'MARIADB_USER',
                'MARIADB_PASSWORD',
                'MARIADB_DATABASE',
                'VAULT_PORT'
            ],
            [
                'PORTAL_PORT',
                'DISCORD_TOKEN',
                'DISCORD_CLIENT_ID',
                'REQUIRED_GUILD_ID',
                'REQUIRED_ROLE_ADMIN',
                'REQUIRED_ROLE_MOD',
                'REQUIRED_ROLE_USER',
                'NOTIFICATION_CHANNEL_ID',
                'CHECK_INTERVAL_HOURS',
                'KAVITA_LOOKBACK_HOURS',
                'KAVITA_URL',
                'KAVITA_API_KEY',
                'KAVITA_LIBRARY_IDS'
            ]
        );

        printResult('FILE SYSTEM MANAGEMENT: Completed file system management');
        printDivider();
    } catch (err) {
        printError(`FILE SYSTEM MANAGEMENT: Error during file system management: ${err.message}`);
        throw err;
    }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    manageFiles();
}
