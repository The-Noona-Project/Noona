import dotenv from 'dotenv';
import {errMSG} from '../../../utilities/etc/logger.mjs';
import {
    formatCommandInventory,
    listApplicationCommands,
    resolveDiscordCommandConfig,
    summarizeCommandInventory,
} from '../shared/discord/commandInspector.mjs';

const envPath = process.env.PORTAL_ENV_FILE || process.env.ENV_FILE || undefined;
dotenv.config({path: envPath});

const emitOutput = inventory => {
    if (process.argv.includes('--json')) {
        process.stdout.write(`${JSON.stringify(summarizeCommandInventory(inventory), null, 2)}\n`);
        return;
    }

    process.stdout.write(`${formatCommandInventory(inventory)}\n`);
};

const main = async () => {
    const config = resolveDiscordCommandConfig();
    const inventory = await listApplicationCommands(config);
    emitOutput(inventory);
};

main().catch(error => {
    errMSG(`[Portal/Discord] Failed to list slash commands: ${error.message}`);
    process.exitCode = 1;
});

