const DEFAULT_TIMEOUT = 10000;

const serializeBody = body => (body == null ? undefined : JSON.stringify(body));

const normalizeString = value => (typeof value === 'string' ? value.trim() : '');

const normalizePositiveInteger = value => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return null;
    }

    return parsed;
};

const parseResponseBody = async response => {
    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const createAbortController = (timeoutMs = DEFAULT_TIMEOUT) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const cleanup = () => clearTimeout(timer);
    return {controller, cleanup};
};

export const createKomfClient = ({
                                     baseUrl,
                                     timeoutMs = DEFAULT_TIMEOUT,
                                     fetchImpl = fetch,
                                 } = {}) => {
    if (!baseUrl) {
        throw new Error('Komf base URL is required.');
    }

    const normalizedBaseUrl = new URL(baseUrl).toString();

    const request = async (path, {method = 'GET', body, headers = {}, query} = {}) => {
        const url = new URL(path, normalizedBaseUrl);
        if (query && typeof query === 'object') {
            for (const [key, value] of Object.entries(query)) {
                if (value == null || value === '') {
                    continue;
                }
                url.searchParams.set(key, value);
            }
        }

        const {controller, cleanup} = createAbortController(timeoutMs);

        try {
            const nextHeaders = {
                Accept: 'application/json',
                ...headers,
            };

            if (body != null && !Object.prototype.hasOwnProperty.call(nextHeaders, 'Content-Type')) {
                nextHeaders['Content-Type'] = 'application/json';
            }

            const response = await fetchImpl(url.toString(), {
                method,
                headers: nextHeaders,
                body: serializeBody(body),
                signal: controller.signal,
            });

            const payload = await parseResponseBody(response);

            if (!response.ok) {
                const error = new Error(`Komf request failed with status ${response.status}`);
                error.status = response.status;
                error.body = payload;
                throw error;
            }

            return payload;
        } finally {
            cleanup();
        }
    };

    return {
        getBaseUrl: () => normalizedBaseUrl,
        searchSeriesMetadata: async (name, {seriesId, libraryId} = {}) => {
            const normalizedName = normalizeString(name);
            if (!normalizedName) {
                throw new Error('Metadata search name is required.');
            }

            const parsedSeriesId = normalizePositiveInteger(seriesId);
            const parsedLibraryId = normalizePositiveInteger(libraryId);
            const payload = await request('/api/kavita/metadata/search', {
                query: {
                    name: normalizedName,
                    seriesId: parsedSeriesId != null ? String(parsedSeriesId) : undefined,
                    libraryId: parsedLibraryId != null ? String(parsedLibraryId) : undefined,
                },
            });

            return Array.isArray(payload) ? payload : [];
        },
        identifySeriesMetadata: async ({seriesId, libraryId, provider, providerSeriesId} = {}) => {
            const parsedSeriesId = normalizePositiveInteger(seriesId);
            if (parsedSeriesId == null) {
                throw new Error('A valid Kavita series id is required to identify metadata through Komf.');
            }

            const normalizedProvider = normalizeString(provider);
            if (!normalizedProvider) {
                throw new Error('A metadata provider is required to identify metadata through Komf.');
            }

            const normalizedProviderSeriesId = normalizeString(providerSeriesId);
            if (!normalizedProviderSeriesId) {
                throw new Error('A provider result id is required to identify metadata through Komf.');
            }

            const parsedLibraryId = normalizePositiveInteger(libraryId);

            return request('/api/kavita/metadata/identify', {
                method: 'POST',
                body: {
                    libraryId: parsedLibraryId != null ? String(parsedLibraryId) : null,
                    seriesId: String(parsedSeriesId),
                    provider: normalizedProvider,
                    providerSeriesId: normalizedProviderSeriesId,
                },
            });
        },
        getSeriesMetadataDetails: async ({provider, providerSeriesId, libraryId} = {}) => {
            const normalizedProvider = normalizeString(provider);
            if (!normalizedProvider) {
                throw new Error('A metadata provider is required to load Komf series details.');
            }

            const normalizedProviderSeriesId = normalizeString(providerSeriesId);
            if (!normalizedProviderSeriesId) {
                throw new Error('A provider result id is required to load Komf series details.');
            }

            const parsedLibraryId = normalizePositiveInteger(libraryId);
            return request('/api/kavita/metadata/series-details', {
                query: {
                    provider: normalizedProvider,
                    providerSeriesId: normalizedProviderSeriesId,
                    libraryId: parsedLibraryId != null ? String(parsedLibraryId) : undefined,
                },
            });
        },
    };
};

export default createKomfClient;
