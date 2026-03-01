// services/portal/routes/registerPortalRoutes.mjs

import {errMSG} from '../../../utilities/etc/logger.mjs';

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

const normalizeMetadataMatch = (match = {}) => ({
    provider: normalizeString(match?.provider ?? match?.source) || null,
    title: normalizeString(match?.title ?? match?.name) || null,
    summary: normalizeString(match?.summary ?? match?.description) || null,
    score: typeof match?.score === 'number' ? match.score : null,
    coverImageUrl: normalizeString(match?.coverImageUrl ?? match?.imageUrl) || null,
    aniListId: match?.aniListId ?? null,
    malId: match?.malId ?? null,
    cbrId: match?.cbrId ?? null,
});

export const registerPortalRoutes = ({
                                         app,
                                         config,
                                         discord,
                                         kavita,
                                         onboardingStore,
                                         vault,
                                     } = {}) => {
    const kavitaBaseUrl = typeof kavita?.getBaseUrl === 'function' ? kavita.getBaseUrl() : config?.kavita?.baseUrl ?? null;

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

        try {
            const matches = await kavita?.fetchSeriesMetadataMatches?.(parsedSeriesId) ?? [];
            res.json({
                seriesId: parsedSeriesId,
                matches: Array.isArray(matches) ? matches.map((entry) => normalizeMetadataMatch(entry)) : [],
            });
        } catch (error) {
            const normalized = normalizeError(error);
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

            res.json({
                success: true,
                seriesId: parsedSeriesId,
                result: result ?? null,
            });
        } catch (error) {
            const normalized = normalizeError(error);
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
