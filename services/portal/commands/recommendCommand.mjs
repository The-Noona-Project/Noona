import crypto from 'node:crypto';
import {ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle,} from 'discord.js';
import {errMSG} from '../../../utilities/etc/logger.mjs';
import {resolveDiscordId, respondWithError} from './utils.mjs';

const MAX_VISIBLE_RESULTS = 5;
const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_PREFIX = 'recommend';
const TITLE_LIMIT = 72;

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');
const truncate = (value, maxLength = TITLE_LIMIT) =>
    value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 1)).trim()}…` : value;

const parseOptionIndex = (option, fallbackIndex) => {
    const raw = normalizeString(option?.option_number ?? option?.index);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackIndex;
};

const normalizeSearchOptions = (options = []) => Array.isArray(options)
    ? options
        .map((option, idx) => {
            const title = normalizeString(option?.title);
            const href = normalizeString(option?.href);
            const optionIndex = parseOptionIndex(option, idx + 1);
            if (!title) {
                return null;
            }

            return {
                slot: idx,
                optionIndex,
                title,
                href,
            };
        })
        .filter(Boolean)
    : [];

const buildRecommendationSummary = (query, options) => [
    `Select the Raven match to recommend for "${query}":`,
    ...options.map((option, idx) => `${idx + 1}. ${truncate(option.title)}${option.href ? ` | ${option.href}` : ''}`),
    'This selection expires in 10 minutes.',
].join('\n');

const createSessionId = () => crypto.randomBytes(6).toString('hex');

const selectCustomId = (sessionId, slot) => `${SESSION_PREFIX}:select:${sessionId}:${slot}`;
const cancelCustomId = sessionId => `${SESSION_PREFIX}:cancel:${sessionId}`;

const buildComponents = (sessionId, options) => {
    const selectionRow = new ActionRowBuilder().addComponents(
        ...options.map((option, idx) =>
            new ButtonBuilder()
                .setCustomId(selectCustomId(sessionId, option.slot))
                .setLabel(String(idx + 1))
                .setStyle(ButtonStyle.Secondary),
        ),
    );

    const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(cancelCustomId(sessionId))
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger),
    );

    return [selectionRow, cancelRow];
};

const updateComponentReply = async (interaction, payload) => {
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply?.(payload);
        return;
    }

    if (typeof interaction.deferUpdate === 'function' && typeof interaction.editReply === 'function') {
        await interaction.deferUpdate();
        await interaction.editReply(payload);
        return;
    }

    if (typeof interaction.update === 'function') {
        await interaction.update(payload);
        return;
    }

    await interaction.reply?.({
        ...payload,
        ephemeral: true,
    });
};

const resolveUserTag = interaction =>
    normalizeString(interaction?.user?.tag)
    || normalizeString(interaction?.member?.user?.tag)
    || null;

export const createRecommendCommand = ({
                                           raven,
                                           vault,
                                           now = () => Date.now(),
                                           sessionTtlMs = SESSION_TTL_MS,
                                       } = {}) => {
    const pendingSessions = new Map();

    const cleanupExpiredSessions = () => {
        const currentTime = Number(now());
        for (const [sessionId, session] of pendingSessions.entries()) {
            if (!session || typeof session.expiresAt !== 'number' || session.expiresAt <= currentTime) {
                pendingSessions.delete(sessionId);
            }
        }
    };

    return {
        definition: {
            name: 'recommend',
            description: 'Recommend a new title from Raven search results.',
            options: [
                {
                    name: 'title',
                    description: 'Title to search for in Raven before saving a recommendation.',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        },
        execute: async interaction => {
            await interaction.deferReply?.({ephemeral: true});

            if (!raven?.searchTitle) {
                throw new Error('Raven client is not configured for recommendations.');
            }

            const query = normalizeString(interaction.options?.getString('title') ?? null);
            if (!query) {
                await respondWithError(interaction, 'Provide a title to recommend.');
                return;
            }

            cleanupExpiredSessions();

            let searchResult;
            try {
                searchResult = await raven.searchTitle(query);
            } catch (error) {
                errMSG(`[Portal/Discord] Raven title search failed for recommendation "${query}": ${error.message}`);
                throw error;
            }

            const options = normalizeSearchOptions(searchResult?.options).slice(0, MAX_VISIBLE_RESULTS);
            if (!options.length) {
                await interaction.editReply?.({
                    content: `No Raven titles found for "${query}".`,
                    components: [],
                });
                return;
            }

            const sessionId = createSessionId();
            pendingSessions.set(sessionId, {
                sessionId,
                createdAt: Number(now()),
                expiresAt: Number(now()) + sessionTtlMs,
                requestedById: resolveDiscordId(interaction),
                requestedByTag: resolveUserTag(interaction),
                query,
                searchId: normalizeString(searchResult?.searchId) || null,
                options,
                guildId: normalizeString(interaction?.guildId) || null,
                channelId: normalizeString(interaction?.channelId) || null,
            });

            await interaction.editReply?.({
                content: buildRecommendationSummary(query, options),
                components: buildComponents(sessionId, options),
            });
        },
        handleComponent: async interaction => {
            const customId = normalizeString(interaction?.customId);
            if (!customId.startsWith(`${SESSION_PREFIX}:`)) {
                return false;
            }

            cleanupExpiredSessions();

            const [, action, sessionId, slotRaw] = customId.split(':');
            if (!sessionId) {
                await updateComponentReply(interaction, {
                    content: 'This recommendation prompt is invalid. Run `/recommend` again.',
                    components: [],
                });
                return true;
            }

            const session = pendingSessions.get(sessionId);
            if (!session || session.expiresAt <= Number(now())) {
                pendingSessions.delete(sessionId);
                await updateComponentReply(interaction, {
                    content: 'This recommendation prompt expired. Run `/recommend` again.',
                    components: [],
                });
                return true;
            }

            const actorId = resolveDiscordId(interaction);
            if (session.requestedById && actorId && session.requestedById !== actorId) {
                await interaction.reply?.({
                    content: 'Only the user who started this recommendation can confirm it.',
                    ephemeral: true,
                });
                return true;
            }

            if (action === 'cancel') {
                pendingSessions.delete(sessionId);
                await updateComponentReply(interaction, {
                    content: `Recommendation cancelled for "${session.query}".`,
                    components: [],
                });
                return true;
            }

            if (action !== 'select') {
                return false;
            }

            const slot = Number.parseInt(String(slotRaw), 10);
            const selected = session.options.find(option => option.slot === slot) ?? null;
            if (!selected) {
                await updateComponentReply(interaction, {
                    content: 'That recommendation option is no longer available. Run `/recommend` again.',
                    components: [],
                });
                pendingSessions.delete(sessionId);
                return true;
            }

            if (!vault?.storeRecommendation) {
                throw new Error('Vault client is not configured for recommendations.');
            }

            const requestedAtIso = new Date(Number(now())).toISOString();
            const recommendation = {
                source: 'discord',
                status: 'pending',
                requestedAt: requestedAtIso,
                query: session.query,
                searchId: session.searchId,
                selectedOptionIndex: selected.optionIndex,
                title: selected.title,
                href: selected.href || null,
                requestedBy: {
                    discordId: session.requestedById,
                    tag: session.requestedByTag,
                },
                discordContext: {
                    guildId: session.guildId,
                    channelId: session.channelId,
                },
            };

            try {
                const result = await vault.storeRecommendation(recommendation);
                pendingSessions.delete(sessionId);
                const insertedId = result?.insertedId != null ? ` (id: ${result.insertedId})` : '';
                await updateComponentReply(interaction, {
                    content: `Saved recommendation for **${selected.title}**${insertedId}.`,
                    components: [],
                });
            } catch (error) {
                errMSG(`[Portal/Discord] Failed to store recommendation "${selected.title}": ${error.message}`);
                await updateComponentReply(interaction, {
                    content: `Failed to save recommendation for **${selected.title}**. Try again.`,
                    components: buildComponents(sessionId, session.options),
                });
            }

            return true;
        },
    };
};

export default createRecommendCommand;
