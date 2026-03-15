/**
 * @fileoverview Wraps Portal's Kavita HTTP calls for users, libraries, metadata, and login handoff flows.
 * Related files:
 * - app/portalRuntime.mjs
 * - tests/kavitaClient.test.mjs
 * Times this file has been edited: 10
 */

import {errMSG, log} from '../../../utilities/etc/logger.mjs';

const DEFAULT_TIMEOUT = 10000;

const serializeBody = body => (body == null ? undefined : JSON.stringify(body));
const normalizeString = value => (typeof value === 'string' ? value.trim() : '');
const normalizeAbsoluteHttpUrl = value => {
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
const normalizeFolderPath = value => {
    const normalized = normalizeString(value).replace(/\\/g, '/');
    if (!normalized) {
        return '';
    }

    return normalized.replace(/\/+$/, '') || '/';
};

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

const normalizeLibraryFolders = values => {
    const seen = new Set();
    const out = [];

    for (const value of Array.isArray(values) ? values : []) {
        const normalized = normalizeFolderPath(value);
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        out.push(normalized);
    }

    return out;
};

const mergeLibraryFolders = (expected = [], existing = []) => {
    const seen = new Set();
    const out = [];

    for (const value of [...expected, ...existing]) {
        const normalized = normalizeFolderPath(value);
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        out.push(normalized);
    }

    return out;
};

const sameStringSet = (left = [], right = []) => {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    if (leftSet.size !== rightSet.size) {
        return false;
    }

    for (const value of leftSet) {
        if (!rightSet.has(value)) {
            return false;
        }
    }

    return true;
};

const normalizePositiveInteger = value => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return null;
    }

    return String(value).trim() === String(parsed) ? parsed : null;
};

const DEFAULT_AGE_RESTRICTION = Object.freeze({
    ageRating: -1,
    includeUnknowns: true,
});

const normalizeAgeRestriction = value => {
    if (!value || typeof value !== 'object') {
        return {...DEFAULT_AGE_RESTRICTION};
    }

    const source = value;
    const parsedAgeRating = Number.parseInt(String(source?.ageRating ?? source?.AgeRating), 10);
    const ageRating = Number.isInteger(parsedAgeRating)
        ? parsedAgeRating
        : DEFAULT_AGE_RESTRICTION.ageRating;

    const rawIncludeUnknowns = source?.includeUnknowns ?? source?.IncludeUnknowns;
    let includeUnknowns = DEFAULT_AGE_RESTRICTION.includeUnknowns;
    if (typeof rawIncludeUnknowns === 'boolean') {
        includeUnknowns = rawIncludeUnknowns;
    } else if (typeof rawIncludeUnknowns === 'number') {
        includeUnknowns = rawIncludeUnknowns > 0;
    } else if (typeof rawIncludeUnknowns === 'string') {
        const normalized = rawIncludeUnknowns.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) {
            includeUnknowns = true;
        } else if (['0', 'false', 'no', 'off'].includes(normalized)) {
            includeUnknowns = false;
        }
    }

    return {ageRating, includeUnknowns};
};

const normalizeSelectionExpressions = (values, {allowNumeric = false} = {}) => {
    const expressions = [];
    const seen = new Set();

    for (const rawValue of Array.isArray(values) ? values : []) {
        if (allowNumeric && typeof rawValue === 'number' && Number.isInteger(rawValue) && rawValue > 0) {
            const key = `+id:${rawValue}`;
            if (!seen.has(key)) {
                seen.add(key);
                expressions.push({exclude: false, type: 'id', value: rawValue});
            }
            continue;
        }

        const normalized = normalizeString(rawValue);
        if (!normalized) {
            continue;
        }

        if (normalized === '*') {
            if (!seen.has('*')) {
                seen.add('*');
                expressions.push({wildcard: true});
            }
            continue;
        }

        const exclude = normalized.startsWith('-');
        const candidate = normalizeString(exclude ? normalized.slice(1) : normalized);
        if (!candidate) {
            continue;
        }

        let expression;
        if (allowNumeric) {
            const numericValue = normalizePositiveInteger(candidate);
            expression = numericValue == null
                ? {exclude, type: 'name', value: candidate}
                : {exclude, type: 'id', value: numericValue};
        } else {
            expression = {exclude, type: 'name', value: candidate};
        }

        const expressionKey = `${expression.exclude ? '-' : '+'}:${expression.type}:${String(expression.value).toLowerCase()}`;
        if (seen.has(expressionKey)) {
            continue;
        }

        seen.add(expressionKey);
        expressions.push(expression);
    }

    return expressions;
};

const buildValidationError = (message, status = 400) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const normalizeSeriesSearchPayload = (payload) => {
    if (Array.isArray(payload)) {
        return {series: payload};
    }

    if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.series)) {
            return payload;
        }

        if (Array.isArray(payload.results)) {
            return {series: payload.results};
        }
    }

    return {series: []};
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

const extractKavitaErrorMessage = payload => {
    if (typeof payload === 'string') {
        const normalized = payload.trim();
        return normalized || '';
    }

    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const directKeys = ['error', 'message'];
    for (const key of directKeys) {
        const normalized = normalizeString(payload?.[key]);
        if (normalized) {
            return normalized;
        }
    }

    const errors = payload?.errors;
    if (errors && typeof errors === 'object') {
        for (const value of Object.values(errors)) {
            if (Array.isArray(value)) {
                const first = normalizeString(value[0]);
                if (first) {
                    return first;
                }
            }
            const normalized = normalizeString(value);
            if (normalized) {
                return normalized;
            }
        }
    }

    const secondaryKeys = ['title', 'detail'];
    for (const key of secondaryKeys) {
        const normalized = normalizeString(payload?.[key]);
        if (normalized) {
            return normalized;
        }
    }

    return '';
};

const createAbortController = (timeoutMs = DEFAULT_TIMEOUT) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const cleanup = () => clearTimeout(timer);
    return {controller, cleanup};
};

/**
 * Creates kavita client.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
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

    const normalizedBaseUrl = new URL(baseUrl).toString();

    const request = async (path, {method = 'GET', body, headers = {}, query} = {}) => {
        const url = new URL(path, normalizedBaseUrl);
        if (query && typeof query === 'object') {
            for (const [key, value] of Object.entries(query)) {
                if (value == null) {
                    continue;
                }
                url.searchParams.set(key, value);
            }
        }

        const {controller, cleanup} = createAbortController(timeoutMs);

        try {
            const nextHeaders = {
                Accept: 'application/json',
                'X-Api-Key': apiKey,
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
                const detailMessage = extractKavitaErrorMessage(payload);
                const error = new Error(
                    detailMessage
                        ? `Kavita request failed with status ${response.status}: ${detailMessage}`
                        : `Kavita request failed with status ${response.status}`,
                );
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

        const includeChapters = String(Boolean(includeChapterAndFiles));
        const attempts = [
            () => request('/api/Search/search', {
                query: {
                    queryString: normalizedQuery,
                    includeChapterAndFiles: includeChapters,
                },
            }),
            () => request('/api/Search/search', {
                query: {
                    queryString: normalizedQuery,
                },
            }),
            () => request('/api/Search/search', {
                method: 'POST',
                body: {
                    queryString: normalizedQuery,
                    includeChapterAndFiles: Boolean(includeChapterAndFiles),
                },
            }),
        ];

        let lastError = null;
        for (let index = 0; index < attempts.length; index += 1) {
            try {
                const payload = await attempts[index]();
                return normalizeSeriesSearchPayload(payload);
            } catch (error) {
                lastError = error;
                if (Number(error?.status) !== 400 || index === attempts.length - 1) {
                    throw error;
                }
            }
        }

        throw lastError ?? new Error('Unable to search Kavita titles.');
    };

    const fetchSeriesMetadataStatus = async ({
                                                 matchStateOption = 0,
                                                 libraryType = -1,
                                                 searchTerm = '',
                                                 pageNumber = 1,
                                                 pageSize = 0,
                                             } = {}) => {
        const parsedMatchStateOption = Number.parseInt(String(matchStateOption), 10);
        if (!Number.isInteger(parsedMatchStateOption) || parsedMatchStateOption < 0 || parsedMatchStateOption > 4) {
            throw new Error('A valid metadata match state option is required.');
        }

        const parsedLibraryType = Number.parseInt(String(libraryType), 10);
        if (!Number.isInteger(parsedLibraryType)) {
            throw new Error('libraryType must be an integer.');
        }

        const parsedPageNumber = Number.parseInt(String(pageNumber), 10);
        if (!Number.isInteger(parsedPageNumber) || parsedPageNumber < 1) {
            throw new Error('pageNumber must be a positive integer.');
        }

        const parsedPageSize = Number.parseInt(String(pageSize), 10);
        if (!Number.isInteger(parsedPageSize) || parsedPageSize < 0) {
            throw new Error('pageSize must be zero or a positive integer.');
        }

        const payload = await request('/api/Manage/series-metadata', {
            method: 'POST',
            query: {
                pageNumber: String(parsedPageNumber),
                pageSize: String(parsedPageSize),
            },
            body: {
                matchStateOption: parsedMatchStateOption,
                libraryType: parsedLibraryType,
                searchTerm: normalizeString(searchTerm),
            },
        });

        return Array.isArray(payload) ? payload : [];
    };

    const fetchSeriesMetadataMatches = async (seriesId, {query} = {}) => {
        const parsedSeriesId = Number.parseInt(String(seriesId), 10);
        if (!Number.isInteger(parsedSeriesId) || parsedSeriesId < 1) {
            throw new Error('A valid Kavita series id is required to search metadata matches.');
        }

        const normalizedQuery = normalizeString(query);
        if (!normalizedQuery) {
            throw new Error('A non-empty metadata query is required to search metadata matches.');
        }

        const matches = await request('/api/Series/match', {
            method: 'POST',
            body: {
                seriesId: parsedSeriesId,
                query: normalizedQuery,
            },
        });

        return Array.isArray(matches) ? matches : [];
    };

    const applySeriesMetadataMatch = async ({seriesId, aniListId, malId, cbrId} = {}) => {
        const parsedSeriesId = Number.parseInt(String(seriesId), 10);
        if (!Number.isInteger(parsedSeriesId) || parsedSeriesId < 1) {
            throw new Error('A valid Kavita series id is required to apply a metadata match.');
        }

        const query = {
            seriesId: String(parsedSeriesId),
        };

        if (aniListId != null && aniListId !== '') {
            query.aniListId = String(aniListId);
        }
        if (malId != null && malId !== '') {
            query.malId = String(malId);
        }
        if (cbrId != null && cbrId !== '') {
            query.cbrId = String(cbrId);
        }

        if (!query.aniListId && !query.malId && !query.cbrId) {
            throw new Error('At least one metadata provider id is required to apply a Kavita metadata match.');
        }

        return request('/api/Series/update-match', {
            method: 'POST',
            query,
        });
    };

    const setSeriesCover = async ({seriesId, url, lockCover = true} = {}) => {
        const parsedSeriesId = Number.parseInt(String(seriesId), 10);
        if (!Number.isInteger(parsedSeriesId) || parsedSeriesId < 1) {
            throw new Error('A valid Kavita series id is required to update cover art.');
        }

        const normalizedUrl = normalizeAbsoluteHttpUrl(url);
        if (!normalizedUrl) {
            throw new Error('A valid absolute http(s) cover-art URL is required to update a Kavita series cover.');
        }

        return request('/api/Upload/series', {
            method: 'POST',
            body: {
                id: parsedSeriesId,
                url: normalizedUrl,
                lockCover: Boolean(lockCover),
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

    const updateLibrary = async ({id, name, folders} = {}) => {
        const parsedLibraryId = Number.parseInt(String(id), 10);
        if (!Number.isInteger(parsedLibraryId) || parsedLibraryId < 1) {
            throw buildValidationError('A valid Kavita library id is required to update a library.');
        }

        const normalizedName = normalizeString(name);
        if (!normalizedName) {
            throw buildValidationError('Library name is required to update a Kavita library.');
        }

        const normalizedFolders = normalizeLibraryFolders(folders);
        if (!normalizedFolders.length) {
            throw buildValidationError('At least one library folder is required to update a Kavita library.');
        }

        return request('/api/Library/update', {
            method: 'POST',
            body: {
                id: parsedLibraryId,
                name: normalizedName,
                folders: normalizedFolders,
            },
        });
    };

    const ensureLibrary = async ({name, payload} = {}) => {
        const normalizedName = normalizeString(name);
        if (!normalizedName) {
            throw buildValidationError('Library name is required to ensure a Kavita library.');
        }

        const existingLibraries = await fetchLibraries();
        const existingLibrary = existingLibraries.find((library) =>
            normalizeString(library?.name).toLowerCase() === normalizedName.toLowerCase(),
        ) ?? null;
        if (existingLibrary) {
            const expectedFolders = normalizeLibraryFolders(payload?.folders);
            const currentFolders = normalizeLibraryFolders(existingLibrary?.folders);
            const mergedFolders = mergeLibraryFolders(expectedFolders, currentFolders);

            if (expectedFolders.length && !sameStringSet(currentFolders, mergedFolders) && existingLibrary?.id != null) {
                const result = await updateLibrary({
                    id: existingLibrary.id,
                    name: existingLibrary.name ?? normalizedName,
                    folders: mergedFolders,
                });

                return {
                    created: false,
                    library: result ?? {...existingLibrary, folders: mergedFolders},
                    result: result ?? null,
                };
            }

            return {
                created: false,
                library: existingLibrary,
            };
        }

        if (!payload || typeof payload !== 'object') {
            throw buildValidationError('Library payload is required to create a Kavita library.');
        }

        const result = await request('/api/Library/create', {
            method: 'POST',
            body: payload,
        });

        return {
            created: true,
            library: null,
            result: result ?? null,
        };
    };

    const inviteUser = async ({email, roles = [], libraries = [], ageRestriction = null} = {}) => {
        const normalizedEmail = normalizeString(email);
        if (!normalizedEmail) {
            throw buildValidationError('Email is required to invite a Kavita user.');
        }
        const resolvedAgeRestriction = normalizeAgeRestriction(ageRestriction);

        return request('/api/Account/invite', {
            method: 'POST',
            body: {
                email: normalizedEmail,
                roles: roles.length ? roles : undefined,
                libraries: Array.isArray(libraries) ? libraries : [],
                ageRestriction: resolvedAgeRestriction,
            },
        });
    };

    const updateUser = async ({userId, username, email, roles = [], libraries = [], ageRestriction = null} = {}) => {
        const parsedUserId = Number.parseInt(String(userId), 10);
        if (!Number.isInteger(parsedUserId) || parsedUserId < 1) {
            throw buildValidationError('A valid Kavita user id is required to update a user.');
        }

        const normalizedUsername = normalizeString(username);
        const normalizedEmail = normalizeString(email);
        if (!normalizedUsername || !normalizedEmail) {
            throw buildValidationError('Username and email are required to update a Kavita user.');
        }
        const resolvedAgeRestriction = normalizeAgeRestriction(ageRestriction);

        return request('/api/Account/update', {
            method: 'POST',
            body: {
                userId: parsedUserId,
                username: normalizedUsername,
                email: normalizedEmail,
                roles: roles.length ? roles : undefined,
                libraries: Array.isArray(libraries) ? libraries : [],
                ageRestriction: resolvedAgeRestriction,
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
        const expressions = normalizeSelectionExpressions(roles);
        if (!expressions.length) {
            return [];
        }

        const availableRoles = await fetchRoles();
        if (!availableRoles.length) {
            return expressions
                .filter(expression => !expression.wildcard && !expression.exclude && expression.type === 'name')
                .map(expression => expression.value);
        }

        const availableByKey = new Map(availableRoles.map(role => [role.toLowerCase(), role]));
        const resolvedRoles = expressions.some(expression => expression.wildcard) ? [...availableRoles] : [];
        const resolvedKeys = new Set(resolvedRoles.map(role => role.toLowerCase()));
        const missingRoles = [];

        for (const expression of expressions) {
            if (expression.wildcard) {
                continue;
            }

            const resolvedRole = availableByKey.get(expression.value.toLowerCase());
            if (!resolvedRole) {
                missingRoles.push(expression.value);
                continue;
            }

            const key = resolvedRole.toLowerCase();
            if (expression.exclude) {
                if (resolvedKeys.has(key)) {
                    resolvedKeys.delete(key);
                    const resolvedIndex = resolvedRoles.findIndex(role => role.toLowerCase() === key);
                    if (resolvedIndex >= 0) {
                        resolvedRoles.splice(resolvedIndex, 1);
                    }
                }
                continue;
            }

            if (!resolvedKeys.has(key)) {
                resolvedKeys.add(key);
                resolvedRoles.push(resolvedRole);
            }
        }

        if (missingRoles.length) {
            throw buildValidationError(
                `Unknown Kavita role${missingRoles.length === 1 ? '' : 's'}: ${missingRoles.join(', ')}. Available roles: ${availableRoles.join(', ')}`,
            );
        }

        return resolvedRoles;
    };

    const resolveConfiguredLibraries = async (libraries = []) => {
        const expressions = normalizeSelectionExpressions(libraries, {allowNumeric: true});
        if (!expressions.length) {
            return [];
        }

        const requiresLibraryCatalog = expressions.some(expression => expression.wildcard || expression.type === 'name');
        const availableLibraries = requiresLibraryCatalog ? await fetchLibraries() : [];
        const librariesByName = new Map(
            availableLibraries
                .map(library => {
                    const id = normalizePositiveInteger(library?.id);
                    if (id == null) {
                        return null;
                    }

                    const name = normalizeString(library?.name);
                    if (!name) {
                        return null;
                    }

                    return [name.toLowerCase(), id];
                })
                .filter(Boolean),
        );
        const missingLibraries = [];
        const resolvedIds = expressions.some(expression => expression.wildcard)
            ? availableLibraries
                .map(library => normalizePositiveInteger(library?.id))
                .filter((id) => id != null)
            : [];
        const resolvedIdSet = new Set(resolvedIds);

        for (const expression of expressions) {
            if (expression.wildcard) {
                continue;
            }

            let resolvedId = null;
            if (expression.type === 'id') {
                resolvedId = expression.value;
            } else {
                resolvedId = librariesByName.get(expression.value.toLowerCase()) ?? null;
                if (resolvedId == null) {
                    missingLibraries.push(expression.value);
                    continue;
                }
            }

            if (expression.exclude) {
                resolvedIdSet.delete(resolvedId);
                continue;
            }

            resolvedIdSet.add(resolvedId);
        }

        if (missingLibraries.length) {
            const availableNames = availableLibraries
                .map(library => normalizeString(library?.name))
                .filter(Boolean);

            throw buildValidationError(
                `Unknown Kavita librar${missingLibraries.length === 1 ? 'y' : 'ies'}: ${missingLibraries.join(', ')}.${availableNames.length ? ` Available libraries: ${availableNames.join(', ')}` : ''}`,
            );
        }

        return resolvedIds.filter(id => resolvedIdSet.has(id)).concat(
            [...resolvedIdSet].filter(id => !resolvedIds.includes(id)),
        );
    };

    const createUser = async ({username, email, password, roles = [], libraries = [], ageRestriction = null} = {}) => {
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
        const resolvedAgeRestriction = normalizeAgeRestriction(ageRestriction);

        await inviteUser({
            email: normalizedEmail,
            roles: resolvedRoles,
            libraries: resolvedLibraries,
            ageRestriction: resolvedAgeRestriction,
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
            ageRestriction: resolvedAgeRestriction,
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
            passwordUpdated: true,
        };
    };

    const createOrUpdateUser = async ({
                                          username,
                                          email,
                                          password,
                                          roles = [],
                                          libraries = [],
                                          ageRestriction = null,
                                          oldPassword = null,
                                          matchUsernames = [],
                                          matchEmails = [],
                                      } = {}) => {
        const normalizedUsername = normalizeString(username);
        const normalizedEmail = normalizeString(email);

        if (!normalizedUsername || !normalizedEmail || !password) {
            throw buildValidationError('Username, password, and email are required to create a Kavita user.');
        }

        if (password.length < 6) {
            throw buildValidationError('Kavita passwords must be at least 6 characters long.');
        }

        const resolvedRoles = await resolveConfiguredRoles(roles);
        const resolvedLibraries = await resolveConfiguredLibraries(libraries);
        const users = await fetchUsers({includePending: true});
        const usernameKeys = new Set(
            normalizeStringList([normalizedUsername, ...matchUsernames]).map(value => value.toLowerCase()),
        );
        const emailKeys = new Set(
            normalizeStringList([normalizedEmail, ...matchEmails]).map(value => value.toLowerCase()),
        );

        const existingUser = users.find(user => {
            const existingUsername = normalizeString(user?.username).toLowerCase();
            const existingEmail = normalizeString(user?.email).toLowerCase();
            return usernameKeys.has(existingUsername) || emailKeys.has(existingEmail);
        }) ?? null;

        if (!existingUser) {
            const resolvedAgeRestriction = normalizeAgeRestriction(ageRestriction);
            const createdUser = await createUser({
                username: normalizedUsername,
                email: normalizedEmail,
                password,
                roles: resolvedRoles,
                libraries: resolvedLibraries,
                ageRestriction: resolvedAgeRestriction,
            });

            return {
                ...createdUser,
                created: true,
            };
        }

        const conflictingUser = users.find(user => {
            if (String(user?.id) === String(existingUser.id)) {
                return false;
            }

            const existingUsername = normalizeString(user?.username).toLowerCase();
            const existingEmail = normalizeString(user?.email).toLowerCase();
            return existingUsername === normalizedUsername.toLowerCase() || existingEmail === normalizedEmail.toLowerCase();
        });
        if (conflictingUser) {
            throw buildValidationError('A Kavita user already exists with that username or email.', 409);
        }

        const resolvedAgeRestriction = ageRestriction == null
            ? normalizeAgeRestriction(existingUser?.ageRestriction ?? existingUser?.AgeRestriction)
            : normalizeAgeRestriction(ageRestriction);
        await updateUser({
            userId: existingUser.id,
            username: normalizedUsername,
            email: normalizedEmail,
            roles: resolvedRoles,
            libraries: resolvedLibraries,
            ageRestriction: resolvedAgeRestriction,
        });

        let passwordUpdated = true;
        try {
            await resetUserPassword({
                username: normalizedUsername,
                password,
                oldPassword: normalizeString(oldPassword) || undefined,
            });
        } catch (error) {
            const status = Number(error?.status);
            const message = normalizeString(error?.message).toLowerCase();
            const canSkipReset =
                (status === 400 || status === 500)
                && (
                    message.includes('providedpassword')
                    || message.includes('password-required')
                    || message.includes('password required')
                );

            if (!canSkipReset) {
                throw error;
            }

            passwordUpdated = false;
            log(`[Portal/Kavita] Skipped password reset for ${normalizedUsername}; continuing Noona handoff with existing account password.`);
        }

        log(`[Portal/Kavita] Updated user ${normalizedUsername}.`);
        return {
            id: existingUser.id,
            username: normalizedUsername,
            email: normalizedEmail,
            roles: resolvedRoles,
            libraries: resolvedLibraries,
            created: false,
            passwordUpdated,
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
            ageRestriction: user?.ageRestriction ?? user?.AgeRestriction ?? null,
        });
    };

    return {
        getBaseUrl: () => normalizedBaseUrl,
        request,
        createUser,
        createOrUpdateUser,
        fetchRoles,
        fetchUsers,
        fetchLibraries,
        fetchUser,
        searchTitles,
        fetchSeriesMetadataStatus,
        fetchSeriesMetadataMatches,
        applySeriesMetadataMatch,
        setSeriesCover,
        ensureLibrary,
        updateLibrary,
        scanLibrary,
        inviteUser,
        updateUser,
        resetUserPassword,
        assignLibraries,
    };
};

export default createKavitaClient;
