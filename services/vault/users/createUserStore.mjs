// services/vault/users/createUserStore.mjs

import {normalizeUsername, normalizeUsernameKey} from './userAuth.mjs';

export const createUserStore = ({resolvePacketHandler, usersCollection}) => {
    const listAuthUsers = async () => {
        const handler = await resolvePacketHandler();
        const result = await handler({
            storageType: 'mongo',
            operation: 'findMany',
            payload: {
                collection: usersCollection,
                query: {},
            },
        });

        if (result?.error) {
            throw new Error(String(result.error || 'Unable to load users.'));
        }

        if (!Array.isArray(result?.data)) {
            return [];
        }

        return result.data.filter((entry) => entry && typeof entry === 'object');
    };

    const normalizedLookupKey = (user) => {
        const fromNormalized = normalizeUsernameKey(user?.usernameNormalized);
        if (fromNormalized) {
            return fromNormalized;
        }
        return normalizeUsernameKey(user?.username);
    };

    const findUserByLookupKey = (users, lookupKey) => {
        if (!lookupKey || !Array.isArray(users)) {
            return null;
        }

        return users.find((entry) => normalizedLookupKey(entry) === lookupKey) ?? null;
    };

    const buildUserLookupQuery = (user, fallbackLookupKey = '') => {
        if (user && Object.prototype.hasOwnProperty.call(user, '_id')) {
            return {_id: user._id};
        }

        const usernameNormalized = normalizeUsernameKey(user?.usernameNormalized);
        if (usernameNormalized) {
            return {usernameNormalized};
        }

        const username = normalizeUsername(user?.username);
        if (username) {
            return {username};
        }

        if (fallbackLookupKey) {
            return {usernameNormalized: fallbackLookupKey};
        }

        return null;
    };

    const refreshNormalizedUsernameIfMissing = async (user, lookupKey, actor = 'system') => {
        if (!user || !lookupKey) {
            return user;
        }

        if (normalizeUsernameKey(user.usernameNormalized) === lookupKey) {
            return user;
        }

        const query = buildUserLookupQuery(user, lookupKey);
        if (!query) {
            return user;
        }

        const handler = await resolvePacketHandler();
        const now = new Date().toISOString();
        const result = await handler({
            storageType: 'mongo',
            operation: 'update',
            payload: {
                collection: usersCollection,
                query,
                update: {
                    $set: {
                        usernameNormalized: lookupKey,
                        updatedAt: now,
                        updatedBy: actor,
                    },
                },
            },
        });

        if (result?.error) {
            return user;
        }

        return {
            ...user,
            usernameNormalized: lookupKey,
            updatedAt: now,
            updatedBy: actor,
        };
    };

    return {
        buildUserLookupQuery,
        findUserByLookupKey,
        listAuthUsers,
        normalizedLookupKey,
        refreshNormalizedUsernameIfMissing,
    };
};

export default createUserStore;
