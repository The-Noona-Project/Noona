// services/warden/docker/vaultTokens.mjs
import crypto from 'node:crypto';

const sanitizeToken = (token) => {
    if (typeof token !== 'string') {
        return '';
    }

    return token.trim();
};

const normalizeEnvKey = (name) =>
    `${name.replace(/-/g, '_').toUpperCase()}_VAULT_TOKEN`;

const generatedTokenCache = new Map();

export const __testables__ = {
    sanitizeToken,
    normalizeEnvKey,
    generatedTokenCache,
};

export function generateVaultToken(name, randomBytes = crypto.randomBytes) {
    const safeName = typeof name === 'string' ? name : 'noona';
    const prefix = safeName.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'noona';
    const trimmedPrefix = prefix.slice(0, 24);
    const entropy = randomBytes(18).toString('hex');
    return `${trimmedPrefix}-${entropy}`;
}

export function buildVaultTokenRegistry(names = [], options = {}) {
    const {
        env = process.env,
        generator = (serviceName) => generateVaultToken(serviceName),
        cache = generatedTokenCache,
    } = options;

    const tokensByService = {};

    for (const rawName of names) {
        if (!rawName || typeof rawName !== 'string') {
            continue;
        }

        const name = rawName.trim();
        if (!name) {
            continue;
        }

        const envKey = normalizeEnvKey(name);
        const envToken = sanitizeToken(env?.[envKey]);

        if (envToken) {
            tokensByService[name] = envToken;
            cache?.set?.(name, envToken);
            continue;
        }

        const cachedToken = sanitizeToken(cache?.get?.(name));
        if (cachedToken) {
            tokensByService[name] = cachedToken;
            continue;
        }

        const generatedToken = sanitizeToken(generator(name));
        if (generatedToken) {
            cache?.set?.(name, generatedToken);
            tokensByService[name] = generatedToken;
        }
    }

    return tokensByService;
}

export function stringifyTokenMap(tokensByService = {}) {
    return Object.entries(tokensByService)
        .filter(([service, token]) => Boolean(service && sanitizeToken(token)))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([service, token]) => `${service}:${sanitizeToken(token)}`)
        .join(',');
}

export default {
    buildVaultTokenRegistry,
    generateVaultToken,
    stringifyTokenMap,
};
