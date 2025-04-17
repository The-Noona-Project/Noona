// ✅ /noona/filesystem/build/buildConfig.mjs

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { printResult, printError } from '../../logger/logUtils.mjs';
import { addToConfig } from './addToConfig.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const settingsDir = path.resolve(__dirname, '../../../family/noona-warden/files/settings');
const configFilePath = path.join(settingsDir, 'config.yml');

/**
 * Builds the initial `config.yml` file with placeholder values if it doesn't already exist.
 * Populates grouped configuration sections using `addToConfig()`.
 *
 * @async
 * @function buildConfig
 * @returns {Promise<void>}
 */
export async function buildConfig() {
    try {
        if (!fs.existsSync(configFilePath)) {
            fs.writeFileSync(configFilePath, yaml.dump({}), 'utf8');
            printResult(`📁 Created empty config file at ${configFilePath}`);

            // Core
            addToConfig('', 'NODE_ENV', 'development');

            // Vault
            addToConfig('NOONA.VAULT.API', 'VAULT_URL', 'http://noona-vault:3120');
            addToConfig('NOONA.VAULT.API', 'VAULT_PORT', 3120);

            // Portal
            addToConfig('NOONA.PORTAL.API', 'PORTAL_PORT', 3121);

            // Discord Bot
            addToConfig('NOONA.PORTAL.DISCORD.BOT', 'DISCORD_TOKEN', 'your_discord_token_here');
            addToConfig('NOONA.PORTAL.DISCORD.BOT', 'DISCORD_CLIENT_ID', 'your_discord_client_id_here');
            addToConfig('NOONA.PORTAL.DISCORD.BOT', 'REQUIRED_GUILD_ID', 'your_required_guild_id_here');

            // Discord Roles
            addToConfig('NOONA.PORTAL.DISCORD.ROLES', 'REQUIRED_ROLE_ADMIN', 'your_required_role_admin_here');
            addToConfig('NOONA.PORTAL.DISCORD.ROLES', 'REQUIRED_ROLE_MOD', 'your_required_role_mod_here');
            addToConfig('NOONA.PORTAL.DISCORD.ROLES', 'REQUIRED_ROLE_USER', 'your_required_role_user_here');

            // Discord Channels
            addToConfig('NOONA.PORTAL.DISCORD.CHANNELS', 'NOTIFICATION_CHANNEL_ID', 'your_notification_channel_id_here');

            // Discord Timers
            addToConfig('NOONA.PORTAL.DISCORD.TIMERS', 'CHECK_INTERVAL_HOURS', 168);
            addToConfig('NOONA.PORTAL.DISCORD.TIMERS', 'KAVITA_LOOKBACK_HOURS', 2);

            // Kavita
            addToConfig('NOONA.PORTAL.KAVITA', 'KAVITA_URL', 'https://pax-kun.com');
            addToConfig('NOONA.PORTAL.KAVITA', 'KAVITA_API_KEY', 'your_kavita_api_key_here');
            addToConfig('NOONA.PORTAL.KAVITA', 'KAVITA_LIBRARY_IDS', '1,2');

            // Tokens
            addToConfig('TOKENS', 'JWT_SECRET', 'supersecret');

            // Mongo
            addToConfig('MONGO', 'MONGO_URL', 'mongodb://admin:password@noona-mongodb:27017/noona');
            addToConfig('MONGO', 'MONGODB_PORT', 27017);
            addToConfig('MONGO', 'MONGO_USER', 'admin');
            addToConfig('MONGO', 'MONGO_PASSWORD', 'password');
            addToConfig('MONGO', 'MONGO_DATABASE', 'noona');
            addToConfig('MONGO', 'MONGO_INITDB_ROOT_USERNAME', 'admin');
            addToConfig('MONGO', 'MONGO_INITDB_ROOT_PASSWORD', 'password');
            addToConfig('MONGO', 'MONGO_INITDB_DATABASE', 'noona');

            // Redis
            addToConfig('REDIS', 'REDIS_URL', 'redis://noona-redis:6379');

            // MariaDB
            addToConfig('MARIADB', 'MARIADB_HOST', 'noona-mariadb');
            addToConfig('MARIADB', 'MARIADB_PORT', 3306);
            addToConfig('MARIADB', 'MARIADB_USER', 'admin');
            addToConfig('MARIADB', 'MARIADB_PASSWORD', 'password');
            addToConfig('MARIADB', 'MARIADB_DATABASE', 'noona');

            printResult('✔ Default configuration values written using addToConfig()');
        } else {
            printResult(`📄 Config file already exists at ${configFilePath}`);
        }
    } catch (err) {
        printError(`❌ Error building config: ${err.message}`);
        throw err;
    }
}

// Re-export for external usage
export { addToConfig };
