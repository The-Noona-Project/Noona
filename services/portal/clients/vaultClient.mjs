/**
 * @fileoverview Wraps Vault secret and collection operations used by Portal.
 * Related files:
 * - app/portalRuntime.mjs
 * - tests/vaultClient.test.mjs
 * Times this file has been edited: 6
 */

import {errMSG, log} from '../../../utilities/etc/logger.mjs';
import {ensureTrustedCaForUrl} from '../../../utilities/etc/tlsTrust.mjs';

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_RECOMMENDATIONS_COLLECTION = 'portal_recommendations';
const DEFAULT_SUBSCRIPTIONS_COLLECTION = 'portal_subscriptions';
const DEFAULT_HANDLE_RETRY_ATTEMPTS = 3;

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

const wait = async (delayMs) => new Promise(resolve => setTimeout(resolve, delayMs));

const extractErrorText = payload => {
    if (payload && typeof payload === 'object' && typeof payload.error === 'string') {
        return payload.error.trim();
    }

    if (typeof payload === 'string') {
        return payload.trim();
    }

    return '';
};

const isRetriableVaultHandleError = ({status, errorText} = {}) => {
    if (status >= 500) {
        return true;
    }

    if (status !== 400) {
        return false;
    }

    return /internal server error/i.test(errorText || '');
};

const isRedisNotFoundError = error => {
    const bodyError = typeof error?.body?.error === 'string' ? error.body.error : '';
    return /key not found/i.test(bodyError);
};

/**
 * Creates vault client.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const createVaultClient = ({
                                      baseUrl,
                                      token,
                                      timeoutMs = DEFAULT_TIMEOUT,
                                      fetchImpl = fetch,
                                      env = process.env,
                                      trustVaultUrl = ensureTrustedCaForUrl,
                                  } = {}) => {
    if (!baseUrl) {
        throw new Error('Vault base URL is required.');
    }

    if (!token) {
        throw new Error('Vault access token is required.');
    }

    const request = async (path, {method = 'GET', body, headers = {}} = {}) => {
        const url = buildUrl(baseUrl, path);
        const maxAttempts = path === '/v1/vault/handle' ? DEFAULT_HANDLE_RETRY_ATTEMPTS : 1;
        let lastError = null;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const {controller, cleanup} = createAbortController(timeoutMs);
            try {
                trustVaultUrl(url, {env});
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
                    const errorText = extractErrorText(payload);
                    if (
                        attempt + 1 < maxAttempts
                        && isRetriableVaultHandleError({status: response.status, errorText})
                    ) {
                        await wait(125 * (attempt + 1));
                        continue;
                    }

                    const suffix = errorText ? `: ${errorText}` : '';
                    const error = new Error(`Vault request failed with status ${response.status}${suffix}`);
                    error.status = response.status;
                    error.body = payload;
                    throw error;
                }

                return payload;
            } catch (error) {
                lastError = error;
                if (error?.name === 'AbortError' && attempt + 1 < maxAttempts) {
                    await wait(125 * (attempt + 1));
                    continue;
                }

                break;
            } finally {
                cleanup();
            }
        }

        if (lastError?.name === 'AbortError') {
            errMSG('[Portal/Vault] Request timed out.');
        } else {
            errMSG(`[Portal/Vault] Request error: ${lastError?.message ?? 'Unknown request failure.'}`);
        }
        throw lastError;
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

    const storeSubscription = async (subscription, {
        collection = DEFAULT_SUBSCRIPTIONS_COLLECTION,
    } = {}) => {
        if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
            throw new Error('Subscription payload must be an object.');
        }

        if (!collection || typeof collection !== 'string' || !collection.trim()) {
            throw new Error('Subscription collection must be a non-empty string.');
        }

        const payload = await request('/v1/vault/handle', {
            method: 'POST',
            body: {
                storageType: 'mongo',
                operation: 'insert',
                payload: {
                    collection: collection.trim(),
                    data: subscription,
                },
            },
        });
        log(`[Portal/Vault] Stored subscription in ${collection.trim()}.`);
        return payload;
    };

    const findSubscriptions = async ({
                                         collection = DEFAULT_SUBSCRIPTIONS_COLLECTION,
                                         query = {},
                                     } = {}) => {
        if (!collection || typeof collection !== 'string' || !collection.trim()) {
            throw new Error('Subscription collection must be a non-empty string.');
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

    const updateSubscription = async ({
                                          collection = DEFAULT_SUBSCRIPTIONS_COLLECTION,
                                          query,
                                          update,
                                          upsert = false,
                                      } = {}) => {
        if (!collection || typeof collection !== 'string' || !collection.trim()) {
            throw new Error('Subscription collection must be a non-empty string.');
        }

        if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).length === 0) {
            throw new Error('Subscription update query must be a non-empty object.');
        }

        if (!update || typeof update !== 'object' || Array.isArray(update) || Object.keys(update).length === 0) {
            throw new Error('Subscription update payload must be a non-empty object.');
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

    const redisSet = async (key, value, {ttl} = {}) => {
        const normalizedKey = typeof key === 'string' ? key.trim() : '';
        if (!normalizedKey) {
            throw new Error('Redis key must be a non-empty string.');
        }

        return request('/v1/vault/handle', {
            method: 'POST',
            body: {
                storageType: 'redis',
                operation: 'set',
                payload: {
                    key: normalizedKey,
                    value,
                    ttl,
                },
            },
        });
    };

    const redisGet = async key => {
        const normalizedKey = typeof key === 'string' ? key.trim() : '';
        if (!normalizedKey) {
            return null;
        }

        try {
            const payload = await request('/v1/vault/handle', {
                method: 'POST',
                body: {
                    storageType: 'redis',
                    operation: 'get',
                    payload: {
                        key: normalizedKey,
                    },
                },
            });

            return payload?.data ?? null;
        } catch (error) {
            if (isRedisNotFoundError(error)) {
                return null;
            }

            throw error;
        }
    };

    const redisDel = async key => {
        const normalizedKey = typeof key === 'string' ? key.trim() : '';
        if (!normalizedKey) {
            return {status: 'ok', deleted: 0};
        }

        return request('/v1/vault/handle', {
            method: 'POST',
            body: {
                storageType: 'redis',
                operation: 'del',
                payload: {
                    key: normalizedKey,
                },
            },
        });
    };

    const redisRPush = async (key, value, {ttl} = {}) => {
        const normalizedKey = typeof key === 'string' ? key.trim() : '';
        if (!normalizedKey) {
            throw new Error('Redis key must be a non-empty string.');
        }

        return request('/v1/vault/handle', {
            method: 'POST',
            body: {
                storageType: 'redis',
                operation: 'rpush',
                payload: {
                    key: normalizedKey,
                    value,
                    ttl,
                },
            },
        });
    };

    const redisLPop = async key => {
        const normalizedKey = typeof key === 'string' ? key.trim() : '';
        if (!normalizedKey) {
            return null;
        }

        try {
            const payload = await request('/v1/vault/handle', {
                method: 'POST',
                body: {
                    storageType: 'redis',
                    operation: 'lpop',
                    payload: {
                        key: normalizedKey,
                    },
                },
            });

            return payload?.data ?? null;
        } catch (error) {
            if (isRedisNotFoundError(error)) {
                return null;
            }

            throw error;
        }
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
        storeSubscription,
        findSubscriptions,
        updateSubscription,
        redisSet,
        redisGet,
        redisDel,
        redisRPush,
        redisLPop,
    };
};

export default createVaultClient;
