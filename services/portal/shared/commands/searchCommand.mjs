import {ApplicationCommandOptionType} from 'discord.js';
import {errMSG} from '../../../../utilities/etc/logger.mjs';
import {normalizeDiscordIdCandidate, respondWithError} from './utils.mjs';

export const createSearchCommand = ({
                                        kavita,
                                        vault,
                                    } = {}) => ({
    definition: {
        name: 'search',
        description: 'Fetch details for a Kavita user or stored credential.',
        options: [
            {
                name: 'username',
                description: 'Kavita username to look up.',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
            {
                name: 'discord_id',
                description: 'Discord identifier/mention to fetch stored credentials.',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
    },
    execute: async interaction => {
        await interaction.deferReply?.({ephemeral: true});

        if (!kavita?.fetchUser) {
            throw new Error('Kavita client is not configured for search.');
        }

        const usernameRaw = interaction.options?.getString('username') ?? null;
        const username = typeof usernameRaw === 'string' ? usernameRaw.trim() : '';
        const discordIdRaw = interaction.options?.getString('discord_id') ?? null;
        const discordId = normalizeDiscordIdCandidate(discordIdRaw);

        if (!username && !discordId) {
            await respondWithError(interaction, 'Provide a Kavita username or a Discord id to search.');
            return;
        }

        let user = null;
        if (username) {
            try {
                user = await kavita.fetchUser(username);
            } catch (error) {
                const status = error && typeof error === 'object' ? error.status : null;
                if (status === 404) {
                    user = null;
                } else {
                    errMSG(`[Portal/Discord] Kavita search failed: ${error.message}`);
                    throw error;
                }
            }
        }

        let credential = null;
        if (discordId && vault?.readSecret) {
            try {
                credential = await vault.readSecret(`portal/${discordId}`);
            } catch (error) {
                errMSG(`[Portal/Discord] Failed to read credential for ${discordId}: ${error.message}`);
            }
        }

        if (!user && credential && credential.username) {
            try {
                user = await kavita.fetchUser(String(credential.username));
            } catch (error) {
                const status = error && typeof error === 'object' ? error.status : null;
                if (status !== 404) {
                    errMSG(`[Portal/Discord] Kavita credential lookup failed: ${error.message}`);
                }
            }
        }

        const details = [];
        if (user) {
            const resolvedName = user.username ?? (username || String(credential?.username ?? ''));
            details.push(`Kavita user **${resolvedName}** found.`);
            if (Array.isArray(user.libraries) && user.libraries.length) {
                details.push(`Libraries: ${user.libraries.join(', ')}`);
            }
        } else if (username) {
            details.push(`No Kavita user found for **${username}**.`);
        } else {
            details.push('No Kavita user record was found.');
        }

        if (credential) {
            const libraries = Array.isArray(credential.libraries) ? credential.libraries.join(', ') : 'n/a';
            details.push(`Stored credential email: ${credential.email ?? 'n/a'} (libraries: ${libraries}).`);
        } else if (discordId && vault?.readSecret) {
            details.push('No stored credential found.');
        }

        await interaction.editReply?.({
            content: details.join('\n'),
            ephemeral: true,
        });
    },
});

export default createSearchCommand;

