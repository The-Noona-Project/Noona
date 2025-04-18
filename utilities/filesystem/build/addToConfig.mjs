// ✅ /noona/filesystem/build/addToConfig.mjs

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import { printResult, printError } from '../../logger/logUtils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const settingsDir = path.resolve(__dirname, '../../../family/noona-warden/files/settings');
const configFilePath = path.join(settingsDir, 'config.yml');

/**
 * Adds or updates a configuration entry in the YAML file.
 *
 * @function addToConfig
 * @param {string} group - Dot-separated group path (e.g., "NOONA.VAULT.API").
 * @param {string} id - Key name within that group (e.g., "VAULT_URL").
 * @param {any} value - Value to assign to the key.
 */
export function addToConfig(group, id, value) {
    try {
        if (!fs.existsSync(configFilePath)) {
            printError(`⚠️ Configuration file not found: ${configFilePath}`);
            process.exit(1);
        }

        const fileContents = fs.readFileSync(configFilePath, 'utf8');
        let config = yaml.load(fileContents) || {};

        const groupKeys = group ? group.split('.') : [];
        let current = config;

        for (const key of groupKeys) {
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }

        current[id] = value;

        const newYaml = yaml.dump(config, { lineWidth: -1 });
        fs.writeFileSync(configFilePath, newYaml, 'utf8');
        printResult(`📝 Config updated: ${group}.${id} = ${value}`);
    } catch (err) {
        printError(`❌ Failed to update config: ${err.message}`);
        throw err;
    }
}
