import {MessageFlags} from 'discord.js';

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

export const resolveDiscordId = interaction => interaction?.user?.id
    ?? interaction?.member?.user?.id
    ?? interaction?.member?.id
    ?? null;

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

export const assignDefaultRole = async (discord, getDiscord, discordId) => {
    const client = resolveDiscordClient(discord, getDiscord);
    if (!client?.assignDefaultRole) {
        return;
    }

    await client.assignDefaultRole(discordId);
};
