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

export const createPortalWardenClient = ({
                                             baseUrl,
                                             baseUrls = [],
                                             token = null,
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
            normalizeUrl(env?.WARDEN_BASE_URL),
            normalizeUrl(env?.WARDEN_INTERNAL_BASE_URL),
            normalizeUrl(env?.WARDEN_DOCKER_URL),
            'http://noona-warden:4001',
            'http://warden:4001',
            'http://host.docker.internal:4001',
            'http://127.0.0.1:4001',
            'http://localhost:4001',
        ].filter(Boolean);

        cachedCandidates = Array.from(new Set(candidates));
        return cachedCandidates;
    };

    const promoteCandidate = (preferred, candidates) => {
        cachedCandidates = [preferred, ...candidates.filter((entry) => entry !== preferred)];
    };

    const request = async (path) => {
        const candidates = buildCandidates();
        const errors = [];

        for (const candidate of candidates) {
            const {controller, cleanup} = createAbortController(timeoutMs);
            try {
                const requestUrl = new URL(path, candidate);
                const response = await fetchImpl(requestUrl.toString(), {
                    method: 'GET',
                    headers: {
                        Accept: 'application/json',
                        ...(typeof token === 'string' && token.trim()
                            ? {Authorization: `Bearer ${token.trim()}`}
                            : {}),
                    },
                    signal: controller.signal,
                });

                if (!response.ok) {
                    const payload = await parseResponsePayload(response);
                    const error = new Error(`Warden responded with status ${response.status}`);
                    error.status = response.status;
                    error.body = payload;
                    throw error;
                }

                promoteCandidate(candidate, candidates);
                return await parseResponsePayload(response);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                errors.push(`${candidate} (${message})`);
            } finally {
                cleanup();
            }
        }

        cachedCandidates = null;
        throw new Error(`All Warden endpoints failed: ${errors.join(' | ')}`);
    };

    return {
        getInstallationProgress: async () => await request('/api/services/install/progress'),
        listServices: async ({includeInstalled = true} = {}) =>
            await request(`/api/services?includeInstalled=${includeInstalled ? 'true' : 'false'}`),
        getServiceHistory: async (serviceName, {limit = 1} = {}) =>
            await request(`/api/services/${encodeURIComponent(serviceName)}/logs?limit=${encodeURIComponent(String(limit))}`),
    };
};

export default createPortalWardenClient;
