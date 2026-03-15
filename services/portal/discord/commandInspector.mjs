/**
 * @fileoverview Inspects Discord application commands and formats inventory reports.
 * Related files:
 * - commands/index.mjs
 * - scripts/listCommands.mjs
 * - tests/commandInspector.test.mjs
 * Times this file has been edited: 2
 */

import {REST, Routes} from 'discord.js';

const normalizeString = value => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const toCommandSummary = command => ({
    id: command?.id ?? null,
    name: command?.name ?? null,
    description: command?.description ?? '',
    type: command?.type ?? null,
});

const sortByName = (left, right) => {
    const leftName = left?.name ?? '';
    const rightName = right?.name ?? '';
    return leftName.localeCompare(rightName);
};

/**
 * Resolves Discord command inspection configuration from environment variables.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const resolveDiscordCommandConfig = ({env = process.env} = {}) => {
    const token = normalizeString(env.DISCORD_BOT_TOKEN);
    const clientId = normalizeString(env.DISCORD_CLIENT_ID);
    const guildId = normalizeString(env.DISCORD_GUILD_ID);

    const missing = [];
    if (!token) {
        missing.push('DISCORD_BOT_TOKEN');
    }

    if (!clientId) {
        missing.push('DISCORD_CLIENT_ID');
    }

    if (missing.length > 0) {
        const error = new Error(`Missing required environment variables: ${missing.join(', ')}`);
        error.code = 'PORTAL_DISCORD_ENV_VALIDATION_ERROR';
        throw error;
    }

    return Object.freeze({
        token,
        clientId,
        guildId,
    });
};

/**
 * Loads the current application command inventory from Discord.
 *
 * @param {object} options - Named function inputs.
 * @returns {Promise<*>} The asynchronous result.
 */
export const listApplicationCommands = async ({
                                                  token,
                                                  clientId,
                                                  guildId = null,
                                                  restFactory,
                                              } = {}) => {
    const resolvedToken = normalizeString(token);
    const resolvedClientId = normalizeString(clientId);
    const resolvedGuildId = normalizeString(guildId);

    if (!resolvedToken) {
        throw new Error('Discord bot token is required to list application commands.');
    }

    if (!resolvedClientId) {
        throw new Error('Discord client id is required to list application commands.');
    }

    const rest = typeof restFactory === 'function'
        ? restFactory({token: resolvedToken})
        : new REST({version: '10'}).setToken(resolvedToken);

    const globalRoute = Routes.applicationCommands(resolvedClientId);
    const globalCommands = await rest.get(globalRoute);

    let guildCommands = [];
    if (resolvedGuildId) {
        const guildRoute = Routes.applicationGuildCommands(resolvedClientId, resolvedGuildId);
        guildCommands = await rest.get(guildRoute);
    }

    return {
        clientId: resolvedClientId,
        guildId: resolvedGuildId,
        globalCommands: Array.isArray(globalCommands) ? globalCommands.map(toCommandSummary).sort(sortByName) : [],
        guildCommands: Array.isArray(guildCommands) ? guildCommands.map(toCommandSummary).sort(sortByName) : [],
    };
};

/**
 * Summarizes local and remote command definitions for inspection output.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const summarizeCommandInventory = ({
                                              clientId,
                                              guildId = null,
                                              globalCommands = [],
                                              guildCommands = [],
                                          } = {}) => {
    const globalNames = new Set(globalCommands.map(command => command?.name).filter(Boolean));
    const guildNames = new Set(guildCommands.map(command => command?.name).filter(Boolean));
    const duplicateNames = Array.from(globalNames)
        .filter(name => guildNames.has(name))
        .sort((left, right) => left.localeCompare(right));

    return {
        clientId: normalizeString(clientId),
        guildId: normalizeString(guildId),
        globalCount: globalCommands.length,
        guildCount: guildCommands.length,
        globalCommands,
        guildCommands,
        duplicateNames,
    };
};

const formatCommandLine = command => {
    const name = command?.name ?? 'unknown';
    const description = normalizeString(command?.description) ?? '(no description)';
    const id = normalizeString(command?.id) ?? 'n/a';
    return `- /${name} :: ${description} [id: ${id}]`;
};

/**
 * Formats a command inventory summary for console output.
 *
 * @param {*} inventory - Input passed to the function.
 * @returns {string} The formatted output string.
 */
export const formatCommandInventory = (inventory = {}) => {
    const summary = summarizeCommandInventory(inventory);
    const lines = [
        'Portal Discord command inventory',
        `Application client id: ${summary.clientId ?? 'n/a'}`,
        `Configured guild id: ${summary.guildId ?? '(not configured)'}`,
        `Global commands: ${summary.globalCount}`,
    ];

    if (summary.globalCommands.length > 0) {
        for (const command of summary.globalCommands) {
            lines.push(formatCommandLine(command));
        }
    }

    lines.push(`Guild commands: ${summary.guildCount}`);

    if (summary.guildCommands.length > 0) {
        for (const command of summary.guildCommands) {
            lines.push(formatCommandLine(command));
        }
    }

    if (summary.duplicateNames.length > 0) {
        lines.push(`Duplicate names across global and guild scopes: ${summary.duplicateNames.join(', ')}`);
    } else {
        lines.push('Duplicate names across global and guild scopes: none');
    }

    return lines.join('\n');
};

