// services/portal/shared/discordCommands.mjs

import { ApplicationCommandOptionType } from 'discord.js';
import { errMSG, log } from '../../../utilities/etc/logger.mjs';

const ensureArray = (value) => {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value.filter(item => item != null && item !== '');
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map(entry => entry.trim())
            .filter(Boolean);
    }

    return [value];
};

const resolveDiscordId = interaction => interaction?.user?.id
    ?? interaction?.member?.user?.id
    ?? interaction?.member?.id
    ?? null;

const respondWithError = async (interaction, message) => {
    const payload = { content: message, ephemeral: true };

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply?.(payload);
        return;
    }

    await interaction.reply?.(payload);
};

const resolveDiscordClient = (discord, getDiscord) => discord ?? getDiscord?.() ?? null;

const assignDefaultRole = async (discord, getDiscord, discordId) => {
    const client = resolveDiscordClient(discord, getDiscord);
    if (!client?.assignDefaultRole) {
        return;
    }

    await client.assignDefaultRole(discordId);
};

export const createPortalSlashCommands = ({
    discord,
    getDiscord,
    kavita,
    vault,
    onboardingStore,
} = {}) => {
    const commands = new Map();

    commands.set('ding', {
        definition: {
            name: 'ding',
            description: 'Check if the Noona Portal bot is awake.',
        },
        execute: async interaction => {
            await interaction.reply?.({ content: 'Dong! Portal is online.', ephemeral: true });
        },
    });

    commands.set('join', {
        definition: {
            name: 'join',
            description: 'Onboard a Discord member into the Noona library.',
            options: [
                {
                    name: 'email',
                    description: 'Email address for the member.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: 'username',
                    description: 'Desired Kavita username.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: 'password',
                    description: 'Optional password for the Kavita account.',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'display_name',
                    description: 'Friendly display name for Kavita.',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'libraries',
                    description: 'Comma-separated list of library identifiers.',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        },
        execute: async interaction => {
            await interaction.deferReply?.({ ephemeral: true });

            if (!kavita?.createOrUpdateUser || !onboardingStore?.setToken) {
                throw new Error('Onboarding dependencies are not configured.');
            }

            const discordId = resolveDiscordId(interaction);
            if (!discordId) {
                await respondWithError(interaction, 'Unable to determine Discord user for onboarding.');
                return;
            }

            const email = interaction.options?.getString('email', true);
            const username = interaction.options?.getString('username', true);
            const password = interaction.options?.getString('password') ?? undefined;
            const displayName = interaction.options?.getString('display_name') ?? undefined;
            const libraries = ensureArray(interaction.options?.getString('libraries'));

            await kavita.createOrUpdateUser({ username, email, password, displayName, libraries });

            const onboardingRecord = await onboardingStore.setToken(discordId, {
                email,
                username,
                libraries,
            });

            if (vault?.storePortalCredential) {
                try {
                    await vault.storePortalCredential(discordId, {
                        username,
                        email,
                        libraries,
                        issuedAt: new Date().toISOString(),
                    });
                } catch (error) {
                    errMSG(`[Portal/Discord] Failed to write credential for ${discordId}: ${error.message}`);
                }
            }

            await assignDefaultRole(discord, getDiscord, discordId).catch(error => {
                errMSG(`[Portal/Discord] Failed to assign default role via /join: ${error.message}`);
            });

            await interaction.editReply?.({
                content: `Onboarding token for ${username}: \`${onboardingRecord?.token}\`.`,
            });
        },
    });

    commands.set('scan', {
        definition: {
            name: 'scan',
            description: 'List Kavita libraries available for onboarding.',
        },
        execute: async interaction => {
            await interaction.deferReply?.({ ephemeral: true });

            if (!kavita?.fetchLibraries) {
                throw new Error('Kavita client is not configured.');
            }

            const libraries = await kavita.fetchLibraries();
            if (!libraries?.length) {
                await interaction.editReply?.({ content: 'No Kavita libraries were found.' });
                return;
            }

            const summary = libraries
                .map(library => library?.name ?? library?.title ?? String(library?.id ?? 'unknown'))
                .join(', ');

            await interaction.editReply?.({ content: `Kavita libraries: ${summary}` });
        },
    });

    commands.set('search', {
        definition: {
            name: 'search',
            description: 'Fetch details for a Kavita user or stored credential.',
            options: [
                {
                    name: 'username',
                    description: 'Kavita username to look up.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
                {
                    name: 'discord_id',
                    description: 'Optional Discord identifier to fetch stored credentials.',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        },
        execute: async interaction => {
            await interaction.deferReply?.({ ephemeral: true });

            if (!kavita?.fetchUser) {
                throw new Error('Kavita client is not configured for search.');
            }

            const username = interaction.options?.getString('username', true);
            const discordId = interaction.options?.getString('discord_id') ?? null;

            const user = await kavita.fetchUser(username).catch(error => {
                errMSG(`[Portal/Discord] Kavita search failed: ${error.message}`);
                throw error;
            });

            let credential = null;
            if (discordId && vault?.readSecret) {
                try {
                    credential = await vault.readSecret(`portal/${discordId}`);
                } catch (error) {
                    errMSG(`[Portal/Discord] Failed to read credential for ${discordId}: ${error.message}`);
                }
            }

            const payload = {
                content: 'Search complete.',
                ephemeral: true,
            };

            const details = [];
            if (user) {
                details.push(`Kavita user **${user.username ?? username}** found.`);
                if (Array.isArray(user.libraries) && user.libraries.length) {
                    details.push(`Libraries: ${user.libraries.join(', ')}`);
                }
            } else {
                details.push(`No Kavita user found for **${username}**.`);
            }

            if (credential) {
                const libraries = Array.isArray(credential.libraries) ? credential.libraries.join(', ') : 'n/a';
                details.push(`Stored credential email: ${credential.email ?? 'n/a'} (libraries: ${libraries}).`);
            } else if (discordId && vault?.readSecret) {
                details.push('No stored credential found.');
            }

            payload.content = details.join('\n');

            await interaction.editReply?.(payload);
        },
    });

    log(`[Portal/Discord] Prepared ${commands.size} slash command handler(s).`);

    return commands;
};

export default createPortalSlashCommands;
