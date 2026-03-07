import {Client, Events, GatewayIntentBits, Partials,} from 'discord.js';
import {errMSG, log} from '../../../utilities/etc/logger.mjs';
import createRoleManager from './roleManager.mjs';
import {extractCommandDefinitions, normalizeCommandMap} from './commandCatalog.mjs';
import {syncGuildCommands} from './commandSynchronizer.mjs';
import {createInteractionHandler} from './interactionRouter.mjs';

const DEFAULT_INTENTS = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
];

const DEFAULT_PARTIALS = [
    Partials.GuildMember,
    Partials.User,
];

export const createDiscordClient = ({
                                        token,
                                        guildId,
                                        clientId,
                                        defaultRoleId = null,
                                        intents = DEFAULT_INTENTS,
                                        partials = DEFAULT_PARTIALS,
                                        commands,
                                        clientFactory,
                                        clearGlobalCommandsOnBoot = true,
                                        clearCommandsOnBoot = true,
                                    } = {}) => {
    if (!token) {
        throw new Error('Discord token is required to initialise the Portal Discord client.');
    }

    if (!guildId) {
        throw new Error('Discord guild id is required to initialise the Portal Discord client.');
    }

    const commandMap = normalizeCommandMap(commands);
    const client = typeof clientFactory === 'function'
        ? clientFactory({intents, partials})
        : new Client({intents, partials});

    const roleManager = createRoleManager();

    let readyResolve;
    let readyReject;
    const ready = new Promise((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
    });

    client.once(Events.ClientReady, bot => {
        log(`[Portal/Discord] Logged in as ${bot?.user?.tag ?? 'unknown user'}`);
        readyResolve(bot ?? client);
    });

    client.on('error', error => {
        errMSG(`[Portal/Discord] Client error: ${error.message}`);
    });

    client.on('shardError', error => {
        errMSG(`[Portal/Discord] Shard error: ${error.message}`);
    });

    const interactionHandler = createInteractionHandler({
        commandMap,
        roleManager,
    });

    client.on(Events.InteractionCreate, interactionHandler);

    const registerCommands = async () => {
        if (!clientId) {
            errMSG('[Portal/Discord] Client id missing, skipping slash command registration.');
            return;
        }

        const definitions = extractCommandDefinitions(commandMap);

        await syncGuildCommands({
            commandManager: client.application?.commands,
            guildId,
            definitions,
            clearGlobalBeforeRegister: clearGlobalCommandsOnBoot,
            clearBeforeRegister: clearCommandsOnBoot,
        });
    };

    const login = async () => {
        try {
            await client.login(token);
            await ready;
            await registerCommands();
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to login: ${error.message}`);
            readyReject?.(error);
            throw error;
        }

        return client;
    };

    const fetchGuild = async () => {
        await ready;
        return client.guilds.fetch(guildId);
    };

    const fetchMember = async memberId => {
        const guild = await fetchGuild();
        return guild.members.fetch(memberId);
    };

    const assignDefaultRole = async memberId => {
        if (!defaultRoleId) {
            return null;
        }

        try {
            const member = await fetchMember(memberId);
            if (member.roles.cache.has(defaultRoleId)) {
                return member;
            }

            await member.roles.add(defaultRoleId);
            log(`[Portal/Discord] Added default role ${defaultRoleId} to member ${member.user.tag}`);
            return member;
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to assign default role to ${memberId}: ${error.message}`);
            throw error;
        }
    };

    const sendDirectMessage = async (userId, payload) => {
        const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
        if (!normalizedUserId) {
            throw new Error('Discord user id is required to send a direct message.');
        }

        const contentPayload = typeof payload === 'string' ? {content: payload} : payload;
        if (!contentPayload || typeof contentPayload !== 'object') {
            throw new Error('Direct message payload must be a string or object.');
        }

        if (typeof client.users?.fetch !== 'function') {
            throw new Error('Discord user client is not available.');
        }

        try {
            const user = await client.users.fetch(normalizedUserId);
            if (!user || typeof user.send !== 'function') {
                throw new Error('Discord user could not receive direct messages.');
            }

            return await user.send(contentPayload);
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to send direct message to ${normalizedUserId}: ${error.message}`);
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
        sendDirectMessage,
        waitUntilReady: () => ready,
    };
};

export default createDiscordClient;
