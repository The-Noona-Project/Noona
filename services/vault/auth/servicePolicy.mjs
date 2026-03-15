const DEFAULT_SERVICE_POLICIES = Object.freeze({
    'noona-sage': {
        admin: true,
    },
    'noona-portal': {
        secrets: {
            prefixes: ['portal/'],
        },
        mongo: {
            collections: ['portal_recommendations', 'portal_subscriptions'],
            operations: ['insert', 'find', 'findMany', 'update', 'delete'],
        },
        redis: {
            prefixes: ['portal:'],
            operations: ['set', 'get', 'del', 'rpush', 'lpop'],
        },
    },
    'noona-raven': {
        mongo: {
            collections: ['manga_library', 'raven_download_tasks', 'noona_settings'],
            operations: ['insert', 'find', 'findMany', 'update', 'delete'],
        },
        redis: {
            prefixes: ['raven:download:current-task'],
            operations: ['set', 'get', 'del'],
        },
    },
    'noona-warden': {
        mongo: {
            collections: ['noona_settings'],
            operations: ['insert', 'find', 'findMany', 'update', 'delete'],
        },
        redis: {
            prefixes: ['noona:wizard:state'],
            operations: ['set', 'get', 'del'],
        },
    },
});

const ALLOWED_PACKET_OPERATIONS = Object.freeze({
    mongo: new Set(['insert', 'find', 'findMany', 'update', 'delete', 'listCollections', 'wipe']),
    redis: new Set(['set', 'get', 'del', 'rpush', 'lpop', 'wipe']),
});

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
};

const normalizeList = (values) => Array.from(
    new Set(
        (Array.isArray(values) ? values : [])
            .map((entry) => normalizeString(entry))
            .filter(Boolean),
    ),
);

const hasAllowedPrefix = (candidate, prefixes = []) => {
    const normalizedCandidate = normalizeString(candidate);
    if (!normalizedCandidate) {
        return false;
    }

    return normalizeList(prefixes).some((prefix) =>
        normalizedCandidate === prefix || normalizedCandidate.startsWith(prefix),
    );
};

const hasAllowedValue = (candidate, values = []) => normalizeList(values).includes(normalizeString(candidate));

export const createVaultPolicyAuthorizer = ({
                                                servicePolicies = DEFAULT_SERVICE_POLICIES,
                                            } = {}) => {
    const policies = servicePolicies && typeof servicePolicies === 'object' ? servicePolicies : {};

    const getPolicy = (serviceName) => {
        const normalizedName = normalizeString(serviceName);
        if (!normalizedName) {
            return null;
        }

        return policies[normalizedName] ?? null;
    };

    const isAdmin = (serviceName) => getPolicy(serviceName)?.admin === true;

    const requireAdminCapability = (serviceName, capability) => {
        if (isAdmin(serviceName)) {
            return {ok: true};
        }

        return {ok: false, status: 403, error: `${serviceName} is not allowed to access ${capability}.`};
    };

    const canAccessUsers = (serviceName) => requireAdminCapability(serviceName, 'user routes');
    const canAccessDebug = (serviceName) => requireAdminCapability(serviceName, 'debug routes');

    const canAccessSecretPath = (serviceName, secretPath) => {
        if (isAdmin(serviceName)) {
            return {ok: true};
        }

        const policy = getPolicy(serviceName);
        const prefixes = policy?.secrets?.prefixes;
        if (hasAllowedPrefix(secretPath, prefixes)) {
            return {ok: true};
        }

        return {ok: false, status: 403, error: `${serviceName} is not allowed to access secret path "${secretPath}".`};
    };

    const canHandlePacket = (serviceName, packet = {}) => {
        if (isAdmin(serviceName)) {
            return {ok: true};
        }

        const policy = getPolicy(serviceName);
        if (!policy) {
            return {ok: false, status: 403, error: `${serviceName} does not have a Vault policy.`};
        }

        const storageType = normalizeString(packet?.storageType);
        const operation = normalizeString(packet?.operation);
        if (!storageType || !operation) {
            return {ok: false, status: 400, error: 'Vault packet must include storageType and operation.'};
        }

        if (!Object.prototype.hasOwnProperty.call(ALLOWED_PACKET_OPERATIONS, storageType)) {
            return {ok: false, status: 400, error: `Unsupported storageType "${storageType}".`};
        }

        if (!ALLOWED_PACKET_OPERATIONS[storageType].has(operation)) {
            return {ok: false, status: 400, error: `Unsupported operation "${operation}" for ${storageType}.`};
        }

        if (storageType === 'mongo') {
            if (operation === 'listCollections' || operation === 'wipe') {
                return {ok: false, status: 403, error: `${serviceName} is not allowed to run Mongo admin operations.`};
            }

            const collection = normalizeString(packet?.payload?.collection);
            if (!collection) {
                return {ok: false, status: 400, error: 'Mongo packet missing "collection".'};
            }

            if (!hasAllowedValue(collection, policy?.mongo?.collections)) {
                return {
                    ok: false,
                    status: 403,
                    error: `${serviceName} is not allowed to access Mongo collection "${collection}".`
                };
            }

            if (!hasAllowedValue(operation, policy?.mongo?.operations)) {
                return {
                    ok: false,
                    status: 403,
                    error: `${serviceName} is not allowed to run Mongo operation "${operation}".`
                };
            }

            return {ok: true};
        }

        if (operation === 'wipe') {
            return {ok: false, status: 403, error: `${serviceName} is not allowed to wipe Redis.`};
        }

        const key = normalizeString(packet?.payload?.key);
        if (!key) {
            return {ok: false, status: 400, error: 'Redis packet missing "key".'};
        }

        if (!hasAllowedValue(operation, policy?.redis?.operations)) {
            return {
                ok: false,
                status: 403,
                error: `${serviceName} is not allowed to run Redis operation "${operation}".`
            };
        }

        if (!hasAllowedPrefix(key, policy?.redis?.prefixes)) {
            return {ok: false, status: 403, error: `${serviceName} is not allowed to access Redis key "${key}".`};
        }

        return {ok: true};
    };

    return {
        canAccessDebug,
        canAccessSecretPath,
        canAccessUsers,
        canHandlePacket,
        getPolicy,
        isAdmin,
    };
};

export {DEFAULT_SERVICE_POLICIES};
export default createVaultPolicyAuthorizer;
