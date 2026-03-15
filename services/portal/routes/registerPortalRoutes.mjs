/**
 * @fileoverview Registers Portal's HTTP routes for onboarding, Kavita handoff, and metadata bridge flows.
 * Related files:
 * - app/createPortalApp.mjs
 * - app/ravenTitleVolumeMap.mjs
 * - tests/portalApp.test.mjs
 * Times this file has been edited: 16
 */

import crypto from 'node:crypto';
import {errMSG} from '../../../utilities/etc/logger.mjs';
import {applyRavenTitleVolumeMap} from '../app/ravenTitleVolumeMap.mjs';

const DEFAULT_PROXY_TIMEOUT_MS = 10000;
const NOONA_KAVITA_LOGIN_TOKEN_TYPE = 'noona-kavita-login';
const buildError = (status, message, details) => ({status, message, details});

const normalizeError = (error, fallbackStatus = 500) => {
    if (!error) {
        return buildError(fallbackStatus, 'Unknown error.');
    }

    if (typeof error === 'string') {
        return buildError(fallbackStatus, error);
    }

    const status = error.status || fallbackStatus;
    const message = error.message || 'Unexpected error.';

    return buildError(status, message, error.body ?? error.details ?? null);
};

const KAVITA_ROLE_DESCRIPTIONS = new Map([
    ['admin', 'Full administrative access to Kavita, including server and user management.'],
    ['pleb', 'Baseline non-admin role. Pair this with other roles to grant day-to-day access.'],
    ['download', 'Allows the user to download supported files from Kavita.'],
    ['change password', 'Allows the user to change their own Kavita password.'],
    ['bookmark', 'Allows the user to save personal bookmarks and related reader markers.'],
    ['change restriction', 'Allows the user to adjust their own content restriction settings.'],
    ['login', 'Allows the user to sign in to Kavita.'],
    ['read only', 'Keeps the account in read-only mode inside Kavita.'],
    ['promote', 'Allows the user to access Kavita promotion actions for supported entities.'],
]);

const describeKavitaRole = (role) => {
    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    return KAVITA_ROLE_DESCRIPTIONS.get(normalizedRole)
        || 'Role is available from Kavita, but Moon does not have a built-in description for it yet.';
};

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeBooleanLike = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value === 1) {
            return true;
        }
        if (value === 0) {
            return false;
        }
    }

    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1' || normalized === 'on') {
        return true;
    }

    if (normalized === 'false' || normalized === 'no' || normalized === 'n' || normalized === '0' || normalized === 'off') {
        return false;
    }

    return null;
};
const normalizeMetadataKey = (value) => normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const normalizeAbsoluteHttpUrl = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return null;
    }

    try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }

        return parsed.toString();
    } catch {
        return null;
    }
};
const normalizePositiveInteger = (value, fallback = null) => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return fallback;
    }

    return parsed;
};
const normalizeNonNegativeInteger = (value, fallback = null) => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return fallback;
    }

    return parsed;
};
const normalizeMatchStateKey = (value) => normalizeString(value).toLowerCase().replace(/[^a-z]+/g, '');
const KAVITA_MATCH_STATE_OPTIONS = new Map([
    ['all', {label: 'all', option: 0}],
    ['matched', {label: 'matched', option: 1}],
    ['notmatched', {label: 'notMatched', option: 2}],
    ['error', {label: 'error', option: 3}],
    ['dontmatch', {label: 'dontMatch', option: 4}],
]);
const resolveMatchStateDescriptor = (value) => {
    const normalized = normalizeMatchStateKey(value);
    if (!normalized) {
        return KAVITA_MATCH_STATE_OPTIONS.get('all') ?? null;
    }

    return KAVITA_MATCH_STATE_OPTIONS.get(normalized) ?? null;
};
const createAbortController = (timeoutMs = DEFAULT_PROXY_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
        controller,
        cleanup: () => clearTimeout(timer),
    };
};

const normalizeDistinctStrings = (...values) => {
    const seen = new Set();
    const normalized = [];

    for (const value of values) {
        const candidate = normalizeString(value);
        if (!candidate) {
            continue;
        }

        const key = candidate.toLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        normalized.push(candidate);
    }

    return normalized;
};
const pushStringCandidates = (target = [], value) => {
    if (Array.isArray(value)) {
        target.push(...value);
        return;
    }

    target.push(value);
};
const normalizeMetadataAliasList = (...sources) => {
    const candidates = [];

    for (const source of sources) {
        if (!source || typeof source !== 'object') {
            continue;
        }

        pushStringCandidates(candidates, source?.aliases);
        pushStringCandidates(candidates, source?.Aliases);
        pushStringCandidates(candidates, source?.alternativeTitles);
        pushStringCandidates(candidates, source?.AlternativeTitles);
        pushStringCandidates(candidates, source?.alternateTitles);
        pushStringCandidates(candidates, source?.AlternateTitles);
        pushStringCandidates(candidates, source?.alternativeNames);
        pushStringCandidates(candidates, source?.AlternativeNames);
        pushStringCandidates(candidates, source?.associatedNames);
        pushStringCandidates(candidates, source?.AssociatedNames);
        pushStringCandidates(candidates, source?.synonyms);
        pushStringCandidates(candidates, source?.Synonyms);
        pushStringCandidates(candidates, source?.titles);
        pushStringCandidates(candidates, source?.Titles);
        candidates.push(
            source?.originalName,
            source?.OriginalName,
            source?.localizedName,
            source?.LocalizedName,
            source?.romajiTitle,
            source?.RomajiTitle,
            source?.englishTitle,
            source?.EnglishTitle,
            source?.nativeTitle,
            source?.NativeTitle,
        );
    }

    return normalizeDistinctStrings(...candidates);
};

const normalizeDistinctRoleList = (value) => {
    if (Array.isArray(value)) {
        return normalizeDistinctStrings(...value);
    }

    const csv = normalizeString(value);
    if (!csv) {
        return [];
    }

    return normalizeDistinctStrings(
        ...csv
            .split(',')
            .map((entry) => normalizeString(entry)),
    );
};

const normalizeKavitaLibrarySelection = (value) => {
    const out = [];
    const seen = new Set();

    for (const entry of Array.isArray(value) ? value : []) {
        if (typeof entry === 'number' && Number.isInteger(entry) && entry > 0) {
            if (!seen.has(`id:${entry}`)) {
                seen.add(`id:${entry}`);
                out.push(entry);
            }
            continue;
        }

        if (typeof entry === 'string') {
            const normalized = normalizeString(entry);
            if (!normalized) continue;
            const key = `name:${normalized.toLowerCase()}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push(normalized);
            }
            continue;
        }

        if (!entry || typeof entry !== 'object') {
            continue;
        }

        const id = normalizePositiveInteger(entry.id);
        if (id != null) {
            const key = `id:${id}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push(id);
            }
            continue;
        }

        const name = normalizeString(entry.name);
        if (name) {
            const key = `name:${name.toLowerCase()}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push(name);
            }
        }
    }

    return out;
};

const normalizeKavitaUserSummary = (user = {}) => {
    const id = normalizePositiveInteger(user?.id);
    return {
        id,
        username: normalizeString(user?.username),
        email: normalizeString(user?.email),
        roles: normalizeDistinctRoleList(user?.roles),
        libraries: normalizeKavitaLibrarySelection(user?.libraries),
        pending: user?.isPending === true,
    };
};

const buildGeneratedPassword = () => `Noona-${crypto.randomBytes(24).toString('base64url')}`;

const normalizeKavitaUsername = (...candidates) => {
    for (const candidate of candidates) {
        const normalized = normalizeString(candidate);
        if (!normalized) {
            continue;
        }

        const sanitized = normalized
            .replace(/\s+/g, '_')
            .replace(/[^A-Za-z0-9._@+-]+/g, '')
            .replace(/^[._@+-]+/, '')
            .slice(0, 64);

        if (sanitized.length >= 3) {
            return sanitized;
        }
    }

    return '';
};

const readStoredPortalCredential = async (vault, discordId) => {
    if (!vault?.readSecret || !discordId) {
        return null;
    }

    try {
        return await vault.readSecret(`portal/${discordId}`);
    } catch (error) {
        if (Number(error?.status) === 404) {
            return null;
        }

        throw error;
    }
};

const toKavitaSeriesUrl = (baseUrl, series = {}) => {
    const libraryId = Number.parseInt(String(series?.libraryId), 10);
    const seriesId = Number.parseInt(String(series?.seriesId), 10);
    if (!baseUrl || !Number.isInteger(libraryId) || !Number.isInteger(seriesId)) {
        return null;
    }

    try {
        return new URL(`/library/${libraryId}/series/${seriesId}`, baseUrl).toString();
    } catch {
        return null;
    }
};

const normalizeSeriesSearchResult = (series = {}, baseUrl = null) => ({
    seriesId: Number.parseInt(String(series?.seriesId), 10) || null,
    libraryId: Number.parseInt(String(series?.libraryId), 10) || null,
    name: normalizeString(series?.name) || null,
    originalName: normalizeString(series?.originalName) || null,
    localizedName: normalizeString(series?.localizedName) || null,
    libraryName: normalizeString(series?.libraryName) || null,
    aliases: normalizeDistinctStrings(series?.originalName, series?.localizedName)
        .filter((entry) => entry.toLowerCase() !== normalizeString(series?.name).toLowerCase()),
    url: toKavitaSeriesUrl(baseUrl, series),
});
const normalizeManageMatchSeries = (entry = {}, baseUrl = null) => {
    const series = entry?.series && typeof entry.series === 'object'
        ? entry.series
        : entry?.Series && typeof entry.Series === 'object'
            ? entry.Series
            : {};

    return {
        ...normalizeSeriesSearchResult(series, baseUrl),
        isMatched: entry?.isMatched === true || entry?.IsMatched === true,
        validUntilUtc: normalizeString(entry?.validUntilUtc ?? entry?.ValidUntilUtc) || null,
    };
};

const resolveAdultContentTagValue = (value) => {
    const normalizedBoolean = normalizeBooleanLike(value);
    if (normalizedBoolean != null) {
        return normalizedBoolean;
    }

    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === 'adult' || normalized === 'explicit' || normalized === 'nsfw') {
        return true;
    }

    if (normalized === 'safe' || normalized === 'clean') {
        return false;
    }

    return null;
};

const resolveAdultContentFromNamedEntry = (entry = {}) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
    }

    const tagName = [
        entry?.name,
        entry?.Name,
        entry?.label,
        entry?.Label,
        entry?.tag,
        entry?.Tag,
        entry?.title,
        entry?.Title,
        entry?.key,
        entry?.Key,
    ]
        .map((value) => normalizeString(value))
        .find(Boolean);

    if (normalizeMetadataKey(tagName) !== 'adult content') {
        return null;
    }

    for (const candidate of [
        entry?.value,
        entry?.Value,
        entry?.status,
        entry?.Status,
        entry?.answer,
        entry?.Answer,
        entry?.displayValue,
        entry?.DisplayValue,
        entry?.content,
        entry?.Content,
        entry?.text,
        entry?.Text,
    ]) {
        const normalized = resolveAdultContentTagValue(candidate);
        if (normalized != null) {
            return normalized;
        }
    }

    return true;
};

const resolveAdultContentFromTagCollection = (value) => {
    if (!value) {
        return null;
    }

    if (Array.isArray(value)) {
        for (const entry of value) {
            if (typeof entry === 'string') {
                if (normalizeMetadataKey(entry) === 'adult content') {
                    return true;
                }
                continue;
            }

            const namedEntry = resolveAdultContentFromNamedEntry(entry);
            if (namedEntry != null) {
                return namedEntry;
            }

            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                continue;
            }

            for (const [key, candidateValue] of Object.entries(entry)) {
                if (normalizeMetadataKey(key) !== 'adult content') {
                    const nested = resolveAdultContentFromTagCollection(candidateValue);
                    if (nested != null) {
                        return nested;
                    }
                    continue;
                }

                return resolveAdultContentTagValue(candidateValue) ?? true;
            }
        }

        return null;
    }

    const namedEntry = resolveAdultContentFromNamedEntry(value);
    if (namedEntry != null) {
        return namedEntry;
    }

    if (typeof value === 'object') {
        for (const [key, candidateValue] of Object.entries(value)) {
            if (normalizeMetadataKey(key) !== 'adult content') {
                const nested = resolveAdultContentFromTagCollection(candidateValue);
                if (nested != null) {
                    return nested;
                }
                continue;
            }

            return resolveAdultContentTagValue(candidateValue) ?? true;
        }
    }

    return null;
};

const resolveAdultContentFlag = (...sources) => {
    for (const source of sources) {
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            continue;
        }

        for (const [key, value] of Object.entries(source)) {
            const normalizedKey = normalizeMetadataKey(key).replace(/\s+/g, '');
            if (normalizedKey !== 'adultcontent' && normalizedKey !== 'isadult' && normalizedKey !== 'nsfw') {
                continue;
            }

            const normalized = resolveAdultContentTagValue(value);
            if (normalized != null) {
                return normalized;
            }
        }

        for (const container of [
            source?.tags,
            source?.Tags,
            source?.metadataTags,
            source?.MetadataTags,
            source?.attributes,
            source?.Attributes,
            source?.properties,
            source?.Properties,
            source?.metadata,
            source?.Metadata,
        ]) {
            const normalized = resolveAdultContentFromTagCollection(container);
            if (normalized != null) {
                return normalized;
            }
        }
    }

    return null;
};

const normalizeMetadataMatch = (match = {}) => {
    const series = match?.series && typeof match.series === 'object'
        ? match.series
        : match?.Series && typeof match.Series === 'object'
            ? match.Series
            : match;
    const adultContent = resolveAdultContentFlag(series, match);
    const title = normalizeString(series?.title ?? series?.Title ?? series?.name ?? series?.Name) || null;
    const aliases = normalizeMetadataAliasList(series, match).filter((alias) =>
        normalizeMetadataKey(alias) !== normalizeMetadataKey(title),
    );

    return {
        provider: normalizeString(series?.provider ?? series?.Provider ?? series?.source) || null,
        title,
        aliases,
        summary: normalizeString(series?.summary ?? series?.Summary ?? series?.description ?? series?.Description) || null,
        score: typeof match?.matchRating === 'number'
            ? match.matchRating
            : typeof match?.MatchRating === 'number'
                ? match.MatchRating
                : typeof match?.score === 'number'
                    ? match.score
                    : null,
        coverImageUrl: normalizeString(
            series?.coverImageUrl
            ?? series?.CoverImageUrl
            ?? series?.coverUrl
            ?? series?.CoverUrl
            ?? series?.imageUrl
            ?? series?.ImageUrl
            ?? series?.thumbnailUrl
            ?? series?.ThumbnailUrl,
        ) || null,
        sourceUrl: normalizeString(
            series?.url
            ?? series?.Url
            ?? series?.sourceUrl
            ?? series?.SourceUrl,
        ) || null,
        providerSeriesId: normalizeString(
            series?.providerSeriesId
            ?? series?.ProviderSeriesId
            ?? series?.resultId
            ?? series?.ResultId
            ?? match?.providerSeriesId
            ?? match?.ProviderSeriesId
            ?? match?.resultId
            ?? match?.ResultId,
        ) || null,
        aniListId: series?.aniListId ?? series?.AniListId ?? match?.aniListId ?? match?.AniListId ?? null,
        malId: series?.malId ?? series?.MALId ?? series?.MalId ?? match?.malId ?? match?.MALId ?? match?.MalId ?? null,
        cbrId: series?.cbrId ?? series?.CbrId ?? match?.cbrId ?? match?.CbrId ?? null,
        adultContent,
    };
};

const normalizeMetadataRouteError = (error, {action, backend = 'komf'} = {}) => {
    const normalized = normalizeError(error);
    if (normalized.status < 500) {
        return normalized;
    }

    if (backend === 'kavita') {
        return buildError(
            normalized.status,
            `Kavita metadata ${action} failed inside its external metadata service. Check Komf /config/application.yml metadataProviders and restart noona-komf plus noona-kavita.`,
            null,
        );
    }

    return buildError(
        normalized.status,
        `Komf metadata ${action} failed. Check Komf /config/application.yml metadataProviders and restart noona-komf.`,
        null,
    );
};

const buildPortalCoverUrl = (config = {}, titleUuid = '') => {
    const normalizedUuid = normalizeString(titleUuid);
    if (!normalizedUuid) {
        return null;
    }

    const serviceName = normalizeString(config?.serviceName) || 'noona-portal';
    const port = normalizePositiveInteger(config?.port, 3003);
    try {
        return new URL(
            `/api/portal/kavita/title-cover/${encodeURIComponent(normalizedUuid)}`,
            `http://${serviceName}:${port}`,
        ).toString();
    } catch {
        return null;
    }
};

const buildCoverSync = (status, message, extra = {}) => ({
    status,
    message,
    ...extra,
});

const syncKavitaTitleCover = async ({
                                        config,
                                        kavita,
                                        raven,
                                        titleUuid,
                                        seriesId,
                                        fallbackCoverUrl = null,
                                    } = {}) => {
    const normalizedTitleUuid = normalizeString(titleUuid);
    if (!normalizedTitleUuid) {
        return buildCoverSync(
            'skipped',
            'Applied the selected Kavita metadata match. Moon did not provide a Noona title id, so the Kavita cover was left unchanged.',
        );
    }

    if (typeof raven?.getTitle !== 'function') {
        return buildCoverSync(
            'failed',
            'Applied the selected Kavita metadata match, but Portal cannot reach Raven to resolve the Noona cover art.',
        );
    }

    if (typeof kavita?.setSeriesCover !== 'function') {
        return buildCoverSync(
            'failed',
            'Applied the selected Kavita metadata match, but this Portal build does not support Kavita cover-art sync.',
        );
    }

    const title = await raven.getTitle(normalizedTitleUuid);
    if (!title) {
        return buildCoverSync(
            'failed',
            `Applied the selected Kavita metadata match, but Noona title ${normalizedTitleUuid} was not found when resolving cover art.`,
        );
    }

    const persistedCoverUrl = normalizeAbsoluteHttpUrl(title?.coverUrl);
    const selectedMatchCoverUrl = normalizeAbsoluteHttpUrl(fallbackCoverUrl);
    let sourceUrl = persistedCoverUrl;
    let syncedCoverUrl = persistedCoverUrl;
    let usedDirectFallback = false;
    let backfilledNoonaCover = false;

    if (!syncedCoverUrl && selectedMatchCoverUrl) {
        if (typeof raven?.updateTitle === 'function') {
            const updatedTitle = await raven.updateTitle(normalizedTitleUuid, {
                coverUrl: selectedMatchCoverUrl,
            });
            syncedCoverUrl = normalizeAbsoluteHttpUrl(updatedTitle?.coverUrl);
            if (syncedCoverUrl) {
                sourceUrl = syncedCoverUrl;
                backfilledNoonaCover = true;
            }
        }

        if (!syncedCoverUrl) {
            sourceUrl = selectedMatchCoverUrl;
            usedDirectFallback = true;
        }
    }

    if (!sourceUrl) {
        return buildCoverSync(
            'skipped',
            'Applied the selected Kavita metadata match. This Noona title does not currently have stored cover art, so the Kavita cover was left unchanged.',
            {
                titleUuid: normalizedTitleUuid,
            },
        );
    }

    const proxiedCoverUrl = syncedCoverUrl ? buildPortalCoverUrl(config, normalizedTitleUuid) : null;
    const coverUrl = proxiedCoverUrl || sourceUrl;
    if (!coverUrl) {
        return buildCoverSync(
            'failed',
            'Applied the selected Kavita metadata match, but Portal could not resolve a cover-art URL for Kavita.',
            {
                titleUuid: normalizedTitleUuid,
                sourceUrl,
            },
        );
    }

    await kavita.setSeriesCover({
        seriesId,
        url: coverUrl,
        lockCover: true,
    });

    return buildCoverSync(
        'applied',
        backfilledNoonaCover
            ? 'Applied the selected Kavita metadata match, backfilled the Noona title cover art, and synced it to Kavita.'
            : usedDirectFallback
                ? 'Applied the selected Kavita metadata match and synced the selected metadata cover art to Kavita.'
                : 'Applied the selected Kavita metadata match and synced the Noona cover art to Kavita.',
        {
            titleUuid: normalizedTitleUuid,
            sourceUrl,
            url: coverUrl,
            backfilledNoonaCover,
            usedDirectFallback,
        },
    );
};

/**
 * Registers portal routes.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const registerPortalRoutes = ({
                                         app,
                                         config,
                                         discord,
                                         kavita,
                                         komf,
                                         raven,
                                         onboardingStore,
                                         vault,
                                         fetchImpl = fetch,
                                     } = {}) => {
    const kavitaBaseUrl = typeof kavita?.getBaseUrl === 'function' ? kavita.getBaseUrl() : config?.kavita?.baseUrl ?? null;
    const externalKavitaBaseUrl = normalizeAbsoluteHttpUrl(config?.kavita?.externalUrl);
    const kavitaLinkBaseUrl = externalKavitaBaseUrl || normalizeAbsoluteHttpUrl(kavitaBaseUrl);
    const requestTimeoutMs = normalizePositiveInteger(config?.http?.timeoutMs, DEFAULT_PROXY_TIMEOUT_MS);
    const discordHealth = discord ? 'ok' : (config?.discord?.enabled ? 'degraded' : 'disabled');

    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            service: config.serviceName,
            guildId: config.discord.guildId,
            version: config.version ?? '2.0.0',
            discord: discordHealth,
        });
    });

    app.get('/api/portal/kavita/info', async (_req, res) => {
        res.json({
            baseUrl: kavitaLinkBaseUrl,
            externalBaseUrl: externalKavitaBaseUrl,
            internalBaseUrl: normalizeAbsoluteHttpUrl(kavitaBaseUrl),
            managedService: 'noona-kavita',
        });
    });

    app.get('/api/portal/kavita/title-cover/:titleUuid', async (req, res) => {
        const titleUuid = normalizeString(req.params?.titleUuid);
        if (!titleUuid) {
            res.status(400).json({error: 'titleUuid is required.'});
            return;
        }

        if (typeof raven?.getTitle !== 'function') {
            res.status(503).json({error: 'Raven cover lookup is not available.'});
            return;
        }

        try {
            const title = await raven.getTitle(titleUuid);
            if (!title) {
                res.status(404).json({error: 'Title was not found.'});
                return;
            }

            const coverUrl = normalizeAbsoluteHttpUrl(title?.coverUrl);
            if (!coverUrl) {
                res.status(404).json({error: 'Title cover art is not available.'});
                return;
            }

            const {controller, cleanup} = createAbortController(requestTimeoutMs);

            try {
                const upstream = await fetchImpl(coverUrl, {
                    method: 'GET',
                    headers: {
                        Accept: 'image/*,*/*;q=0.8',
                    },
                    redirect: 'follow',
                    signal: controller.signal,
                });

                if (!upstream.ok) {
                    res.status(502).json({error: `Unable to load Noona cover art (HTTP ${upstream.status}).`});
                    return;
                }

                const contentType = normalizeString(upstream.headers?.get?.('content-type')) || 'application/octet-stream';
                const cacheControl = normalizeString(upstream.headers?.get?.('cache-control')) || 'public, max-age=3600';
                const payload = Buffer.from(await upstream.arrayBuffer());

                res.set('Content-Type', contentType);
                res.set('Cache-Control', cacheControl);
                res.send(payload);
            } finally {
                cleanup();
            }
        } catch (error) {
            const normalized = normalizeError(error, 502);
            errMSG(`[Portal] Failed to proxy Noona cover art for ${titleUuid}: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.post('/api/portal/kavita/libraries/ensure', async (req, res) => {
        const name = normalizeString(req.body?.name);
        const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : null;
        if (!name) {
            res.status(400).json({error: 'name is required.'});
            return;
        }

        if (!payload) {
            res.status(400).json({error: 'payload is required.'});
            return;
        }

        try {
            const result = await kavita?.ensureLibrary?.({name, payload});
            res.status(result?.created === true ? 201 : 200).json({
                success: true,
                name,
                created: result?.created === true,
                library: result?.library ?? null,
                result: result?.result ?? null,
            });
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to ensure Kavita library ${name}: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.post('/api/portal/kavita/libraries/scan', async (req, res) => {
        const name = normalizeString(req.body?.name);
        if (!name) {
            res.status(400).json({error: 'name is required.'});
            return;
        }

        const force = req.body?.force === true;

        try {
            const libraries = await kavita?.fetchLibraries?.() ?? [];
            const library = libraries.find((entry) =>
                normalizeString(entry?.name).toLowerCase() === name.toLowerCase(),
            ) ?? null;

            if (!library?.id) {
                res.status(404).json({error: `Library ${name} was not found.`});
                return;
            }

            const result = await kavita?.scanLibrary?.(library.id, {force});
            res.json({
                success: true,
                name,
                force,
                library,
                result: result ?? null,
            });
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to scan Kavita library ${name}: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.get('/api/portal/kavita/title-search', async (req, res) => {
        const query = normalizeString(req.query?.query);
        if (!query) {
            res.status(400).json({error: 'query is required.'});
            return;
        }

        try {
            const payload = await kavita?.searchTitles?.(query);
            const series = Array.isArray(payload?.series)
                ? payload.series.map((entry) => normalizeSeriesSearchResult(entry, kavitaLinkBaseUrl))
                : [];

            res.json({
                baseUrl: kavitaLinkBaseUrl,
                externalBaseUrl: externalKavitaBaseUrl,
                internalBaseUrl: normalizeAbsoluteHttpUrl(kavitaBaseUrl),
                series,
            });
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to search Kavita titles for "${query}": ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.get('/api/portal/kavita/series-metadata', async (req, res) => {
        const matchState = resolveMatchStateDescriptor(req.query?.state);
        if (!matchState) {
            res.status(400).json({error: 'state must be one of all, matched, notMatched, error, or dontMatch.'});
            return;
        }

        if (typeof kavita?.fetchSeriesMetadataStatus !== 'function') {
            res.status(503).json({error: 'Kavita series metadata status is not configured.'});
            return;
        }

        const pageNumber = normalizePositiveInteger(req.query?.pageNumber, 1) ?? 1;
        const pageSize = normalizeNonNegativeInteger(req.query?.pageSize, 0) ?? 0;
        const libraryType = Number.parseInt(String(req.query?.libraryType ?? -1), 10);
        if (!Number.isInteger(libraryType)) {
            res.status(400).json({error: 'libraryType must be an integer.'});
            return;
        }

        const searchTerm = normalizeString(req.query?.searchTerm);

        try {
            const items = await kavita.fetchSeriesMetadataStatus({
                matchStateOption: matchState.option,
                libraryType,
                searchTerm,
                pageNumber,
                pageSize,
            });

            res.json({
                state: matchState.label,
                pageNumber,
                pageSize,
                items: Array.isArray(items) ? items.map((entry) => normalizeManageMatchSeries(entry, kavitaLinkBaseUrl)) : [],
            });
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to load Kavita series metadata status: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.post('/api/portal/kavita/title-match/search', async (req, res) => {
        const query = normalizeString(req.body?.query);
        if (!query) {
            res.status(400).json({error: 'query is required.'});
            return;
        }

        if (typeof komf?.searchSeriesMetadata !== 'function') {
            res.status(503).json({error: 'Metadata match lookup is not configured.'});
            return;
        }

        try {
            const matches = await komf.searchSeriesMetadata(query);
            res.json({
                query,
                matches: Array.isArray(matches) ? matches.map((entry) => normalizeMetadataMatch(entry)) : [],
            });
        } catch (error) {
            const normalized = normalizeMetadataRouteError(error, {action: 'lookup', backend: 'komf'});
            errMSG(`[Portal] Failed to search standalone metadata matches for "${query}": ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.post('/api/portal/kavita/title-match', async (req, res) => {
        const parsedSeriesId = Number.parseInt(String(req.body?.seriesId), 10);
        if (!Number.isInteger(parsedSeriesId) || parsedSeriesId < 1) {
            res.status(400).json({error: 'seriesId is required.'});
            return;
        }

        const query = normalizeString(req.body?.query);
        if (!query) {
            res.status(400).json({error: 'query is required.'});
            return;
        }

        let backend = 'komf';
        try {
            let matches = [];
            if (typeof komf?.searchSeriesMetadata === 'function') {
                matches = await komf.searchSeriesMetadata(query, {seriesId: parsedSeriesId});
            } else if (typeof kavita?.fetchSeriesMetadataMatches === 'function') {
                backend = 'kavita';
                matches = await kavita.fetchSeriesMetadataMatches(parsedSeriesId, {query});
            } else {
                res.status(503).json({error: 'Metadata match lookup is not configured.'});
                return;
            }

            res.json({
                seriesId: parsedSeriesId,
                matches: Array.isArray(matches) ? matches.map((entry) => normalizeMetadataMatch(entry)) : [],
            });
        } catch (error) {
            const normalized = normalizeMetadataRouteError(error, {action: 'lookup', backend});
            errMSG(`[Portal] Failed to fetch Kavita metadata matches for series ${parsedSeriesId}: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.post('/api/portal/kavita/title-match/apply', async (req, res) => {
        const parsedSeriesId = Number.parseInt(String(req.body?.seriesId), 10);
        if (!Number.isInteger(parsedSeriesId) || parsedSeriesId < 1) {
            res.status(400).json({error: 'seriesId is required.'});
            return;
        }

        const provider = normalizeString(req.body?.provider);
        const providerSeriesId = normalizeString(req.body?.providerSeriesId ?? req.body?.resultId);
        const parsedLibraryId = Number.parseInt(String(req.body?.libraryId), 10);
        const aniListId = req.body?.aniListId;
        const malId = req.body?.malId;
        const cbrId = req.body?.cbrId;
        let backend = provider && providerSeriesId ? 'komf' : 'kavita';

        try {
            let result;
            if (provider && providerSeriesId) {
                if (typeof komf?.identifySeriesMetadata !== 'function') {
                    res.status(503).json({error: 'Komf metadata apply is not configured.'});
                    return;
                }

                result = await komf.identifySeriesMetadata({
                    seriesId: parsedSeriesId,
                    libraryId: Number.isInteger(parsedLibraryId) && parsedLibraryId > 0 ? parsedLibraryId : null,
                    provider,
                    providerSeriesId,
                });
            } else if (
                (aniListId != null && aniListId !== '')
                || (malId != null && malId !== '')
                || (cbrId != null && cbrId !== '')
            ) {
                if (typeof kavita?.applySeriesMetadataMatch !== 'function') {
                    res.status(503).json({error: 'Kavita metadata apply is not configured.'});
                    return;
                }

                result = await kavita.applySeriesMetadataMatch({
                    seriesId: parsedSeriesId,
                    aniListId,
                    malId,
                    cbrId,
                });
            } else {
                res.status(400).json({error: 'provider/providerSeriesId or a Kavita metadata provider id is required.'});
                return;
            }

            let coverSync = buildCoverSync(
                'skipped',
                'Applied the selected Kavita metadata match. Kavita cover art was left unchanged.',
            );
            let volumeMap = null;

            try {
                coverSync = await syncKavitaTitleCover({
                    config,
                    kavita,
                    raven,
                    titleUuid: req.body?.titleUuid,
                    seriesId: parsedSeriesId,
                    fallbackCoverUrl: req.body?.coverImageUrl,
                });
            } catch (error) {
                const normalized = normalizeError(error, 502);
                errMSG(`[Portal] Failed to sync Kavita cover art for series ${parsedSeriesId}: ${normalized.message}`);
                coverSync = buildCoverSync(
                    'failed',
                    `Applied the selected Kavita metadata match, but Noona cover sync failed: ${normalized.message}`,
                );
            }

            if (provider && providerSeriesId && req.body?.titleUuid) {
                try {
                    volumeMap = await applyRavenTitleVolumeMap({
                        titleUuid: req.body?.titleUuid,
                        provider,
                        providerSeriesId,
                        libraryId: Number.isInteger(parsedLibraryId) && parsedLibraryId > 0 ? parsedLibraryId : null,
                        autoRename: req.body?.autoRename,
                        komfClient: komf,
                        ravenClient: raven,
                    });
                } catch (error) {
                    const normalized = normalizeError(error, 502);
                    errMSG(`[Portal] Failed to apply Raven volume map for title ${normalizeString(req.body?.titleUuid)}: ${normalized.message}`);
                    volumeMap = {
                        status: 'failed',
                        mappedChapterCount: 0,
                        renameSummary: null,
                        message: `Metadata applied, but Raven volume-map sync failed: ${normalized.message}`,
                    };
                }
            }

            res.json({
                success: true,
                seriesId: parsedSeriesId,
                result: result ?? null,
                message: volumeMap?.message ? `${coverSync.message} ${volumeMap.message}` : coverSync.message,
                coverSync,
                volumeMap,
            });
        } catch (error) {
            const normalized = normalizeMetadataRouteError(error, {action: 'apply', backend});
            errMSG(`[Portal] Failed to apply Kavita metadata match for series ${parsedSeriesId}: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.post('/api/portal/raven/title-volume-map', async (req, res) => {
        const titleUuid = normalizeString(req.body?.titleUuid);
        if (!titleUuid) {
            res.status(400).json({error: 'titleUuid is required.'});
            return;
        }

        const provider = normalizeString(req.body?.provider);
        const providerSeriesId = normalizeString(req.body?.providerSeriesId);
        if (!provider || !providerSeriesId) {
            res.status(400).json({error: 'provider and providerSeriesId are required.'});
            return;
        }

        try {
            const result = await applyRavenTitleVolumeMap({
                titleUuid,
                provider,
                providerSeriesId,
                libraryId: req.body?.libraryId,
                autoRename: req.body?.autoRename,
                komfClient: komf,
                ravenClient: raven,
            });

            res.json({
                ok: true,
                status: result.status,
                mappedChapterCount: result.mappedChapterCount,
                title: result.title,
                renameSummary: result.renameSummary,
                message: result.message,
            });
        } catch (error) {
            const normalized = normalizeError(error, 502);
            errMSG(`[Portal] Failed to store Raven title volume map for ${titleUuid}: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.get('/api/portal/join-options', async (_req, res) => {
        try {
            const [roles, libraries] = await Promise.all([
                kavita?.fetchRoles?.() ?? [],
                kavita?.fetchLibraries?.() ?? [],
            ]);
            const normalizedRoles = Array.isArray(roles) ? roles : [];

            res.json({
                roles: normalizedRoles,
                roleDetails: normalizedRoles.map((role) => ({
                    name: role,
                    description: describeKavitaRole(role),
                })),
                libraries: Array.isArray(libraries)
                    ? libraries
                        .filter((library) => library?.id != null)
                        .map((library) => ({
                            id: library.id,
                            name: library.name ?? `Library ${library.id}`,
                        }))
                    : [],
            });
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to load join options: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.get('/api/portal/kavita/users', async (_req, res) => {
        if (!kavita?.fetchUsers || !kavita?.fetchRoles) {
            res.status(503).json({error: 'Kavita user management is not configured.'});
            return;
        }

        try {
            const [users, roles] = await Promise.all([
                kavita.fetchUsers({includePending: true}),
                kavita.fetchRoles(),
            ]);

            const normalizedRoles = normalizeDistinctRoleList(roles);
            const normalizedUsers = Array.isArray(users)
                ? users
                    .map((user) => normalizeKavitaUserSummary(user))
                    .filter((user) => user.id != null && user.username)
                : [];

            res.json({
                users: normalizedUsers,
                roles: normalizedRoles,
                roleDetails: normalizedRoles.map((role) => ({
                    name: role,
                    description: describeKavitaRole(role),
                })),
            });
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to load Kavita users: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.put('/api/portal/kavita/users/:username/roles', async (req, res) => {
        const username = normalizeString(req.params?.username);
        if (!username) {
            res.status(400).json({error: 'username is required.'});
            return;
        }

        if (!kavita?.fetchUser || !kavita?.updateUser || !kavita?.fetchRoles) {
            res.status(503).json({error: 'Kavita user role updates are not configured.'});
            return;
        }

        const requestedRoles = normalizeDistinctRoleList(req.body?.roles);
        if (requestedRoles.length === 0) {
            res.status(400).json({error: 'At least one Kavita role is required.'});
            return;
        }

        try {
            const availableRoles = normalizeDistinctRoleList(await kavita.fetchRoles());
            const availableByKey = new Map(availableRoles.map((role) => [role.toLowerCase(), role]));
            const unknownRoles = [];
            const resolvedRoles = [];
            const resolvedRoleKeys = new Set();

            for (const requestedRole of requestedRoles) {
                const available = availableByKey.get(requestedRole.toLowerCase());
                if (!available && availableRoles.length > 0) {
                    unknownRoles.push(requestedRole);
                    continue;
                }

                const resolved = available || requestedRole;
                const key = resolved.toLowerCase();
                if (resolvedRoleKeys.has(key)) {
                    continue;
                }

                resolvedRoleKeys.add(key);
                resolvedRoles.push(resolved);
            }

            if (unknownRoles.length > 0) {
                res.status(400).json({
                    error: `Unknown Kavita role${unknownRoles.length === 1 ? '' : 's'}: ${unknownRoles.join(', ')}`,
                    availableRoles,
                });
                return;
            }

            const existingUser = await kavita.fetchUser(username);
            if (!existingUser) {
                res.status(404).json({error: `Kavita user ${username} was not found.`});
                return;
            }

            const userId = normalizePositiveInteger(existingUser?.id);
            const existingUsername = normalizeString(existingUser?.username) || username;
            const email = normalizeString(existingUser?.email);
            if (userId == null || !existingUsername || !email) {
                res.status(502).json({error: 'Kavita user record is missing required fields for update.'});
                return;
            }

            const libraries = normalizeKavitaLibrarySelection(existingUser?.libraries);
            await kavita.updateUser({
                userId,
                username: existingUsername,
                email,
                roles: resolvedRoles,
                libraries,
                ageRestriction: existingUser?.ageRestriction ?? existingUser?.AgeRestriction ?? null,
            });

            const updatedUser = await kavita.fetchUser(existingUsername).catch(() => null);
            const summary = normalizeKavitaUserSummary(updatedUser ?? {
                ...existingUser,
                roles: resolvedRoles,
                libraries,
            });

            res.json({
                ok: true,
                user: summary,
                roles: summary.roles,
            });
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to update Kavita roles for ${username}: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.post('/api/portal/kavita/noona-login', async (req, res) => {
        const discordId = normalizeString(req.body?.discordId);
        const email = normalizeString(req.body?.email);
        const requestedUsername = normalizeString(req.body?.username);
        const discordUsername = normalizeString(req.body?.discordUsername);
        const displayName = normalizeString(req.body?.displayName);

        if (!discordId || !email) {
            res.status(400).json({error: 'discordId and email are required.'});
            return;
        }

        if (!onboardingStore?.setToken || !onboardingStore?.getToken || !onboardingStore?.consumeToken) {
            res.status(503).json({error: 'Portal login token storage is not configured.'});
            return;
        }

        if (!kavita?.createOrUpdateUser) {
            res.status(503).json({error: 'Kavita provisioning is not configured.'});
            return;
        }

        try {
            let storedCredential = null;
            try {
                storedCredential = await readStoredPortalCredential(vault, discordId);
            } catch (error) {
                const normalized = normalizeError(error);
                errMSG(`[Portal] Failed to read stored Noona Kavita credential for ${discordId}; continuing without it: ${normalized.message}`);
            }
            const storedPassword = normalizeString(storedCredential?.password);
            const normalizedUsername = normalizeKavitaUsername(
                normalizeString(storedCredential?.username),
                discordUsername,
                requestedUsername,
                displayName,
                normalizeString(email).split('@')[0],
                `noona_${discordId.slice(-8)}`,
            );

            if (!normalizedUsername) {
                res.status(400).json({error: 'Unable to derive a valid Kavita username from the Noona account.'});
                return;
            }

            const generatedPassword = buildGeneratedPassword();
            const defaultRoles = Array.isArray(config.join?.defaultRoles) ? config.join.defaultRoles : [];
            const defaultLibraries = Array.isArray(config.join?.defaultLibraries) ? config.join.defaultLibraries : [];
            const matchUsernames = normalizeDistinctStrings(
                storedCredential?.username,
                requestedUsername,
                discordUsername,
                displayName,
                normalizeString(email).split('@')[0],
            );
            const matchEmails = normalizeDistinctStrings(
                storedCredential?.email,
                email,
            );

            const noonaFallbackRoles = ['Pleb', 'Login'];
            let provisionedUser;
            try {
                provisionedUser = await kavita.createOrUpdateUser({
                    username: normalizedUsername,
                    email,
                    password: generatedPassword,
                    roles: defaultRoles,
                    libraries: defaultLibraries,
                    oldPassword: storedPassword || undefined,
                    matchUsernames,
                    matchEmails,
                });
            } catch (error) {
                const normalizedStatus = Number(error?.status);
                const normalizedMessage = normalizeString(error?.message).toLowerCase();
                const usernameTaken =
                    normalizedStatus === 400
                    && normalizedMessage.includes('username')
                    && normalizedMessage.includes('taken');

                if (usernameTaken && typeof kavita?.fetchUsers === 'function') {
                    const existingUsers = await kavita.fetchUsers({includePending: true}).catch(() => []);
                    const normalizedEmail = email.toLowerCase();
                    const normalizedDesiredUsername = normalizedUsername.toLowerCase();
                    const matchedByEmail = existingUsers.find((candidate = {}) =>
                        normalizeString(candidate?.email).toLowerCase() === normalizedEmail,
                    ) ?? null;
                    const matchedByUsername = existingUsers.find((candidate = {}) =>
                        normalizeString(candidate?.username).toLowerCase() === normalizedDesiredUsername,
                    ) ?? null;
                    const matchedUser = matchedByEmail || matchedByUsername;

                    if (matchedUser) {
                        const matchedUsername = normalizeString(matchedUser?.username);
                        if (matchedUsername) {
                            const preservedEmail = normalizeString(matchedUser?.email) || email;
                            const preservedRoles = normalizeDistinctRoleList(matchedUser?.roles);
                            const preservedLibraries = normalizeKavitaLibrarySelection(matchedUser?.libraries);
                            const mergedMatchUsernames = normalizeDistinctStrings(
                                ...matchUsernames,
                                matchedUsername,
                            );
                            const mergedMatchEmails = normalizeDistinctStrings(
                                ...matchEmails,
                                preservedEmail,
                            );

                            provisionedUser = await kavita.createOrUpdateUser({
                                username: matchedUsername,
                                email: preservedEmail,
                                password: generatedPassword,
                                roles: preservedRoles.length > 0 ? preservedRoles : defaultRoles,
                                libraries: preservedLibraries.length > 0 ? preservedLibraries : defaultLibraries,
                                ageRestriction: matchedUser?.ageRestriction ?? matchedUser?.AgeRestriction ?? null,
                                oldPassword: storedPassword || undefined,
                                matchUsernames: mergedMatchUsernames,
                                matchEmails: mergedMatchEmails,
                            });
                        } else {
                            throw error;
                        }
                    } else {
                        throw error;
                    }
                } else {
                    const shouldRetryWithSafeDefaults = normalizedStatus === 400;
                    if (!shouldRetryWithSafeDefaults) {
                        throw error;
                    }

                    errMSG(
                        `[Portal] Noona login provisioning for ${discordId} failed with HTTP 400; retrying with safe fallback roles and no library overrides.`,
                    );
                    provisionedUser = await kavita.createOrUpdateUser({
                        username: normalizedUsername,
                        email,
                        password: generatedPassword,
                        roles: noonaFallbackRoles,
                        libraries: [],
                        oldPassword: storedPassword || undefined,
                        matchUsernames,
                        matchEmails,
                    });
                }
            }

            const effectivePassword =
                provisionedUser?.passwordUpdated === false
                    ? (storedPassword || generatedPassword)
                    : generatedPassword;
            const provisionedUsername = normalizeString(provisionedUser?.username);
            const provisionedEmail = normalizeString(provisionedUser?.email) || email;
            if (!provisionedUsername || !provisionedEmail) {
                throw buildError(502, 'Kavita provisioning returned an invalid user record.');
            }

            const loginToken = await onboardingStore.setToken(discordId, {
                type: NOONA_KAVITA_LOGIN_TOKEN_TYPE,
                username: provisionedUsername,
                email: provisionedEmail,
                password: effectivePassword,
            });
            const tokenValue = normalizeString(loginToken?.token);
            if (!tokenValue) {
                throw buildError(502, 'Portal login token storage did not return a token.');
            }

            if (vault?.storePortalCredential) {
                try {
                    await vault.storePortalCredential(discordId, {
                        username: provisionedUsername,
                        email: provisionedEmail,
                        password: effectivePassword,
                        roles: provisionedUser.roles,
                        libraries: provisionedUser.libraries,
                        issuedAt: new Date().toISOString(),
                    });
                } catch (error) {
                    const normalized = normalizeError(error);
                    errMSG(`[Portal] Failed to persist Noona Kavita credential for ${discordId}; continuing with issued login token: ${normalized.message}`);
                }
            }

            res.status(provisionedUser.created === true ? 201 : 200).json({
                token: tokenValue,
                username: provisionedUsername,
                email: provisionedEmail,
                created: provisionedUser.created === true,
                baseUrl: kavitaLinkBaseUrl,
            });
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to provision Noona Kavita login for ${discordId}: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.post('/api/portal/kavita/login-tokens/consume', async (req, res) => {
        const token = normalizeString(req.body?.token);
        if (!token) {
            res.status(400).json({error: 'token is required.'});
            return;
        }

        if (!onboardingStore?.getToken || !onboardingStore?.consumeToken) {
            res.status(503).json({error: 'Portal login token storage is not configured.'});
            return;
        }

        try {
            const record = await onboardingStore.getToken(token);
            if (!record || record.type !== NOONA_KAVITA_LOGIN_TOKEN_TYPE) {
                res.status(404).json({error: 'Token not found or expired.'});
                return;
            }

            const consumed = await onboardingStore.consumeToken(token);
            if (!consumed) {
                res.status(404).json({error: 'Token not found or expired.'});
                return;
            }

            res.json({
                success: true,
                record: {
                    username: consumed.username,
                    email: consumed.email,
                    password: consumed.password,
                },
            });
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to consume Kavita login token: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.post('/api/portal/onboard', async (req, res) => {
        const {discordId, email, username, password, displayName, libraries = []} = req.body ?? {};

        if (!discordId || !email || !username || !password) {
            res.status(400).json({error: 'discordId, email, username, and password are required.'});
            return;
        }

        try {
            const onboardingToken = await onboardingStore?.setToken(discordId, {
                email,
                username,
                libraries,
            });

            await kavita?.createUser?.({
                username,
                email,
                password,
                roles: config.join?.defaultRoles ?? [],
                libraries: Array.isArray(libraries) && libraries.length > 0
                    ? libraries
                    : config.join?.defaultLibraries ?? [],
                displayName,
            });

            if (vault) {
                await vault.storePortalCredential(discordId, {
                    username,
                    email,
                    libraries,
                    issuedAt: new Date().toISOString(),
                });
            }

            if (discord) {
                await discord.assignDefaultRole(discordId).catch((error) => {
                    errMSG(`[Portal] Failed to assign default Discord role: ${error.message}`);
                });
            }

            res.status(201).json({token: onboardingToken?.token});
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to onboard member ${discordId}: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.post('/api/portal/tokens/consume', async (req, res) => {
        const {token} = req.body ?? {};
        if (!token) {
            res.status(400).json({error: 'token is required.'});
            return;
        }

        try {
            const record = await onboardingStore?.consumeToken(token);
            if (!record) {
                res.status(404).json({error: 'Token not found or expired.'});
                return;
            }

            res.json({success: true, record});
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to consume token ${token}: ${normalized.message}`);
            res.status(normalized.status).json({error: normalized.message, details: normalized.details});
        }
    });

    app.use((err, _req, res, _next) => {
        const normalized = normalizeError(err);
        errMSG(`[Portal] Unhandled error: ${normalized.message}`);
        res.status(normalized.status).json({error: normalized.message, details: normalized.details});
    });
};

export default registerPortalRoutes;
