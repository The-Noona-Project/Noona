// services/portal/shared/kavitaClient.mjs

import { errMSG, log } from '../../../utilities/etc/logger.mjs';

const DEFAULT_TIMEOUT = 10000;

const serializeBody = body => (body == null ? undefined : JSON.stringify(body));

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
    } catch (error) {
        return text;
    }
};

const createAbortController = (timeoutMs = DEFAULT_TIMEOUT) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const cleanup = () => clearTimeout(timer);
    return { controller, cleanup };
};

export const createKavitaClient = ({
    baseUrl,
    apiKey,
    timeoutMs = DEFAULT_TIMEOUT,
    fetchImpl = fetch,
} = {}) => {
    if (!baseUrl) {
        throw new Error('Kavita base URL is required.');
    }

    if (!apiKey) {
        throw new Error('Kavita API key is required.');
    }

    const request = async (path, { method = 'GET', body, headers = {}, query } = {}) => {
        const url = new URL(path, baseUrl);
        if (query && typeof query === 'object') {
            for (const [key, value] of Object.entries(query)) {
                if (value == null) {
                    continue;
                }
                url.searchParams.set(key, value);
            }
        }

        const { controller, cleanup } = createAbortController(timeoutMs);

        try {
            const response = await fetchImpl(url.toString(), {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-Api-Key': apiKey,
                    ...headers,
                },
                body: serializeBody(body),
                signal: controller.signal,
            });

            const payload = await parseResponseBody(response);

            if (!response.ok) {
                const error = new Error(`Kavita request failed with status ${response.status}`);
                error.status = response.status;
                error.body = payload;
                throw error;
            }

            return payload;
        } catch (error) {
            if (error.name === 'AbortError') {
                errMSG('[Portal/Kavita] Request timed out.');
            } else {
                errMSG(`[Portal/Kavita] Request error: ${error.message}`);
            }
            throw error;
        } finally {
            cleanup();
        }
    };

    const createOrUpdateUser = async ({ username, email, password, displayName, libraries = [] }) => {
        if (!username || !email) {
            throw new Error('Username and email are required to create or update a Kavita user.');
        }

        const payload = {
            username,
            email,
            password: password ?? undefined,
            displayName: displayName ?? username,
            libraries,
        };

        const response = await request('/api/portal/users', {
            method: 'POST',
            body: payload,
        });

        log(`[Portal/Kavita] Ensured user ${username}.`);
        return response;
    };

    const fetchLibraries = async () => {
        const libraries = await request('/api/library');
        return Array.isArray(libraries) ? libraries : [];
    };

    const fetchUser = async (username) => {
        if (!username) {
            throw new Error('Username is required when fetching Kavita user.');
        }

        return request(`/api/portal/users/${encodeURIComponent(username)}`);
    };

    const assignLibraries = async (username, libraries = []) => {
        if (!username) {
            throw new Error('Username is required when assigning libraries in Kavita.');
        }

        return request(`/api/portal/users/${encodeURIComponent(username)}/libraries`, {
            method: 'PUT',
            body: { libraries },
        });
    };

    return {
        request,
        createOrUpdateUser,
        fetchLibraries,
        fetchUser,
        assignLibraries,
    };
};

export default createKavitaClient;
