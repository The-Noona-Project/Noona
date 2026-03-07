import crypto from 'node:crypto';
import {ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle,} from 'discord.js';
import {errMSG} from '../../../utilities/etc/logger.mjs';
import {resolveDiscordId, respondWithError} from './utils.mjs';

const MAX_VISIBLE_RESULTS = 5;
const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_PREFIX = 'recommend';
const TITLE_LIMIT = 72;
const MOON_SERVICE_NAMES = new Set(['noona-moon', 'moon']);
const DEFAULT_MOON_RECOMMENDATION_PATH_PREFIX = '/myrecommendations/';

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');
const normalizeTitleKey = value => normalizeString(value).toLowerCase().replace(/\s+/g, ' ').trim();
const normalizeSeriesInteger = value => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const normalizeUrlForCompare = value => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return null;
    }

    try {
        const parsed = new URL(normalized);
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return null;
    }
};
const normalizeAbsoluteUrl = value => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return null;
    }

    try {
        return new URL(normalized).toString();
    } catch {
        return null;
    }
};
const normalizeAbsoluteBaseUrl = value => {
    const normalized = normalizeAbsoluteUrl(value);
    if (!normalized) {
        return null;
    }

    try {
        const parsed = new URL(normalized);
        return `${parsed.protocol}//${parsed.host}/`;
    } catch {
        return null;
    }
};
const truncate = (value, maxLength = TITLE_LIMIT) =>
    value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 1)).trim()}…` : value;
const resolveRecommendationId = value => {
    if (typeof value === 'string' && value.trim()) {
        return value.trim();
    }

    if (!value || typeof value !== 'object') {
        return null;
    }

    if (typeof value.$oid === 'string' && value.$oid.trim()) {
        return value.$oid.trim();
    }

    if (typeof value.toHexString === 'function') {
        try {
            const hex = value.toHexString();
            if (typeof hex === 'string' && hex.trim()) {
                return hex.trim();
            }
        } catch {
            // Best effort fallback below.
        }
    }

    if (typeof value.toString === 'function') {
        const text = value.toString();
        if (typeof text === 'string' && text.trim() && text !== '[object Object]') {
            return text.trim();
        }
    }

    return null;
};
const extractWardenServiceList = payload => {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (Array.isArray(payload?.services)) {
        return payload.services;
    }

    return [];
};
const resolveMoonBaseUrlFromWardenPayload = payload => {
    const services = extractWardenServiceList(payload);
    for (const service of services) {
        const serviceName = normalizeString(service?.name).toLowerCase();
        if (!MOON_SERVICE_NAMES.has(serviceName)) {
            continue;
        }

        const candidates = [
            service?.hostServiceUrl,
            service?.host_service_url,
            service?.hostUrl,
            service?.host_url,
            service?.url,
        ];
        for (const candidate of candidates) {
            const baseUrl = normalizeAbsoluteBaseUrl(candidate);
            if (baseUrl) {
                return baseUrl;
            }
        }
    }

    return null;
};

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

const getLibraryTitleName = title =>
    normalizeString(title?.title ?? title?.titleName);

const pickPreferredKavitaSeries = (series, titleName) => {
    const titleKey = normalizeTitleKey(titleName);
    if (!titleKey) {
        return series[0] ?? null;
    }

    for (const entry of series) {
        const nameKey = normalizeTitleKey(entry?.name);
        if (nameKey && nameKey === titleKey) {
            return entry;
        }
    }

    for (const entry of series) {
        const localizedKey = normalizeTitleKey(entry?.localizedName);
        const originalKey = normalizeTitleKey(entry?.originalName);
        if (localizedKey === titleKey || originalKey === titleKey) {
            return entry;
        }
    }

    return series[0] ?? null;
};

const buildKavitaSeriesUrl = ({baseUrl, series, fallbackUrl} = {}) => {
    const libraryId = normalizeSeriesInteger(series?.libraryId);
    const seriesId = normalizeSeriesInteger(series?.seriesId);
    const normalizedBase = normalizeString(baseUrl);
    if (normalizedBase && libraryId != null && seriesId != null) {
        try {
            return new URL(`/library/${libraryId}/series/${seriesId}`, normalizedBase).toString();
        } catch {
            // Fall back to the provided URL below.
        }
    }

    const normalizedFallback = normalizeString(fallbackUrl);
    return normalizedFallback || null;
};

const resolveExistingLibraryTitle = async ({
                                               raven,
                                               selectedTitle,
                                               selectedHref,
                                           } = {}) => {
    if (!raven?.getLibrary) {
        return null;
    }

    const library = await raven.getLibrary();
    if (!Array.isArray(library) || library.length === 0) {
        return null;
    }

    const selectedHrefKey = normalizeUrlForCompare(selectedHref);
    if (selectedHrefKey) {
        const sourceMatch = library.find(entry => normalizeUrlForCompare(entry?.sourceUrl) === selectedHrefKey);
        if (sourceMatch) {
            return sourceMatch;
        }
    }

    const selectedTitleKey = normalizeTitleKey(selectedTitle);
    if (!selectedTitleKey) {
        return null;
    }

    return library.find(entry => normalizeTitleKey(getLibraryTitleName(entry)) === selectedTitleKey) ?? null;
};

const resolveKavitaTitleUrl = async ({
                                         kavita,
                                         titleName,
                                         kavitaBaseUrl,
                                     } = {}) => {
    const normalizedTitle = normalizeString(titleName);
    if (!normalizedTitle || !kavita?.searchTitles) {
        return null;
    }

    try {
        const payload = await kavita.searchTitles(normalizedTitle);
        const series = Array.isArray(payload?.series) ? payload.series : [];
        if (!series.length) {
            return null;
        }

        const selectedSeries = pickPreferredKavitaSeries(series, normalizedTitle);
        if (!selectedSeries) {
            return null;
        }

        return buildKavitaSeriesUrl({
            baseUrl: kavitaBaseUrl || (typeof kavita.getBaseUrl === 'function' ? kavita.getBaseUrl() : null),
            series: selectedSeries,
            fallbackUrl: selectedSeries?.url,
        });
    } catch (error) {
        errMSG(`[Portal/Discord] Failed to resolve Kavita link for "${normalizedTitle}": ${error.message}`);
        return null;
    }
};

export const createRecommendCommand = ({
                                           raven,
                                           kavita,
                                           vault,
                                           warden,
                                           moonBaseUrl,
                                           kavitaBaseUrl,
                                           now = () => Date.now(),
                                           sessionTtlMs = SESSION_TTL_MS,
                                       } = {}) => {
    const pendingSessions = new Map();
    const configuredMoonBaseUrl = normalizeAbsoluteBaseUrl(moonBaseUrl);
    const configuredKavitaBaseUrl = normalizeAbsoluteBaseUrl(kavitaBaseUrl);
    let cachedMoonBaseUrl = configuredMoonBaseUrl;

    const cleanupExpiredSessions = () => {
        const currentTime = Number(now());
        for (const [sessionId, session] of pendingSessions.entries()) {
            if (!session || typeof session.expiresAt !== 'number' || session.expiresAt <= currentTime) {
                pendingSessions.delete(sessionId);
            }
        }
    };
    const resolveMoonBaseUrl = async () => {
        if (cachedMoonBaseUrl) {
            return cachedMoonBaseUrl;
        }

        if (typeof warden?.listServices !== 'function') {
            return null;
        }

        const servicesPayload = await warden.listServices({includeInstalled: true}).catch((error) => {
            errMSG(`[Portal/Discord] Failed to resolve Moon URL from Warden for recommendation DM: ${error.message}`);
            return null;
        });
        const resolvedBaseUrl = resolveMoonBaseUrlFromWardenPayload(servicesPayload);
        if (resolvedBaseUrl) {
            cachedMoonBaseUrl = resolvedBaseUrl;
        }

        return resolvedBaseUrl;
    };
    const buildMoonRecommendationUrl = async (recommendationId) => {
        const normalizedId = resolveRecommendationId(recommendationId);
        if (!normalizedId) {
            return null;
        }

        const moonUrl = await resolveMoonBaseUrl();
        if (!moonUrl) {
            return null;
        }

        try {
            return new URL(`${DEFAULT_MOON_RECOMMENDATION_PATH_PREFIX}${encodeURIComponent(normalizedId)}`, moonUrl).toString();
        } catch {
            return null;
        }
    };
    const sendRecommendationReceiptDm = async ({interaction, title, recommendationId}) => {
        const discordUser = interaction?.user;
        if (!discordUser || typeof discordUser.send !== 'function') {
            return {sent: false, reason: 'Discord user DM channel is unavailable.'};
        }

        const moonRecommendationUrl = await buildMoonRecommendationUrl(recommendationId);
        const normalizedRecommendationId = resolveRecommendationId(recommendationId);
        const lines = [
            `Thanks for your recommendation for **${title}**.`,
            `I'll send you a message when it's approved or denied.`,
        ];
        if (moonRecommendationUrl) {
            lines.push(`Track it in Moon: ${moonRecommendationUrl}`);
        } else if (normalizedRecommendationId) {
            lines.push(`Track it in Moon: /myrecommendations/${encodeURIComponent(normalizedRecommendationId)}`);
        }

        try {
            await discordUser.send({content: lines.join('\n')});
            return {sent: true, moonRecommendationUrl};
        } catch (error) {
            errMSG(`[Portal/Discord] Failed to send initial recommendation DM for "${title}": ${error.message}`);
            return {sent: false, reason: error instanceof Error ? error.message : String(error), moonRecommendationUrl};
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

            let existingTitle = null;
            try {
                existingTitle = await resolveExistingLibraryTitle({
                    raven,
                    selectedTitle: selected.title,
                    selectedHref: selected.href,
                });
            } catch (error) {
                errMSG(`[Portal/Discord] Failed to verify existing library titles for "${selected.title}": ${error.message}`);
            }

            if (existingTitle) {
                pendingSessions.delete(sessionId);
                const existingTitleName = getLibraryTitleName(existingTitle) || selected.title;
                const kavitaUrl = await resolveKavitaTitleUrl({
                    kavita,
                    titleName: existingTitleName,
                    kavitaBaseUrl: configuredKavitaBaseUrl,
                });
                const kavitaLine = kavitaUrl ? `\nOpen in Kavita: ${kavitaUrl}` : '';
                await updateComponentReply(interaction, {
                    content: `**${existingTitleName}** is already on this server.${kavitaLine}`,
                    components: [],
                });
                return true;
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
                const recommendationId = resolveRecommendationId(result?.insertedId);
                const insertedId = recommendationId ? ` (id: ${recommendationId})` : '';
                const receiptDm = await sendRecommendationReceiptDm({
                    interaction,
                    title: selected.title,
                    recommendationId,
                });
                const dmSuffix = receiptDm.sent
                    ? '\nI also sent this as a DM.'
                    : '\nI could not DM you. Check Discord privacy settings if you want direct updates there.';
                await updateComponentReply(interaction, {
                    content: `Thanks for your recommendation for **${selected.title}**${insertedId}. I'll send you a message when it's approved or denied.${dmSuffix}`,
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
