/**
 * @fileoverview Routes Discord interactions to slash-command, autocomplete, and button handlers.
 * Related files:
 * - commands/index.mjs
 * - discord/client.mjs
 * - tests/discordCommands.test.mjs
 * Times this file has been edited: 5
 */

import {MessageFlags} from 'discord.js';
import {errMSG, log} from '../../../utilities/etc/logger.mjs';

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');

const sendInteractionReply = async (interaction, payload) => {
    const isEphemeral = payload && typeof payload === 'object' && payload.ephemeral === true;
    const normalizedReplyPayload = isEphemeral
        ? (({ephemeral, ...rest}) => ({
            ...rest,
            flags: MessageFlags.Ephemeral,
        }))(payload)
        : payload;
    const normalizedEditPayload =
        payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'ephemeral')
            ? (({ephemeral, ...rest}) => rest)(payload)
            : payload;

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply?.(normalizedEditPayload);
        return;
    }

    await interaction.reply?.(normalizedReplyPayload);
};

const resolveActor = interaction =>
    interaction?.user?.tag
    ?? interaction?.user?.id
    ?? interaction?.member?.user?.tag
    ?? interaction?.member?.user?.id
    ?? 'unknown user';

/**
 * Creates interaction handler.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const createInteractionHandler = ({
                                             commandMap,
                                             roleManager,
                                         } = {}) => async interaction => {
    const commandName = interaction?.commandName;
    const handler = commandMap?.get(commandName);

    if (interaction?.isAutocomplete?.()) {
        if (!handler?.autocomplete) {
            return;
        }

        try {
            const access = roleManager?.checkAccess?.(interaction, commandName) ?? {allowed: true};
            if (!access.allowed) {
                await interaction.respond?.([]);
                return;
            }

            await handler.autocomplete(interaction);
        } catch (error) {
            errMSG(`[Portal/Discord] Autocomplete for /${commandName} failed: ${error.message}`);
            await interaction.respond?.([]).catch(responseError => {
                errMSG(`[Portal/Discord] Failed to send autocomplete fallback: ${responseError.message}`);
            });
        }

        return;
    }

    if (interaction?.isButton?.()) {
        for (const [commandName, handler] of commandMap?.entries?.() ?? []) {
            if (typeof handler?.handleComponent !== 'function') {
                continue;
            }

            try {
                const handled = await handler.handleComponent(interaction);
                if (handled) {
                    return;
                }
            } catch (error) {
                errMSG(`[Portal/Discord] Component handler for /${commandName} failed: ${error.message}`);
                await sendInteractionReply(interaction, {
                    content: 'Something went wrong while processing that button.',
                    ephemeral: true,
                    components: [],
                }).catch(responseError => {
                    errMSG(`[Portal/Discord] Failed to send component error response: ${responseError.message}`);
                });
                return;
            }
        }

        return;
    }

    if (!interaction?.isChatInputCommand?.()) {
        return;
    }

    if (!handler?.execute) {
        const safeCommandName = normalizeString(commandName) || 'this';
        errMSG(`[Portal/Discord] Missing handler for /${safeCommandName}.`);
        await sendInteractionReply(interaction, {
            content: `/${safeCommandName} is not available right now. Please try again in a moment.`,
            ephemeral: true,
        }).catch(responseError => {
            errMSG(`[Portal/Discord] Failed to send unavailable-command response: ${responseError.message}`);
        });
        return;
    }

    try {
        const access = roleManager?.checkAccess?.(interaction, interaction.commandName) ?? {allowed: true};
        if (!access.allowed) {
            const actor = resolveActor(interaction);
            log(`[Portal/Discord] Denied /${commandName} for ${actor} (${access.reason ?? 'unknown reason'}).`);

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
        errMSG(`[Portal/Discord] Handler for /${commandName} failed: ${error.message}`);

        await sendInteractionReply(interaction, {
            content: 'Something went wrong while processing that command.',
            ephemeral: true,
        }).catch(responseError => {
            errMSG(`[Portal/Discord] Failed to send error response: ${responseError.message}`);
        });
    }
};
