/**
 * @fileoverview Lists the current Portal slash commands using the configured Discord settings.
 * Related files:
 * - commands/index.mjs
 * - discord/commandInspector.mjs
 * - config/portalConfig.mjs
 * Times this file has been edited: 3
 */

import dotenv from 'dotenv';
import {errMSG} from '../../../utilities/etc/logger.mjs';
import {
    formatCommandInventory,
    listApplicationCommands,
    resolveDiscordCommandConfig,
    summarizeCommandInventory,
} from '../discord/commandInspector.mjs';

const envPath = process.env.PORTAL_ENV_FILE || process.env.ENV_FILE || undefined;
dotenv.config({path: envPath});

/**
 * Writes the requested command inventory format to stdout.
 *
 * @param {*} inventory - Command inventory collected from Discord.
 * @returns {void}
 */
const emitOutput = inventory => {
    if (process.argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify(summarizeCommandInventory(inventory), null, 2)}\n`);
        return;
    }

    process.stdout.write(`${formatCommandInventory(inventory)}\n`);
};

/**
 * Loads the current Discord command inventory and prints it for operators.
 *
 * @returns {Promise<void>}
 */
const main = async () => {
    const config = resolveDiscordCommandConfig();
    const inventory = await listApplicationCommands(config);
    emitOutput(inventory);
};

main().catch(error => {
    errMSG(`[Portal/Discord] Failed to list slash commands: ${error.message}`);
    process.exitCode = 1;
});
