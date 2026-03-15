/**
 * @fileoverview Defines the `/subscribe` Discord flow for release notifications.
 * Related files:
 * - commands/index.mjs
 * - commands/utils.mjs
 * - tests/discordCommands.test.mjs
 * Times this file has been edited: 2
 */

import {ApplicationCommandOptionType, MessageFlags} from 'discord.js';
import {errMSG} from '../../../utilities/etc/logger.mjs';
import {resolveDiscordId, respondWithError} from './utils.mjs';

const DEFAULT_SUBSCRIPTIONS_COLLECTION = 'portal_subscriptions';
const MAX_STORED_CHAPTER_KEYS = 2000;

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');
const normalizeTitleKey = value => normalizeString(value).toLowerCase().replace(/\s+/g, ' ').trim();
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
const normalizeChapterNumbers = value =>
    Array.isArray(value)
        ? value.map(entry => normalizeString(entry)).filter(Boolean)
        : [];
const toUniqueStrings = values => {
    const seen = new Set();
    const unique = [];

    for (const value of values) {
        const normalized = normalizeString(value);
        if (!normalized) {
            continue;
        }

        if (seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        unique.push(normalized);
    }

    return unique;
};
const trimChapterKeys = keys => {
    const normalized = toUniqueStrings(keys);
    if (normalized.length <= MAX_STORED_CHAPTER_KEYS) {
        return normalized;
    }

    return normalized.slice(normalized.length - MAX_STORED_CHAPTER_KEYS);
};
const resolveSubscriptionId = value => {
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
const resolveLibraryTitleName = title =>
    normalizeString(title?.title ?? title?.titleName);
const resolveLibraryTitleUuid = title =>
    normalizeString(title?.uuid ?? title?.titleUuid) || null;
const resolveLibraryTitleSourceUrl = title =>
    normalizeUrlForCompare(title?.sourceUrl);
const pickPreferredLibraryTitle = (library = [], query = '') => {
    const titles = Array.isArray(library)
        ? library.filter(entry => entry && typeof entry === 'object')
        : [];
    if (!titles.length) {
        return null;
    }

    const queryKey = normalizeTitleKey(query);
    if (!queryKey) {
        return titles[0];
    }

    const exactMatch = titles.find(entry => normalizeTitleKey(resolveLibraryTitleName(entry)) === queryKey);
    if (exactMatch) {
        return exactMatch;
    }

    const containsMatch = titles.find((entry) => {
        const titleKey = normalizeTitleKey(resolveLibraryTitleName(entry));
        return titleKey.includes(queryKey) || queryKey.includes(titleKey);
    });
    return containsMatch || titles[0];
};
const subscriptionMatchesCandidate = (entry = {}, candidate = {}) => {
    const subscriptionTitleUuid = normalizeString(entry?.titleUuid);
    if (subscriptionTitleUuid && candidate?.titleUuid && subscriptionTitleUuid === candidate.titleUuid) {
        return true;
    }

    const subscriptionSourceUrl = normalizeUrlForCompare(entry?.sourceUrl);
    if (subscriptionSourceUrl && candidate?.sourceUrl && subscriptionSourceUrl === candidate.sourceUrl) {
        return true;
    }

    const subscriptionTitleKey = normalizeTitleKey(entry?.titleKey || entry?.title || entry?.titleQuery);
    return Boolean(subscriptionTitleKey && candidate?.titleKey && subscriptionTitleKey === candidate.titleKey);
};
const taskMatchesCandidate = (task = {}, candidate = {}) => {
    const taskTitleUuid = normalizeString(task?.titleUuid);
    if (taskTitleUuid && candidate?.titleUuid && taskTitleUuid === candidate.titleUuid) {
        return true;
    }

    const taskSourceUrl = normalizeUrlForCompare(task?.sourceUrl);
    if (taskSourceUrl && candidate?.sourceUrl && taskSourceUrl === candidate.sourceUrl) {
        return true;
    }

    const taskTitleKey = normalizeTitleKey(task?.title);
    return Boolean(taskTitleKey && candidate?.titleKey && taskTitleKey === candidate.titleKey);
};
const buildChapterNotificationKey = (candidate = {}, chapterNumber = '') => {
    const chapter = normalizeString(chapterNumber);
    if (!chapter) {
        return null;
    }

    if (candidate?.titleUuid) {
        return `uuid:${candidate.titleUuid}:${chapter}`;
    }

    if (candidate?.sourceUrl) {
        return `source:${candidate.sourceUrl}:${chapter}`;
    }

    if (candidate?.titleKey) {
        return `title:${candidate.titleKey}:${chapter}`;
    }

    return null;
};
const collectBaselineChapterKeys = ({
                                        activeDownloads = [],
                                        downloadHistory = [],
                                        candidate = {},
                                    } = {}) => {
    const tasks = [
        ...(Array.isArray(activeDownloads) ? activeDownloads : []),
        ...(Array.isArray(downloadHistory) ? downloadHistory : []),
    ];
    const baseline = [];

    for (const task of tasks) {
        if (!taskMatchesCandidate(task, candidate)) {
            continue;
        }

        const chapterNumbers = normalizeChapterNumbers(task?.completedChapterNumbers);
        for (const chapterNumber of chapterNumbers) {
            const chapterKey = buildChapterNotificationKey(candidate, chapterNumber);
            if (chapterKey) {
                baseline.push(chapterKey);
            }
        }
    }

    return trimChapterKeys(baseline);
};
const resolveUserTag = interaction =>
    normalizeString(interaction?.user?.tag)
    || normalizeString(interaction?.member?.user?.tag)
    || null;
const buildSubscriptionUpdateQuery = (entry = {}) => {
    if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, '_id')) {
        return {_id: entry._id};
    }

    const fallbackQuery = {};
    const subscriberId = normalizeString(entry?.subscriber?.discordId);
    if (subscriberId) {
        fallbackQuery['subscriber.discordId'] = subscriberId;
    }

    const titleUuid = normalizeString(entry?.titleUuid);
    if (titleUuid) {
        fallbackQuery.titleUuid = titleUuid;
    }

    const sourceUrl = normalizeUrlForCompare(entry?.sourceUrl);
    if (sourceUrl) {
        fallbackQuery.sourceUrl = sourceUrl;
    }

    const titleKey = normalizeTitleKey(entry?.titleKey || entry?.title || entry?.titleQuery);
    if (titleKey) {
        fallbackQuery.titleKey = titleKey;
    }

    return fallbackQuery;
};

/**
 * Creates subscribe command.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const createSubscribeCommand = ({
                                           raven,
                                           vault,
                                           collection = DEFAULT_SUBSCRIPTIONS_COLLECTION,
                                           now = () => Date.now(),
                                       } = {}) => ({
    definition: {
        name: 'subscribe',
        description: 'Subscribe to a title and get DMs for newly downloaded chapters.',
        options: [
            {
                name: 'title',
                description: 'Title to subscribe to for chapter download DMs.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    execute: async interaction => {
        await interaction.deferReply?.({flags: MessageFlags.Ephemeral});

        if (!vault?.findSubscriptions || !vault?.storeSubscription || !vault?.updateSubscription) {
            throw new Error('Vault client is not configured for subscriptions.');
        }

        const titleQuery = normalizeString(interaction.options?.getString('title') ?? null);
        if (!titleQuery) {
            await respondWithError(interaction, 'Provide a title to subscribe.');
            return;
        }

        const discordId = resolveDiscordId(interaction);
        if (!discordId) {
            await respondWithError(interaction, 'Could not resolve your Discord user id for subscription storage.');
            return;
        }
        const discordTag = resolveUserTag(interaction);

        let libraryMatch = null;
        if (typeof raven?.getLibrary === 'function') {
            try {
                const library = await raven.getLibrary();
                libraryMatch = pickPreferredLibraryTitle(library, titleQuery);
            } catch (error) {
                errMSG(`[Portal/Discord] Failed to resolve Raven library title for subscription "${titleQuery}": ${error.message}`);
            }
        }

        const normalizedTitle = resolveLibraryTitleName(libraryMatch) || titleQuery;
        const candidate = {
            title: normalizedTitle,
            titleKey: normalizeTitleKey(normalizedTitle),
            titleUuid: resolveLibraryTitleUuid(libraryMatch),
            sourceUrl: resolveLibraryTitleSourceUrl(libraryMatch),
        };

        let baselineChapterKeys = [];
        if (typeof raven?.getDownloadStatus === 'function' || typeof raven?.getDownloadHistory === 'function') {
            const [activeDownloads, downloadHistory] = await Promise.all([
                typeof raven?.getDownloadStatus === 'function'
                    ? raven.getDownloadStatus().catch((error) => {
                        errMSG(`[Portal/Discord] Failed to load Raven active downloads for subscription "${normalizedTitle}": ${error.message}`);
                        return [];
                    })
                    : [],
                typeof raven?.getDownloadHistory === 'function'
                    ? raven.getDownloadHistory().catch((error) => {
                        errMSG(`[Portal/Discord] Failed to load Raven download history for subscription "${normalizedTitle}": ${error.message}`);
                        return [];
                    })
                    : [],
            ]);

            baselineChapterKeys = collectBaselineChapterKeys({
                activeDownloads,
                downloadHistory,
                candidate,
            });
        }

        const existingSubscriptions = await vault.findSubscriptions({
            collection,
            query: {
                'subscriber.discordId': discordId,
            },
        });
        const existingSubscription = (Array.isArray(existingSubscriptions) ? existingSubscriptions : [])
            .find(entry => subscriptionMatchesCandidate(entry, candidate)) ?? null;
        const existingStatus = normalizeString(existingSubscription?.status).toLowerCase();
        if (existingStatus === 'active') {
            await interaction.editReply?.({
                content: `You are already subscribed to **${normalizeString(existingSubscription?.title) || normalizedTitle}**.`,
                components: [],
            });
            return;
        }

        const subscribedAt = new Date(Number(now())).toISOString();
        const existingChapterKeys = Array.isArray(existingSubscription?.notifications?.sentChapterKeys)
            ? existingSubscription.notifications.sentChapterKeys
            : [];
        const updateSet = {
            status: 'active',
            subscribedAt,
            titleQuery,
            title: normalizedTitle,
            titleKey: candidate.titleKey,
            titleUuid: candidate.titleUuid || null,
            sourceUrl: candidate.sourceUrl || null,
            subscriber: {
                discordId,
                tag: discordTag,
            },
            notifications: {
                chapterDmCount: Number(existingSubscription?.notifications?.chapterDmCount) || 0,
                lastChapterDmAt: normalizeString(existingSubscription?.notifications?.lastChapterDmAt) || null,
                sentChapterKeys: trimChapterKeys([
                    ...existingChapterKeys,
                    ...baselineChapterKeys,
                ]),
            },
        };

        if (existingSubscription) {
            await vault.updateSubscription({
                collection,
                query: buildSubscriptionUpdateQuery(existingSubscription),
                update: {
                    $set: updateSet,
                },
            });
        } else {
            await vault.storeSubscription({
                source: 'discord',
                ...updateSet,
            }, {collection});
        }

        const matchSuffix = libraryMatch
            ? ''
            : '\nNo exact Raven library match was found, so this subscription will use title text matching.';
        await interaction.editReply?.({
            content: `Subscribed to **${normalizedTitle}**. I will DM you each time Raven downloads a new chapter.${matchSuffix}`,
            components: [],
        });
    },
});

export default createSubscribeCommand;
