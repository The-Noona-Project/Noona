// services/portal/shared/discordClient.mjs

import {
    Client,
    Events,
    GatewayIntentBits,
    Partials,
} from 'discord.js';
import { errMSG, log } from '../../../utilities/etc/logger.mjs';
import createRoleManager from './roleManager.mjs';

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
        throw new Error('Discord token is required to initialise the Portal Discord client.');
    }

    if (!guildId) {
        throw new Error('Discord guild id is required to initialise the Portal Discord client.');
    }

    const commandMap = normaliseCommandMap(commands);

    const client = typeof clientFactory === 'function'
        ? clientFactory({ intents, partials })
        : new Client({ intents, partials });

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

    const registerCommands = async () => {
        const definitions = extractCommandDefinitions(commandMap);
        if (!definitions.length) {
            return;
        }

        if (!clientId) {
            errMSG('[Portal/Discord] Client id missing, skipping slash command registration.');
            return;
        }

        try {
            await client.application?.commands?.set?.(definitions, guildId);
            log(`[Portal/Discord] Registered ${definitions.length} slash command(s) for guild ${guildId}.`);
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to register slash commands: ${error.message}`);
            throw error;
        }
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
            log(`[Portal/Discord] Added default role ${defaultRoleId} to member ${member.user.tag}`);
            return member;
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to assign default role to ${memberId}: ${error.message}`);
            throw error;
        }
    };

    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction?.isChatInputCommand?.()) {
            return;
        }

        const handler = commandMap.get(interaction.commandName);
        if (!handler?.execute) {
            return;
        }

        try {
            const access = roleManager.checkAccess(interaction, interaction.commandName);
            if (!access.allowed) {
                const actor = interaction?.user?.tag
                    ?? interaction?.user?.id
                    ?? interaction?.member?.user?.tag
                    ?? interaction?.member?.user?.id
                    ?? 'unknown user';

                log(`[Portal/Discord] Denied /${interaction.commandName} for ${actor} (${access.reason ?? 'unknown reason'}).`);

                const deniedPayload = { content: access.message ?? 'You do not have permission to use this command.', ephemeral: true };

                try {
                    if (interaction.deferred || interaction.replied) {
                        await interaction.editReply?.(deniedPayload);
                    } else {
                        await interaction.reply?.(deniedPayload);
                    }
                } catch (responseError) {
                    errMSG(`[Portal/Discord] Failed to send permission denial: ${responseError.message}`);
                }

                return;
            }

            await handler.execute(interaction);
        } catch (error) {
            errMSG(`[Portal/Discord] Handler for /${interaction.commandName} failed: ${error.message}`);

            const fallbackResponse = { content: 'Something went wrong while processing that command.', ephemeral: true };

            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply?.(fallbackResponse);
                } else {
                    await interaction.reply?.(fallbackResponse);
                }
            } catch (responseError) {
                errMSG(`[Portal/Discord] Failed to send error response: ${responseError.message}`);
            }
        }
    });

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
