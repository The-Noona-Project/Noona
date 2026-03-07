// services/portal/clients/vaultClient.mjs

import {errMSG, log} from '../../../utilities/etc/logger.mjs';

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RECOMMENDATIONS_COLLECTION = 'portal_recommendations';

const buildUrl = (baseUrl, path) => new URL(path, baseUrl).toString();

const createAbortController = timeoutMs => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const cleanup = () => clearTimeout(timer);
    return {controller, cleanup};
};

const parseResponse = async response => {
    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return text;
    }
};

export const createVaultClient = ({
                                      baseUrl,
                                      token,
                                      timeoutMs = DEFAULT_TIMEOUT,
                                      fetchImpl = fetch,
                                  } = {}) => {
    if (!baseUrl) {
        throw new Error('Vault base URL is required.');
    }

    if (!token) {
        throw new Error('Vault access token is required.');
    }

    const request = async (path, {method = 'GET', body, headers = {}} = {}) => {
        const url = buildUrl(baseUrl, path);
        const {controller, cleanup} = createAbortController(timeoutMs);

        try {
            const response = await fetchImpl(url, {
                method,
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...headers,
                },
                body: body == null ? undefined : JSON.stringify(body),
                signal: controller.signal,
            });

            const payload = await parseResponse(response);

            if (!response.ok) {
                const error = new Error(`Vault request failed with status ${response.status}`);
                error.status = response.status;
                error.body = payload;
                throw error;
            }

            return payload;
        } catch (error) {
            if (error.name === 'AbortError') {
                errMSG('[Portal/Vault] Request timed out.');
            } else {
                errMSG(`[Portal/Vault] Request error: ${error.message}`);
            }
            throw error;
        } finally {
            cleanup();
        }
    };

    const writeSecret = async (path, secret) => {
        const payload = await request(`/api/secrets/${encodeURIComponent(path)}`, {
            method: 'PUT',
            body: {secret},
        });
        log(`[Portal/Vault] Wrote secret for ${path}.`);
        return payload;
    };

    const readSecret = async path => request(`/api/secrets/${encodeURIComponent(path)}`);

    const deleteSecret = async path => request(`/api/secrets/${encodeURIComponent(path)}`, {
        method: 'DELETE',
    });

    const storePortalCredential = async (discordId, credential) => {
        if (!discordId) {
            throw new Error('Discord id is required when storing portal credential.');
        }

        return writeSecret(`portal/${discordId}`, credential);
    };

    const storeRecommendation = async (recommendation, {
        collection = DEFAULT_RECOMMENDATIONS_COLLECTION,
    } = {}) => {
        if (!recommendation || typeof recommendation !== 'object' || Array.isArray(recommendation)) {
            throw new Error('Recommendation payload must be an object.');
        }

        if (!collection || typeof collection !== 'string' || !collection.trim()) {
            throw new Error('Recommendation collection must be a non-empty string.');
        }

        const payload = await request('/v1/vault/handle', {
            method: 'POST',
            body: {
                storageType: 'mongo',
                operation: 'insert',
                payload: {
                    collection: collection.trim(),
                    data: recommendation,
                },
            },
        });
        log(`[Portal/Vault] Stored recommendation in ${collection.trim()}.`);
        return payload;
    };

    const findRecommendations = async ({
                                           collection = DEFAULT_RECOMMENDATIONS_COLLECTION,
                                           query = {},
                                       } = {}) => {
        if (!collection || typeof collection !== 'string' || !collection.trim()) {
            throw new Error('Recommendation collection must be a non-empty string.');
        }

        const payload = await request('/v1/vault/handle', {
            method: 'POST',
            body: {
                storageType: 'mongo',
                operation: 'findMany',
                payload: {
                    collection: collection.trim(),
                    query: query && typeof query === 'object' ? query : {},
                },
            },
        });

        return Array.isArray(payload?.data) ? payload.data : [];
    };

    const updateRecommendation = async ({
                                            collection = DEFAULT_RECOMMENDATIONS_COLLECTION,
                                            query,
                                            update,
                                            upsert = false,
                                        } = {}) => {
        if (!collection || typeof collection !== 'string' || !collection.trim()) {
            throw new Error('Recommendation collection must be a non-empty string.');
        }

        if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).length === 0) {
            throw new Error('Recommendation update query must be a non-empty object.');
        }

        if (!update || typeof update !== 'object' || Array.isArray(update) || Object.keys(update).length === 0) {
            throw new Error('Recommendation update payload must be a non-empty object.');
        }

        return request('/v1/vault/handle', {
            method: 'POST',
            body: {
                storageType: 'mongo',
                operation: 'update',
                payload: {
                    collection: collection.trim(),
                    query,
                    update,
                    upsert: upsert === true,
                },
            },
        });
    };

    return {
        request,
        writeSecret,
        readSecret,
        deleteSecret,
        storePortalCredential,
        storeRecommendation,
        findRecommendations,
        updateRecommendation,
    };
};

export default createVaultClient;
