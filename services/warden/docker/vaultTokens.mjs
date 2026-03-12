// services/warden/docker/vaultTokens.mjs
import {
    __testables__ as serviceAuthTestables,
    buildServiceTokenRegistry,
    generateServiceToken,
    normalizeServiceTokenEnvKey,
    stringifyServiceTokenMap,
} from './serviceAuthRegistry.mjs';

const generatedTokenCache = serviceAuthTestables.namespaceCaches.get('vault')
    || (() => {
        const cache = new Map();
        serviceAuthTestables.namespaceCaches.set('vault', cache);
        return cache;
    })();

const sanitizeToken = serviceAuthTestables.sanitizeToken;
const normalizeEnvKey = (name) => normalizeServiceTokenEnvKey(name, 'VAULT_TOKEN');

export const __testables__ = {
    ...serviceAuthTestables,
    sanitizeToken,
    normalizeEnvKey,
    generatedTokenCache,
};

export function generateVaultToken(name, randomBytes) {
    return generateServiceToken(name, randomBytes);
}

export function buildVaultTokenRegistry(names = [], options = {}) {
    return buildServiceTokenRegistry(names, {
        namespace: 'vault',
        envKeySuffix: 'VAULT_TOKEN',
        cache: generatedTokenCache,
        generator: (serviceName) => generateVaultToken(serviceName),
        ...options,
    });
}

export function stringifyTokenMap(tokensByService = {}) {
    return stringifyServiceTokenMap(tokensByService);
}

export default {
    buildVaultTokenRegistry,
    generateVaultToken,
    stringifyTokenMap,
};
