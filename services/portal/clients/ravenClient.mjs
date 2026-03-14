/**
 * @fileoverview Wraps Portal's Raven recommendation, queue, and metadata bridge requests.
 * Related files:
 * - app/portalRuntime.mjs
 * - tests/ravenClient.test.mjs
 * Times this file has been edited: 10
 */

const DEFAULT_TIMEOUT_MS = 10000;

const normalizeUrl = (candidate) => {
    if (typeof candidate !== 'string') {
        return null;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
        return null;
    }

    const ensured = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        const url = new URL(ensured);
        return `${url.protocol}//${url.host}`;
    } catch {
        return null;
    }
};

const normalizeBoolean = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        if (value === 1) return true;
        if (value === 0) return false;
    }

    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1') {
        return true;
    }

    if (normalized === 'false' || normalized === 'no' || normalized === 'n' || normalized === '0') {
        return false;
    }

    return null;
};

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed || null;
};
const normalizeCount = (value) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
};

const normalizeStringList = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => normalizeString(entry))
        .filter(Boolean);
};

const normalizeRelatedSeries = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return null;
            }

            const title = normalizeString(entry.title);
            const sourceUrl = normalizeString(entry.sourceUrl);
            const relation = normalizeString(entry.relation);
            if (!title && !sourceUrl && !relation) {
                return null;
            }

            return {
                ...(title ? {title} : {}),
                ...(sourceUrl ? {sourceUrl} : {}),
                ...(relation ? {relation} : {}),
            };
        })
        .filter(Boolean);
};
const normalizeBulkQueueResult = (value, request) => {
    const payload = value && typeof value === 'object' ? value : {};
    const filters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};
    return {
        status: normalizeString(payload.status) ?? 'unknown',
        message: normalizeString(payload.message) ?? null,
        filters: {
            type: normalizeString(filters.type) ?? normalizeString(request?.type),
            nsfw: normalizeBoolean(filters.nsfw ?? request?.nsfw),
            titlePrefix: normalizeString(filters.titlePrefix) ?? normalizeString(request?.titlePrefix),
        },
        pagesScanned: normalizeCount(payload.pagesScanned),
        matchedCount: normalizeCount(payload.matchedCount),
        queuedCount: normalizeCount(payload.queuedCount),
        skippedActiveCount: normalizeCount(payload.skippedActiveCount),
        failedCount: normalizeCount(payload.failedCount),
        queuedTitles: normalizeStringList(payload.queuedTitles),
        skippedActiveTitles: normalizeStringList(payload.skippedActiveTitles),
        failedTitles: normalizeStringList(payload.failedTitles),
    };
};

const parseResponsePayload = async (response) => {
    const text = await response.text().catch(() => '');
    if (!text.trim()) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const createAbortController = (timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return {
        controller,
        cleanup: () => clearTimeout(timer),
    };
};

/**
 * Creates portal raven client.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const createPortalRavenClient = ({
                                            baseUrl,
                                            baseUrls = [],
                                            fetchImpl = fetch,
                                            timeoutMs = DEFAULT_TIMEOUT_MS,
                                            env = process.env,
                                        } = {}) => {
    let cachedCandidates = null;

    const buildCandidates = () => {
        if (cachedCandidates) {
            return cachedCandidates;
        }

        const candidates = [
            normalizeUrl(baseUrl),
            ...baseUrls.map(normalizeUrl),
            normalizeUrl(env?.RAVEN_BASE_URL),
            normalizeUrl(env?.RAVEN_INTERNAL_BASE_URL),
            normalizeUrl(env?.RAVEN_DOCKER_URL),
            'http://noona-raven:8080',
            'http://raven:8080',
            'http://host.docker.internal:8080',
            'http://127.0.0.1:8080',
            'http://localhost:8080',
        ].filter(Boolean);

        cachedCandidates = Array.from(new Set(candidates));
        return cachedCandidates;
    };

    const promoteCandidate = (preferred, candidates) => {
        cachedCandidates = [preferred, ...candidates.filter((entry) => entry !== preferred)];
    };

    const request = async (path, {method = 'GET', headers = {}, body, acceptStatuses = []} = {}) => {
        const candidates = buildCandidates();
        const errors = [];
        const accepted = new Set([200, 201, 202, 204, ...acceptStatuses]);

        for (const candidate of candidates) {
            const {controller, cleanup} = createAbortController(timeoutMs);
            try {
                const requestUrl = new URL(path, candidate);
                const response = await fetchImpl(requestUrl.toString(), {
                    method,
                    headers: {
                        Accept: 'application/json',
                        ...headers,
                    },
                    ...(body === undefined ? {} : {body}),
                    signal: controller.signal,
                });

                if (!accepted.has(response.status)) {
                    const payload = await parseResponsePayload(response);
                    const error = new Error(`Raven responded with status ${response.status}`);
                    error.status = response.status;
                    error.body = payload;
                    throw error;
                }

                promoteCandidate(candidate, candidates);
                if (response.status === 404) {
                    return null;
                }

                return await parseResponsePayload(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                errors.push(`${candidate} (${message})`);
            } finally {
                cleanup();
            }
        }

        cachedCandidates = null;
        throw new Error(`All Raven endpoints failed: ${errors.join(' | ')}`);
    };

    return {
        getDownloadStatus: async () => {
            const payload = await request('/v1/download/status');
            return Array.isArray(payload) ? payload : [];
        },
        getDownloadHistory: async () => {
            const payload = await request('/v1/download/status/history');
            return Array.isArray(payload) ? payload : [];
        },
        getDownloadSummary: async () => await request('/v1/download/status/summary'),
        getLibrary: async () => {
            const payload = await request('/v1/library/getall');
            return Array.isArray(payload) ? payload : [];
        },
        searchTitle: async (query) => {
            const normalized = typeof query === 'string' ? query.trim() : '';
            if (!normalized) {
                throw new Error('query is required.');
            }

            return await request(`/v1/download/search/${encodeURIComponent(normalized)}`);
        },
        getTitleDetails: async (sourceUrl) => {
            const normalized = typeof sourceUrl === 'string' ? sourceUrl.trim() : '';
            if (!normalized) {
                throw new Error('sourceUrl is required.');
            }

            const payload = await request(`/v1/download/title-details?url=${encodeURIComponent(normalized)}`);
            if (!payload || typeof payload !== 'object') {
                return {
                    sourceUrl: normalized,
                    summary: null,
                    type: null,
                    adultContent: null,
                    associatedNames: [],
                    status: null,
                    released: null,
                    officialTranslation: null,
                    animeAdaptation: null,
                    relatedSeries: [],
                };
            }

            return {
                sourceUrl: normalizeString(payload.sourceUrl) ?? normalized,
                summary: normalizeString(payload.summary),
                type: normalizeString(payload.type),
                adultContent: normalizeBoolean(payload.adultContent),
                associatedNames: normalizeStringList(payload.associatedNames),
                status: normalizeString(payload.status),
                released: normalizeString(payload.released),
                officialTranslation: normalizeBoolean(payload.officialTranslation),
                animeAdaptation: normalizeBoolean(payload.animeAdaptation),
                relatedSeries: normalizeRelatedSeries(payload.relatedSeries),
            };
        },
        getTitle: async (uuid) => {
            const normalized = typeof uuid === 'string' ? uuid.trim() : '';
            if (!normalized) {
                throw new Error('uuid is required.');
            }

            return await request(`/v1/library/title/${encodeURIComponent(normalized)}`, {acceptStatuses: [404]});
        },
        updateTitle: async (uuid, {title, sourceUrl, coverUrl} = {}) => {
            const normalized = typeof uuid === 'string' ? uuid.trim() : '';
            if (!normalized) {
                throw new Error('uuid is required.');
            }

            const payload = {};
            if (typeof title === 'string' && title.trim()) {
                payload.title = title.trim();
            }
            if (typeof sourceUrl === 'string' && sourceUrl.trim()) {
                payload.sourceUrl = sourceUrl.trim();
            }
            if (typeof coverUrl === 'string' && coverUrl.trim()) {
                payload.coverUrl = coverUrl.trim();
            }

            if (!Object.keys(payload).length) {
                throw new Error('At least one of title/sourceUrl/coverUrl must be provided.');
            }

            return await request(`/v1/library/title/${encodeURIComponent(normalized)}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                acceptStatuses: [404],
            });
        },
        applyTitleVolumeMap: async (uuid, {
            provider,
            providerSeriesId,
            chapterVolumeMap = {},
            autoRename = true
        } = {}) => {
            const normalized = typeof uuid === 'string' ? uuid.trim() : '';
            if (!normalized) {
                throw new Error('uuid is required.');
            }

            const normalizedProvider = normalizeString(provider);
            if (!normalizedProvider) {
                throw new Error('provider is required.');
            }

            const normalizedProviderSeriesId = normalizeString(providerSeriesId);
            if (!normalizedProviderSeriesId) {
                throw new Error('providerSeriesId is required.');
            }

            const payload = {
                provider: normalizedProvider,
                providerSeriesId: normalizedProviderSeriesId,
                chapterVolumeMap:
                    chapterVolumeMap && typeof chapterVolumeMap === 'object' && !Array.isArray(chapterVolumeMap)
                        ? chapterVolumeMap
                        : {},
                autoRename: autoRename !== false,
            };

            return await request(`/v1/library/title/${encodeURIComponent(normalized)}/volume-map`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                acceptStatuses: [404],
            });
        },
        bulkQueueDownload: async ({type, nsfw, titlePrefix} = {}) => {
            const normalizedType = normalizeString(type);
            if (!normalizedType) {
                throw new Error('type is required.');
            }

            const normalizedNsfw = normalizeBoolean(nsfw);
            if (normalizedNsfw == null) {
                throw new Error('nsfw must be true or false.');
            }

            const normalizedTitlePrefix = normalizeString(titlePrefix);
            if (!normalizedTitlePrefix) {
                throw new Error('titlePrefix is required.');
            }

            const requestBody = {
                type: normalizedType,
                nsfw: normalizedNsfw,
                titlePrefix: normalizedTitlePrefix,
            };
            const payload = await request('/v1/download/bulk-queue', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
                acceptStatuses: [409],
            });

            return normalizeBulkQueueResult(payload, requestBody);
        },
    };
};

export default createPortalRavenClient;
