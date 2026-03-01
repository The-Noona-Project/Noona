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

export const normalizeCommandMap = (commands = new Map()) => {
    const entries = toEntries(commands)
        .filter(([name, command]) => Boolean(name) && command && typeof command === 'object');

    return new Map(entries);
};

export const extractCommandDefinitions = (commandMap = new Map()) =>
    Array.from(commandMap.values())
        .map(command => command?.definition)
        .filter(Boolean);

