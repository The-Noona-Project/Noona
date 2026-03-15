/**
 * @fileoverview Provides shared Discord command helpers for identity, errors, and default role assignment.
 * Related files:
 * - commands/recommendCommand.mjs
 * - commands/subscribeCommand.mjs
 * - discord/client.mjs
 * - commands/scanCommand.mjs
 * Times this file has been edited: 3
 */

import {MessageFlags} from 'discord.js';

/**
 * Ensures array.
 *
 * @param {*} value - Input passed to the function.
 * @returns {*} The function result.
 */
export const ensureArray = (value) => {
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

/**
 * Resolves a Discord user id from an interaction payload.
 *
 * @param {*} interaction - Input passed to the function.
 * @returns {*} The function result.
 */
export const resolveDiscordId = interaction => interaction?.user?.id
    ?? interaction?.member?.user?.id
    ?? interaction?.member?.id
    ?? null;

/**
 * Normalizes discord id candidate.
 *
 * @param {*} value - Input passed to the function.
 * @returns {*} The function result.
 */
export const normalizeDiscordIdCandidate = (value) => {
    if (!value || typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const digits = trimmed.replace(/\D/g, '');
    if (!digits) {
        return null;
    }

    return digits;
};

/**
 * Sends a consistent error response for a Discord interaction.
 *
 * @param {*} interaction - Input passed to the function.
 * @param {*} message - Input passed to the function.
 * @returns {Promise<*>} The asynchronous result.
 */
export const respondWithError = async (interaction, message) => {
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply?.({content: message});
        return;
    }

    await interaction.reply?.({
        content: message,
        flags: MessageFlags.Ephemeral,
    });
};

const resolveDiscordClient = (discord, getDiscord) => discord ?? getDiscord?.() ?? null;

/**
 * Assigns Portal's default Discord role to the supplied user.
 *
 * @param {*} discord - Input passed to the function.
 * @param {*} getDiscord - Input passed to the function.
 * @param {*} discordId - Input passed to the function.
 * @returns {Promise<*>} The asynchronous result.
 */
export const assignDefaultRole = async (discord, getDiscord, discordId) => {
    const client = resolveDiscordClient(discord, getDiscord);
    if (!client?.assignDefaultRole) {
        return;
    }

    await client.assignDefaultRole(discordId);
};
