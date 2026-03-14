/**
 * @fileoverview Normalizes Portal's command map into stable command-definition lists.
 * Related files:
 * - commands/index.mjs
 * - discord/commandSynchronizer.mjs
 * - discord/commandInspector.mjs
 * - discord/client.mjs
 * Times this file has been edited: 2
 */

const toEntries = (commands) => {
    if (!commands) {
        return [];
    }

    if (commands instanceof Map) {
        return Array.from(commands.entries());
    }

    if (Array.isArray(commands)) {
        return commands;
    }

    if (typeof commands === 'object') {
        return Object.entries(commands);
    }

    return [];
};

/**
 * Normalizes a command collection into a stable map keyed by command name.
 *
 * @param {*} commands - Input passed to the function.
 * @returns {*} The function result.
 */
export const normalizeCommandMap = (commands = new Map()) => {
    const entries = toEntries(commands)
        .filter(([name, command]) => Boolean(name) && command && typeof command === 'object');

    return new Map(entries);
};

/**
 * Extracts Discord command definition payloads from the command map.
 *
 * @param {*} commandMap - Input passed to the function.
 * @returns {*} The function result.
 */
export const extractCommandDefinitions = (commandMap = new Map()) =>
    Array.from(commandMap.values())
        .map(command => command?.definition)
        .filter(Boolean);

