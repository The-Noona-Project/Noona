// services/portal/shared/kavitaClient.mjs

import {errMSG, log} from '../../../utilities/etc/logger.mjs';

const DEFAULT_TIMEOUT = 10000;

const serializeBody = body => (body == null ? undefined : JSON.stringify(body));
const normalizeString = value => (typeof value === 'string' ? value.trim() : '');

const normalizeStringList = values => {
    const seen = new Set();
    const out = [];

    for (const value of Array.isArray(values) ? values : []) {
        const normalized = normalizeString(value);
        if (!normalized) {
            continue;
        }

        const key = normalized.toLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        out.push(normalized);
    }

    return out;
};

const normalizeLibrarySelections = values => {
    if (!Array.isArray(values)) {
        return [];
    }

    const seenIds = new Set();
    const seenNames = new Set();
    const out = [];

    for (const value of values) {
        const asNumber = Number.parseInt(String(value), 10);
        if (Number.isInteger(asNumber) && String(value).trim() === String(asNumber) && asNumber > 0) {
            if (seenIds.has(asNumber)) {
                continue;
            }

            seenIds.add(asNumber);
            out.push(asNumber);
            continue;
        }

        const normalized = normalizeString(value);
        if (!normalized) {
            continue;
        }

        const key = normalized.toLowerCase();
        if (seenNames.has(key)) {
            continue;
        }

        seenNames.add(key);
        out.push(normalized);
    }

    return out;
};

const buildValidationError = (message, status = 400) => {
    const error = new Error(message);
    error.status = status;
    return error;
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

    const fetchLibraries = async () => {
        const libraries = await request('/api/Library/libraries');
        return Array.isArray(libraries) ? libraries : [];
    };

    const fetchRoles = async () => {
        const roles = await request('/api/Account/roles');
        return Array.isArray(roles) ? normalizeStringList(roles) : [];
    };

    const fetchUsers = async ({includePending = false} = {}) => {
        const users = await request('/api/Users', {
            query: {
                includePending: String(Boolean(includePending)),
            },
        });

        return Array.isArray(users) ? users : [];
    };

    const fetchUser = async (username) => {
        const normalizedUsername = normalizeString(username);
        if (!normalizedUsername) {
            throw new Error('Username is required when fetching Kavita user.');
        }

        const users = await fetchUsers({includePending: true});
        return users.find(user => normalizeString(user?.username).toLowerCase() === normalizedUsername.toLowerCase()) ?? null;
    };

    const searchTitles = async (queryString, {includeChapterAndFiles = false} = {}) => {
        const normalizedQuery = typeof queryString === 'string' ? queryString.trim() : '';
        if (!normalizedQuery) {
            throw new Error('Title query is required when searching Kavita.');
        }

        return request('/api/Search/search', {
            query: {
                queryString: normalizedQuery,
                includeChapterAndFiles: String(Boolean(includeChapterAndFiles)),
            },
        });
    };

    const scanLibrary = async (libraryId, {force = false} = {}) => {
        const parsedLibraryId = Number.parseInt(String(libraryId), 10);
        if (!Number.isInteger(parsedLibraryId) || parsedLibraryId < 1) {
            throw new Error('A valid Kavita library id is required to scan a library.');
        }

        return request('/api/Library/scan', {
            method: 'POST',
            query: {
                libraryId: String(parsedLibraryId),
                force: String(Boolean(force)),
            },
        });
    };

    const inviteUser = async ({email, roles = [], libraries = []} = {}) => {
        const normalizedEmail = normalizeString(email);
        if (!normalizedEmail) {
            throw buildValidationError('Email is required to invite a Kavita user.');
        }

        return request('/api/Account/invite', {
            method: 'POST',
            body: {
                email: normalizedEmail,
                roles: roles.length ? roles : undefined,
                libraries: libraries.length ? libraries : undefined,
            },
        });
    };

    const updateUser = async ({userId, username, email, roles = [], libraries = []} = {}) => {
        const parsedUserId = Number.parseInt(String(userId), 10);
        if (!Number.isInteger(parsedUserId) || parsedUserId < 1) {
            throw buildValidationError('A valid Kavita user id is required to update a user.');
        }

        const normalizedUsername = normalizeString(username);
        const normalizedEmail = normalizeString(email);
        if (!normalizedUsername || !normalizedEmail) {
            throw buildValidationError('Username and email are required to update a Kavita user.');
        }

        return request('/api/Account/update', {
            method: 'POST',
            body: {
                userId: parsedUserId,
                username: normalizedUsername,
                email: normalizedEmail,
                roles: roles.length ? roles : undefined,
                libraries: libraries.length ? libraries : undefined,
            },
        });
    };

    const resetUserPassword = async ({username, password, oldPassword} = {}) => {
        const normalizedUsername = normalizeString(username);
        if (!normalizedUsername || !password) {
            throw buildValidationError('Username and password are required to reset a Kavita password.');
        }

        return request('/api/Account/reset-password', {
            method: 'POST',
            body: {
                userName: normalizedUsername,
                password,
                oldPassword: oldPassword ?? undefined,
            },
        });
    };

    const resolveConfiguredRoles = async (roles = []) => {
        const normalizedRoles = normalizeStringList(roles);
        if (!normalizedRoles.length) {
            return [];
        }

        const availableRoles = await fetchRoles();
        if (!availableRoles.length) {
            return normalizedRoles;
        }

        const availableByKey = new Map(availableRoles.map(role => [role.toLowerCase(), role]));
        const resolvedRoles = [];
        const missingRoles = [];

        for (const role of normalizedRoles) {
            const resolvedRole = availableByKey.get(role.toLowerCase());
            if (!resolvedRole) {
                missingRoles.push(role);
                continue;
            }

            resolvedRoles.push(resolvedRole);
        }

        if (missingRoles.length) {
            throw buildValidationError(
                `Unknown Kavita role${missingRoles.length === 1 ? '' : 's'}: ${missingRoles.join(', ')}. Available roles: ${availableRoles.join(', ')}`,
            );
        }

        return resolvedRoles;
    };

    const resolveConfiguredLibraries = async (libraries = []) => {
        const normalizedSelections = normalizeLibrarySelections(libraries);
        if (!normalizedSelections.length) {
            return [];
        }

        const resolvedIds = [];
        const pendingNames = [];

        for (const selection of normalizedSelections) {
            if (typeof selection === 'number') {
                resolvedIds.push(selection);
                continue;
            }

            pendingNames.push(selection);
        }

        if (!pendingNames.length) {
            return [...new Set(resolvedIds)];
        }

        const availableLibraries = await fetchLibraries();
        const librariesByName = new Map(
            availableLibraries
                .filter(library => library?.id != null)
                .map(library => [normalizeString(library?.name).toLowerCase(), library]),
        );
        const missingLibraries = [];

        for (const libraryName of pendingNames) {
            const match = librariesByName.get(libraryName.toLowerCase());
            if (!match?.id) {
                missingLibraries.push(libraryName);
                continue;
            }

            resolvedIds.push(match.id);
        }

        if (missingLibraries.length) {
            const availableNames = availableLibraries
                .map(library => normalizeString(library?.name))
                .filter(Boolean);

            throw buildValidationError(
                `Unknown Kavita librar${missingLibraries.length === 1 ? 'y' : 'ies'}: ${missingLibraries.join(', ')}.${availableNames.length ? ` Available libraries: ${availableNames.join(', ')}` : ''}`,
            );
        }

        return [...new Set(resolvedIds)];
    };

    const createUser = async ({username, email, password, roles = [], libraries = []} = {}) => {
        const normalizedUsername = normalizeString(username);
        const normalizedEmail = normalizeString(email);

        if (!normalizedUsername || !normalizedEmail || !password) {
            throw buildValidationError('Username, password, and email are required to create a Kavita user.');
        }

        if (password.length < 6) {
            throw buildValidationError('Kavita passwords must be at least 6 characters long.');
        }

        const existingUsers = await fetchUsers({includePending: true});
        const conflictingUser = existingUsers.find(user => {
            const existingUsername = normalizeString(user?.username).toLowerCase();
            const existingEmail = normalizeString(user?.email).toLowerCase();
            return existingUsername === normalizedUsername.toLowerCase() || existingEmail === normalizedEmail.toLowerCase();
        });

        if (conflictingUser) {
            throw buildValidationError('A Kavita user already exists with that username or email.', 409);
        }

        const resolvedRoles = await resolveConfiguredRoles(roles);
        const resolvedLibraries = await resolveConfiguredLibraries(libraries);

        await inviteUser({
            email: normalizedEmail,
            roles: resolvedRoles,
            libraries: resolvedLibraries,
        });

        const invitedUsers = await fetchUsers({includePending: true});
        const invitedUser = invitedUsers.find(user => normalizeString(user?.email).toLowerCase() === normalizedEmail.toLowerCase());
        if (!invitedUser?.id) {
            throw buildValidationError('Kavita did not return the invited user record after invitation.', 502);
        }

        await updateUser({
            userId: invitedUser.id,
            username: normalizedUsername,
            email: normalizedEmail,
            roles: resolvedRoles,
            libraries: resolvedLibraries,
        });

        await resetUserPassword({
            username: normalizedUsername,
            password,
        });

        log(`[Portal/Kavita] Created user ${normalizedUsername}.`);
        return {
            id: invitedUser.id,
            username: normalizedUsername,
            email: normalizedEmail,
            roles: resolvedRoles,
            libraries: resolvedLibraries,
        };
    };

    const assignLibraries = async (username, libraries = []) => {
        const user = await fetchUser(username);
        if (!user?.id) {
            throw new Error('Kavita user was not found when assigning libraries.');
        }

        const resolvedLibraries = await resolveConfiguredLibraries(libraries);
        return updateUser({
            userId: user.id,
            username: user.username ?? username,
            email: user.email,
            roles: Array.isArray(user.roles) ? user.roles : [],
            libraries: resolvedLibraries,
        });
    };

    return {
        request,
        createUser,
        createOrUpdateUser: createUser,
        fetchRoles,
        fetchUsers,
        fetchLibraries,
        fetchUser,
        searchTitles,
        scanLibrary,
        inviteUser,
        updateUser,
        resetUserPassword,
        assignLibraries,
    };
};

export default createKavitaClient;
