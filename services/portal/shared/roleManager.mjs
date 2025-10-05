// services/portal/shared/roleManager.mjs

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const normalizeCommandName = (commandName) => {
    if (typeof commandName !== 'string') {
        return '';
    }

    return commandName
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '_');
};

const resolveGuildId = (interaction) =>
    interaction?.guildId
    ?? interaction?.guild?.id
    ?? interaction?.member?.guild?.id
    ?? null;

const hasRoleInCollection = (collection, roleId) => {
    if (!collection) {
        return false;
    }

    if (typeof collection.has === 'function') {
        try {
            return collection.has(roleId);
        } catch (error) {
            return false;
        }
    }

    if (typeof collection.get === 'function') {
        try {
            return collection.get(roleId) != null;
        } catch (error) {
            return false;
        }
    }

    if (Array.isArray(collection)) {
        return collection.includes(roleId);
    }

    if (collection instanceof Set) {
        return collection.has(roleId);
    }

    if (collection instanceof Map) {
        return collection.has(roleId);
    }

    if (collection && typeof collection === 'object') {
        return Object.prototype.hasOwnProperty.call(collection, roleId);
    }

    return false;
};

const memberHasRole = (member, roleId) => {
    if (!roleId) {
        return true;
    }

    if (!member) {
        return false;
    }

    const sources = [];

    if (member.roles) {
        sources.push(member.roles);

        if (member.roles.cache) {
            sources.push(member.roles.cache);
        }

        if (Array.isArray(member.roles)) {
            sources.push(member.roles);
        }
    }

    if (Array.isArray(member._roles)) {
        sources.push(member._roles);
    }

    sources.push(member);

    return sources.some(source => hasRoleInCollection(source, roleId));
};

const resolveDeniedMessage = ({ reason }) => {
    switch (reason) {
    case 'guild':
        return 'This command can only be used inside the configured Discord server.';
    case 'role':
        return 'You do not have permission to use this command.';
    default:
        return 'You do not have permission to use this command.';
    }
};

export const createRoleManager = ({ env = process.env } = {}) => {
    const requiredGuildId = normalizeString(env.REQUIRED_GUILD_ID);

    const getRequiredRoleKey = (commandName) => {
        const normalized = normalizeCommandName(commandName);
        if (!normalized) {
            return null;
        }

        return `REQUIRED_ROLE_${normalized}`;
    };

    const getRequiredRoleId = (commandName) => {
        const key = getRequiredRoleKey(commandName);
        if (!key) {
            return null;
        }

        return normalizeString(env[key]);
    };

    const checkAccess = (interaction, commandName) => {
        if (requiredGuildId) {
            const interactionGuildId = resolveGuildId(interaction);
            if (interactionGuildId !== requiredGuildId) {
                return {
                    allowed: false,
                    reason: 'guild',
                    message: resolveDeniedMessage({ reason: 'guild' }),
                    requiredGuildId,
                };
            }
        }

        const requiredRoleId = getRequiredRoleId(commandName);
        if (requiredRoleId && !memberHasRole(interaction?.member, requiredRoleId)) {
            return {
                allowed: false,
                reason: 'role',
                message: resolveDeniedMessage({ reason: 'role' }),
                requiredRoleId,
            };
        }

        return {
            allowed: true,
            requiredGuildId,
            requiredRoleId,
        };
    };

    return Object.freeze({
        checkAccess,
        getRequiredRoleId,
        getRequiredRoleKey,
        requiredGuildId,
    });
};

export default createRoleManager;
