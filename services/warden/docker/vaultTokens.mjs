// services/warden/docker/vaultTokens.mjs
import crypto from 'node:crypto';

const DEFAULT_TOKENS = {
    'noona-sage': 'noona-sage-dev-token',
    'noona-moon': 'noona-moon-dev-token',
    'noona-oracle': 'noona-oracle-dev-token',
    'noona-raven': 'noona-raven-dev-token',
    'noona-portal': 'noona-portal-dev-token',
    'noona-vault': 'noona-vault-dev-token',
};

const sanitizeToken = (token) => {
    if (typeof token !== 'string') {
        return '';
    }

    return token.trim();
};

const normalizeEnvKey = (name) =>
    `${name.replace(/-/g, '_').toUpperCase()}_VAULT_TOKEN`;

export const __testables__ = {
    sanitizeToken,
    normalizeEnvKey,
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
        defaults = DEFAULT_TOKENS,
        generator = (serviceName) => generateVaultToken(serviceName),
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
            continue;
        }

        const defaultToken = sanitizeToken(defaults?.[name]);
        if (defaultToken) {
            tokensByService[name] = defaultToken;
            continue;
        }

        tokensByService[name] = generator(name);
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
