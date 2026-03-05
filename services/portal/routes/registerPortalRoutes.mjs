// services/portal/routes/registerPortalRoutes.mjs

import {errMSG} from '../../../utilities/etc/logger.mjs';

const DEFAULT_PROXY_TIMEOUT_MS = 10000;
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

const normalizeMetadataMatch = (match = {}) => {
    const series = match?.series && typeof match.series === 'object'
        ? match.series
        : match?.Series && typeof match.Series === 'object'
            ? match.Series
            : match;

    return {
        provider: normalizeString(series?.provider ?? series?.Provider ?? series?.source) || null,
        title: normalizeString(series?.title ?? series?.Title ?? series?.name ?? series?.Name) || null,
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
            ?? series?.ImageUrl,
        ) || null,
        aniListId: series?.aniListId ?? series?.AniListId ?? match?.aniListId ?? match?.AniListId ?? null,
        malId: series?.malId ?? series?.MALId ?? series?.MalId ?? match?.malId ?? match?.MALId ?? match?.MalId ?? null,
        cbrId: series?.cbrId ?? series?.CbrId ?? match?.cbrId ?? match?.CbrId ?? null,
    };
};

const normalizeMetadataRouteError = (error, action) => {
    const normalized = normalizeError(error);
    if (normalized.status < 500) {
        return normalized;
    }

    return buildError(
        normalized.status,
        `Kavita metadata ${action} failed inside its external metadata service. Check Komf /config/application.yml metadataProviders and restart noona-komf plus noona-kavita.`,
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

    const sourceUrl = normalizeAbsoluteHttpUrl(title?.coverUrl);
    if (!sourceUrl) {
        return buildCoverSync(
            'skipped',
            'Applied the selected Kavita metadata match. This Noona title does not currently have stored cover art, so the Kavita cover was left unchanged.',
            {
                titleUuid: normalizedTitleUuid,
            },
        );
    }

    const coverUrl = buildPortalCoverUrl(config, normalizedTitleUuid);
    if (!coverUrl) {
        return buildCoverSync(
            'failed',
            'Applied the selected Kavita metadata match, but Portal could not build the internal Noona cover-art URL for Kavita.',
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
        'Applied the selected Kavita metadata match and synced the Noona cover art to Kavita.',
        {
            titleUuid: normalizedTitleUuid,
            sourceUrl,
            url: coverUrl,
        },
    );
};

export const registerPortalRoutes = ({
                                         app,
                                         config,
                                         discord,
                                         kavita,
                                         raven,
                                         onboardingStore,
                                         vault,
                                         fetchImpl = fetch,
                                     } = {}) => {
    const kavitaBaseUrl = typeof kavita?.getBaseUrl === 'function' ? kavita.getBaseUrl() : config?.kavita?.baseUrl ?? null;
    const requestTimeoutMs = normalizePositiveInteger(config?.http?.timeoutMs, DEFAULT_PROXY_TIMEOUT_MS);

    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            service: config.serviceName,
            guildId: config.discord.guildId,
            version: config.version ?? '2.0.0',
        });
    });

    app.get('/api/portal/kavita/info', async (_req, res) => {
        res.json({
            baseUrl: kavitaBaseUrl,
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
                ? payload.series.map((entry) => normalizeSeriesSearchResult(entry, kavitaBaseUrl))
                : [];

            res.json({
                baseUrl: kavitaBaseUrl,
                series,
            });
        } catch (error) {
            const normalized = normalizeError(error);
            errMSG(`[Portal] Failed to search Kavita titles for "${query}": ${normalized.message}`);
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

        try {
            const matches = await kavita?.fetchSeriesMetadataMatches?.(parsedSeriesId, {query}) ?? [];
            res.json({
                seriesId: parsedSeriesId,
                matches: Array.isArray(matches) ? matches.map((entry) => normalizeMetadataMatch(entry)) : [],
            });
        } catch (error) {
            const normalized = normalizeMetadataRouteError(error, 'lookup');
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

        try {
            const result = await kavita?.applySeriesMetadataMatch?.({
                seriesId: parsedSeriesId,
                aniListId: req.body?.aniListId,
                malId: req.body?.malId,
                cbrId: req.body?.cbrId,
            });
            let coverSync = buildCoverSync(
                'skipped',
                'Applied the selected Kavita metadata match. Kavita cover art was left unchanged.',
            );

            try {
                coverSync = await syncKavitaTitleCover({
                    config,
                    kavita,
                    raven,
                    titleUuid: req.body?.titleUuid,
                    seriesId: parsedSeriesId,
                });
            } catch (error) {
                const normalized = normalizeError(error, 502);
                errMSG(`[Portal] Failed to sync Kavita cover art for series ${parsedSeriesId}: ${normalized.message}`);
                coverSync = buildCoverSync(
                    'failed',
                    `Applied the selected Kavita metadata match, but Noona cover sync failed: ${normalized.message}`,
                );
            }

            res.json({
                success: true,
                seriesId: parsedSeriesId,
                result: result ?? null,
                message: coverSync.message,
                coverSync,
            });
        } catch (error) {
            const normalized = normalizeMetadataRouteError(error, 'apply');
            errMSG(`[Portal] Failed to apply Kavita metadata match for series ${parsedSeriesId}: ${normalized.message}`);
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
