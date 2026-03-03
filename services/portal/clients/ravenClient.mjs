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

    const request = async (path, {acceptStatuses = []} = {}) => {
        const candidates = buildCandidates();
        const errors = [];
        const accepted = new Set([200, 201, 202, 204, ...acceptStatuses]);

        for (const candidate of candidates) {
            const {controller, cleanup} = createAbortController(timeoutMs);
            try {
                const requestUrl = new URL(path, candidate);
                const response = await fetchImpl(requestUrl.toString(), {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                    },
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
        getDownloadSummary: async () => await request('/v1/download/status/summary'),
        getTitle: async (uuid) => {
            const normalized = typeof uuid === 'string' ? uuid.trim() : '';
            if (!normalized) {
                throw new Error('uuid is required.');
            }

            return await request(`/v1/library/title/${encodeURIComponent(normalized)}`, {acceptStatuses: [404]});
        },
    };
};

export default createPortalRavenClient;
