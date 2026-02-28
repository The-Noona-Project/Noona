import {ApplicationCommandOptionType} from 'discord.js';
import {errMSG} from '../../../../utilities/etc/logger.mjs';
import {assignDefaultRole, resolveDiscordId, respondWithError} from './utils.mjs';

const normalizeValue = value => (typeof value === 'string' ? value.trim() : '');

const formatList = values => {
    if (!Array.isArray(values) || values.length === 0) {
        return 'none';
    }

    return values.join(', ');
};

export const createJoinCommand = ({
                                      discord,
                                      getDiscord,
                                      kavita,
                                      vault,
                                      joinDefaults,
                                  } = {}) => ({
    definition: {
        name: 'join',
        description: 'Create a Kavita account with the configured default access.',
        options: [
            {
                name: 'username',
                description: 'Username to create in Kavita.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'password',
                description: 'Password for the new Kavita account.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'confirm_password',
                description: 'Repeat the password to confirm it.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'email',
                description: 'Email address for the Kavita account.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    execute: async interaction => {
        await interaction.deferReply?.({ephemeral: true});

        if (!kavita?.createUser) {
            throw new Error('Onboarding dependencies are not configured.');
        }

        const discordId = resolveDiscordId(interaction);
        if (!discordId) {
            await respondWithError(interaction, 'Unable to determine Discord user for onboarding.');
            return;
        }

        const username = normalizeValue(interaction.options?.getString('username', true));
        const password = interaction.options?.getString('password', true) ?? '';
        const confirmPassword = interaction.options?.getString('confirm_password', true) ?? '';
        const email = normalizeValue(interaction.options?.getString('email', true));

        if (!username || !email || !password || !confirmPassword) {
            await respondWithError(interaction, 'Provide a username, password, confirm password, and email.');
            return;
        }

        if (password !== confirmPassword) {
            await respondWithError(interaction, 'Password and confirm password must match.');
            return;
        }

        const roles = Array.isArray(joinDefaults?.defaultRoles) ? joinDefaults.defaultRoles : [];
        const libraries = Array.isArray(joinDefaults?.defaultLibraries) ? joinDefaults.defaultLibraries : [];

        let createdUser;
        try {
            createdUser = await kavita.createUser({
                username,
                email,
                password,
                roles,
                libraries,
            });
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to create Kavita user via /join: ${error.message}`);

            if ((error?.status ?? 500) < 500) {
                await respondWithError(interaction, error.message);
                return;
            }

            throw error;
        }

        if (vault?.storePortalCredential) {
            try {
                await vault.storePortalCredential(discordId, {
                    username: createdUser.username,
                    email: createdUser.email,
                    roles: createdUser.roles,
                    libraries: createdUser.libraries,
                    issuedAt: new Date().toISOString(),
                });
            } catch (error) {
                errMSG(`[Portal/Discord] Failed to write credential for ${discordId}: ${error.message}`);
            }
        }

        await assignDefaultRole(discord, getDiscord, discordId).catch(error => {
            errMSG(`[Portal/Discord] Failed to assign default role via /join: ${error.message}`);
        });

        const librarySummary = libraries.length > 0 ? libraries : createdUser.libraries;
        await interaction.editReply?.({
            content: [
                `Created Kavita account **${createdUser.username}**.`,
                `Roles: ${formatList(createdUser.roles)}.`,
                `Libraries: ${formatList(librarySummary)}.`,
            ].join(' '),
            ephemeral: true,
        });
    },
});

export default createJoinCommand;
