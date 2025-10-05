// services/sage/shared/discordClient.mjs

import {
    Client,
    Events,
    GatewayIntentBits,
    Partials,
} from 'discord.js';
import { errMSG, log } from '../../../utilities/etc/logger.mjs';

const DEFAULT_INTENTS = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
];

const DEFAULT_PARTIALS = [
    Partials.GuildMember,
    Partials.User,
];

const normaliseCommandMap = (commands = new Map()) => {
    if (commands instanceof Map) {
        return commands;
    }

    if (Array.isArray(commands)) {
        return new Map(commands);
    }

    if (commands && typeof commands === 'object') {
        return new Map(Object.entries(commands));
    }

    return new Map();
};

const extractCommandDefinitions = (commandMap) =>
    Array.from(commandMap.values())
        .map(command => command?.definition)
        .filter(Boolean);

export const createDiscordClient = ({
    token,
    guildId,
    clientId,
    defaultRoleId = null,
    intents = DEFAULT_INTENTS,
    partials = DEFAULT_PARTIALS,
    commands,
    clientFactory,
} = {}) => {
    if (!token) {
        throw new Error('Discord token is required to initialise the Sage Discord client.');
    }

    if (!guildId) {
        throw new Error('Discord guild id is required to initialise the Sage Discord client.');
    }

    const commandMap = normaliseCommandMap(commands);

    const client = typeof clientFactory === 'function'
        ? clientFactory({ intents, partials })
        : new Client({ intents, partials });

    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });

    client.once(Events.ClientReady, bot => {
        log(`[Sage/Discord] Logged in as ${bot?.user?.tag ?? 'unknown user'}`);
        readyResolve(bot ?? client);
    });

    client.on('error', error => {
        errMSG(`[Sage/Discord] Client error: ${error.message}`);
    });

    client.on('shardError', error => {
        errMSG(`[Sage/Discord] Shard error: ${error.message}`);
    });

    const registerCommands = async () => {
        const definitions = extractCommandDefinitions(commandMap);
        if (!definitions.length) {
            return;
        }

        if (!clientId) {
            errMSG('[Sage/Discord] Client id missing, skipping slash command registration.');
            return;
        }

        try {
            await client.application?.commands?.set?.(definitions, guildId);
            log(`[Sage/Discord] Registered ${definitions.length} slash command(s) for guild ${guildId}.`);
        } catch (error) {
            errMSG(`[Sage/Discord] Failed to register slash commands: ${error.message}`);
            throw error;
        }
    };

    const login = async () => {
        try {
            await client.login(token);
            await ready;
            await registerCommands();
        } catch (error) {
            errMSG(`[Sage/Discord] Failed to login: ${error.message}`);
            readyReject?.(error);
            throw error;
        }

        return client;
    };

    const fetchGuild = async () => {
        await ready;
        return client.guilds.fetch(guildId);
    };

    const fetchMember = async (memberId) => {
        const guild = await fetchGuild();
        return guild.members.fetch(memberId);
    };

    const assignDefaultRole = async (memberId) => {
        if (!defaultRoleId) {
            return null;
        }

        try {
            const member = await fetchMember(memberId);
            if (member.roles.cache.has(defaultRoleId)) {
                return member;
            }

            await member.roles.add(defaultRoleId);
            log(`[Sage/Discord] Added default role ${defaultRoleId} to member ${member.user.tag}`);
            return member;
        } catch (error) {
            errMSG(`[Sage/Discord] Failed to assign default role to ${memberId}: ${error.message}`);
            throw error;
        }
    };

    const destroy = () => {
        client.destroy();
    };

    return {
        client,
        login,
        destroy,
        fetchGuild,
        fetchMember,
        assignDefaultRole,
        waitUntilReady: () => ready,
    };
};

export default createDiscordClient;
