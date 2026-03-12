import {
    __testables__ as serviceAuthTestables,
    buildServiceTokenRegistry,
    generateServiceToken,
    normalizeServiceTokenEnvKey,
    stringifyServiceTokenMap,
} from './serviceAuthRegistry.mjs';

const generatedTokenCache = serviceAuthTestables.namespaceCaches.get('warden')
    || (() => {
        const cache = new Map();
        serviceAuthTestables.namespaceCaches.set('warden', cache);
        return cache;
    })();

const normalizeEnvKey = (name) => normalizeServiceTokenEnvKey(name, 'WARDEN_API_TOKEN');

export const __testables__ = {
    ...serviceAuthTestables,
    generatedTokenCache,
    normalizeEnvKey,
};

export function generateWardenApiToken(name, randomBytes) {
    return generateServiceToken(name, randomBytes);
}

export function buildWardenApiTokenRegistry(names = [], options = {}) {
    return buildServiceTokenRegistry(names, {
        namespace: 'warden',
        envKeySuffix: 'WARDEN_API_TOKEN',
        cache: generatedTokenCache,
        generator: (serviceName) => generateWardenApiToken(serviceName),
        ...options,
    });
}

export {stringifyServiceTokenMap};

export default {
    buildWardenApiTokenRegistry,
    generateWardenApiToken,
    stringifyServiceTokenMap,
};
