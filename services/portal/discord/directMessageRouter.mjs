/**
 * @fileoverview Handles Portal's private Discord DM text commands for trusted admins.
 * Related files:
 * - app/portalRuntime.mjs
 * - clients/ravenClient.mjs
 * - discord/client.mjs
 * - tests/directMessageRouter.test.mjs
 * Times this file has been edited: 1
 */

import {errMSG} from '../../../utilities/etc/logger.mjs';
import {normalizeDiscordIdCandidate} from '../commands/utils.mjs';

const DOWNLOAD_ALL_PATTERN = /^(?:\/|!)?downloadall\b/i;
const DOWNLOAD_ALL_TOKEN_PATTERN = /([a-z]+):(?:"([^"]*)"|'([^']*)'|(\S+))/gi;
const ALLOWED_DOWNLOAD_ALL_KEYS = new Set(['type', 'nsfw', 'titlegroup']);
const TYPE_ALIASES = new Map([
    ['manga', 'Manga'],
    ['managa', 'Manga'],
    ['manhwa', 'Manhwa'],
    ['manhua', 'Manhua'],
    ['oel', 'OEL'],
]);

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');
const normalizeBoolean = value => {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) {
        return null;
    }
    if (['true', 'yes', '1', 'on'].includes(normalized)) {
        return true;
    }
    if (['false', 'no', '0', 'off'].includes(normalized)) {
        return false;
    }
    return null;
};
const normalizeType = value => TYPE_ALIASES.get(normalizeString(value).toLowerCase()) ?? null;
const normalizeTitlePrefix = value => normalizeString(value);
const normalizeCount = value => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};
const normalizeList = value => Array.isArray(value)
    ? value.map(entry => normalizeString(entry)).filter(Boolean)
    : [];

const sendReply = async (message, content) => {
    const payload = typeof content === 'string' ? {content} : content;
    if (typeof message?.reply === 'function') {
        return await message.reply(payload);
    }
    if (typeof message?.channel?.send === 'function') {
        return await message.channel.send(payload);
    }
    return null;
};

const parseDownloadAllTokens = raw => {
    const parsed = new Map();
    const invalidSegments = [];
    let cursor = 0;

    for (const match of raw.matchAll(DOWNLOAD_ALL_TOKEN_PATTERN)) {
        const gap = raw.slice(cursor, match.index).trim();
        if (gap) {
            invalidSegments.push(gap);
        }
        cursor = match.index + match[0].length;

        const [, rawKey, doubleQuoted, singleQuoted, bare] = match;
        parsed.set(rawKey.toLowerCase(), normalizeString(doubleQuoted ?? singleQuoted ?? bare ?? ''));
    }

    const trailing = raw.slice(cursor).trim();
    if (trailing) {
        invalidSegments.push(trailing);
    }

    return {
        parsed,
        invalidSegments,
    };
};

/**
 * Parses Portal's DM-only downloadall command.
 *
 * @param {string} content - Raw Discord message content.
 * @returns {{matched: boolean, valid: boolean, filters?: {type: string, nsfw: boolean, titlePrefix: string}, errors?: string[]}}
 * The parsed command state.
 */
export const parseDownloadAllCommand = (content) => {
    const trimmed = normalizeString(content);
    const commandMatch = trimmed.match(DOWNLOAD_ALL_PATTERN);
    if (!commandMatch) {
        return {matched: false, valid: false, errors: []};
    }

    const remainder = trimmed.slice(commandMatch[0].length).trim();
    const {parsed, invalidSegments} = parseDownloadAllTokens(remainder);
    const errors = [];

    const unknownKeys = [...parsed.keys()].filter(key => !ALLOWED_DOWNLOAD_ALL_KEYS.has(key));
    if (unknownKeys.length > 0) {
        errors.push(`Unknown fields: ${unknownKeys.join(', ')}`);
    }
    if (invalidSegments.length > 0) {
        errors.push(`Could not parse: ${invalidSegments.join(' | ')}`);
    }

    const type = normalizeType(parsed.get('type'));
    if (!type) {
        errors.push('type must be one of: manga, manhwa, manhua, oel.');
    }

    const nsfw = normalizeBoolean(parsed.get('nsfw'));
    if (nsfw == null) {
        errors.push('nsfw must be true or false.');
    }

    const titlePrefix = normalizeTitlePrefix(parsed.get('titlegroup'));
    if (!titlePrefix) {
        errors.push('titlegroup is required.');
    }

    return {
        matched: true,
        valid: errors.length === 0,
        filters: type && nsfw != null && titlePrefix
            ? {type, nsfw, titlePrefix}
            : undefined,
        errors,
    };
};

const formatValidationMessage = (errors = []) => {
    const lines = [
        'Use `downloadall type:manga nsfw:false titlegroup:a`',
        'Supported `type` values: manga, manhwa, manhua, oel.',
        '`nsfw` accepts true/false, yes/no, or 1/0.',
        '`titlegroup` is the title prefix Raven should match.',
    ];
    if (errors.length > 0) {
        lines.push('', `Problems: ${errors.join(' ')}`);
    }
    return lines.join('\n');
};

const formatTitleSection = (label, titles) => {
    const normalized = normalizeList(titles).slice(0, 10);
    if (normalized.length === 0) {
        return null;
    }
    return `${label}:\n${normalized.map(title => `- ${title}`).join('\n')}`;
};

/**
 * Formats Raven bulk queue results for the Discord DM summary.
 *
 * @param {object} result - Raven bulk queue payload.
 * @returns {string} User-facing summary text.
 */
export const formatBulkQueueSummary = (result = {}) => {
    const filters = result?.filters && typeof result.filters === 'object' ? result.filters : {};
    const normalizedNsfw = normalizeBoolean(filters.nsfw);
    const lines = [
        'Raven bulk queue finished.',
        `Status: ${normalizeString(result?.status) || 'unknown'}`,
        `Message: ${normalizeString(result?.message) || 'No summary returned.'}`,
        `Filters: type=${normalizeString(filters.type) || 'unknown'}, nsfw=${normalizedNsfw == null ? 'unknown' : String(normalizedNsfw)}, titlegroup=${normalizeString(filters.titlePrefix) || 'unknown'}`,
        `Pages scanned: ${normalizeCount(result?.pagesScanned)}`,
        `Matched: ${normalizeCount(result?.matchedCount)}`,
        `Queued: ${normalizeCount(result?.queuedCount)}`,
        `Skipped active: ${normalizeCount(result?.skippedActiveCount)}`,
        `Failed: ${normalizeCount(result?.failedCount)}`,
    ];

    const queuedSection = formatTitleSection('Queued titles (first 10)', result?.queuedTitles);
    const skippedSection = formatTitleSection('Skipped active titles (first 10)', result?.skippedActiveTitles);
    const failedSection = formatTitleSection('Failed titles (first 10)', result?.failedTitles);

    return [lines.join('\n'), queuedSection, skippedSection, failedSection]
        .filter(Boolean)
        .join('\n\n');
};

/**
 * Creates the Discord DM message handler for Portal's private admin commands.
 *
 * @param {object} options - Named function inputs.
 * @returns {Function} The async Discord message handler.
 */
export const createDirectMessageHandler = ({
                                               superuserId,
                                               raven,
                                           } = {}) => {
    const normalizedSuperuserId = normalizeDiscordIdCandidate(superuserId);

    return async message => {
        if (!message || message?.author?.bot) {
            return false;
        }
        if (message.guildId || message?.inGuild?.()) {
            return false;
        }

        const parsed = parseDownloadAllCommand(message.content);
        if (!parsed.matched) {
            return false;
        }

        const authorId = normalizeDiscordIdCandidate(message?.author?.id);
        if (!normalizedSuperuserId || authorId !== normalizedSuperuserId) {
            return true;
        }

        if (!parsed.valid || !parsed.filters) {
            await sendReply(message, formatValidationMessage(parsed.errors));
            return true;
        }

        if (typeof raven?.bulkQueueDownload !== 'function') {
            await sendReply(message, 'Raven bulk queue is not available right now.');
            return true;
        }

        await sendReply(
            message,
            `Queueing Raven bulk download for type=${parsed.filters.type}, nsfw=${parsed.filters.nsfw}, titlegroup=${parsed.filters.titlePrefix}...`,
        );

        try {
            const result = await raven.bulkQueueDownload({
                type: parsed.filters.type,
                nsfw: parsed.filters.nsfw,
                titlePrefix: parsed.filters.titlePrefix,
            });
            await sendReply(message, formatBulkQueueSummary(result));
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            errMSG(`[Portal/Discord] downloadall DM failed: ${messageText}`);
            await sendReply(message, `Raven bulk queue failed: ${messageText}`);
        }

        return true;
    };
};

export default createDirectMessageHandler;
