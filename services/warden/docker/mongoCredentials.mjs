import {
    __testables__ as serviceAuthTestables,
    buildServiceTokenRegistry,
    generateServiceToken,
} from './serviceAuthRegistry.mjs';

const DEFAULT_MANAGED_MONGO_ROOT_USERNAME = 'root';
const MONGO_CREDENTIAL_NAMESPACE = 'mongo-root-password';
const MONGO_CREDENTIAL_KEY = 'noona-mongo-root';

const generatedPasswordCache = serviceAuthTestables.namespaceCaches.get(MONGO_CREDENTIAL_NAMESPACE)
    || (() => {
        const cache = new Map();
        serviceAuthTestables.namespaceCaches.set(MONGO_CREDENTIAL_NAMESPACE, cache);
        return cache;
    })();

const sanitizeString = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
};

export const __testables__ = {
    ...serviceAuthTestables,
    generatedPasswordCache,
    sanitizeString,
};

export function resolveManagedMongoRootUsername(env = process.env) {
    return sanitizeString(env?.MONGO_INITDB_ROOT_USERNAME) || DEFAULT_MANAGED_MONGO_ROOT_USERNAME;
}

export function resolveManagedMongoRootPassword(options = {}) {
    const env = options?.env ?? process.env;
    const explicitPassword =
        sanitizeString(env?.MONGO_INITDB_ROOT_PASSWORD)
        || sanitizeString(env?.NOONA_MONGO_ROOT_PASSWORD);
    if (explicitPassword) {
        return explicitPassword;
    }

    const registry = buildServiceTokenRegistry([MONGO_CREDENTIAL_KEY], {
        namespace: MONGO_CREDENTIAL_NAMESPACE,
        envKeySuffix: 'MONGO_ROOT_PASSWORD',
        cache: generatedPasswordCache,
        generator: (serviceName) => generateServiceToken(serviceName),
        ...options,
    });

    return registry[MONGO_CREDENTIAL_KEY] || generateServiceToken(MONGO_CREDENTIAL_KEY);
}

export default {
    resolveManagedMongoRootPassword,
    resolveManagedMongoRootUsername,
};
