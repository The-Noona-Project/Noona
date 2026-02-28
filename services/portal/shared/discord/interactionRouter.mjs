import {errMSG, log} from '../../../../utilities/etc/logger.mjs';

const sendInteractionReply = async (interaction, payload) => {
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply?.(payload);
        return;
    }

    await interaction.reply?.(payload);
};

const resolveActor = interaction =>
    interaction?.user?.tag
    ?? interaction?.user?.id
    ?? interaction?.member?.user?.tag
    ?? interaction?.member?.user?.id
    ?? 'unknown user';

export const createInteractionHandler = ({
                                             commandMap,
                                             roleManager,
                                         } = {}) => async interaction => {
    if (!interaction?.isChatInputCommand?.()) {
        return;
    }

    const handler = commandMap?.get(interaction.commandName);
    if (!handler?.execute) {
        return;
    }

    try {
        const access = roleManager?.checkAccess?.(interaction, interaction.commandName) ?? {allowed: true};
        if (!access.allowed) {
            const actor = resolveActor(interaction);
            log(`[Portal/Discord] Denied /${interaction.commandName} for ${actor} (${access.reason ?? 'unknown reason'}).`);

            await sendInteractionReply(interaction, {
                content: access.message ?? 'You do not have permission to use this command.',
                ephemeral: true,
            }).catch(responseError => {
                errMSG(`[Portal/Discord] Failed to send permission denial: ${responseError.message}`);
            });

            return;
        }

        await handler.execute(interaction);
    } catch (error) {
        errMSG(`[Portal/Discord] Handler for /${interaction.commandName} failed: ${error.message}`);

        await sendInteractionReply(interaction, {
            content: 'Something went wrong while processing that command.',
            ephemeral: true,
        }).catch(responseError => {
            errMSG(`[Portal/Discord] Failed to send error response: ${responseError.message}`);
        });
    }
};

