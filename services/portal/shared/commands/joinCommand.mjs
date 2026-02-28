import {ApplicationCommandOptionType} from 'discord.js';
import {errMSG} from '../../../../utilities/etc/logger.mjs';
import {assignDefaultRole, ensureArray, resolveDiscordId, respondWithError} from './utils.mjs';

export const createJoinCommand = ({
                                      discord,
                                      getDiscord,
                                      kavita,
                                      vault,
                                      onboardingStore,
                                  } = {}) => ({
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
        await interaction.deferReply?.({ephemeral: true});

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

        await kavita.createOrUpdateUser({username, email, password, displayName, libraries});

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

export default createJoinCommand;

