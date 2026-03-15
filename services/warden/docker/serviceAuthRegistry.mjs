import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const STORE_VERSION = 1;
const DEFAULT_STORE_DIRECTORY = 'warden';
const DEFAULT_STORE_FILE_NAME = 'service-auth-tokens.json';

const namespaceCaches = new Map();

const sanitizeToken = (token) => {
    if (typeof token !== 'string') {
        return '';
    }

    return token.trim();
};

const normalizeNamespace = (namespace) => {
    if (typeof namespace !== 'string') {
        return 'default';
    }

    const trimmed = namespace.trim().toLowerCase();
    return trimmed || 'default';
};

const isNodeTestProcess = () =>
    process.env.NODE_ENV === 'test'
    || process.execArgv.some((entry) => typeof entry === 'string' && entry.includes('--test'));

const resolveDefaultNoonaDataRoot = (env = process.env) => {
    const explicit = typeof env?.NOONA_DATA_ROOT === 'string' ? env.NOONA_DATA_ROOT.trim() : '';
    if (explicit) {
        return explicit;
    }

    if (process.platform === 'win32') {
        const appData = typeof env?.APPDATA === 'string' && env.APPDATA.trim()
            ? env.APPDATA.trim()
            : path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appData, 'noona');
    }

    return '/mnt/user/noona';
};

const resolveServiceAuthStorePath = ({
                                         env = process.env,
                                         cwd = process.cwd(),
                                         storePath = null,
                                     } = {}) => {
    const explicit = sanitizeToken(storePath)
        || sanitizeToken(env?.NOONA_SERVICE_AUTH_STORE_PATH)
        || sanitizeToken(env?.NOONA_AUTH_STORE_PATH);
    if (explicit) {
        return path.isAbsolute(explicit) ? explicit : path.resolve(cwd, explicit);
    }

    return path.join(resolveDefaultNoonaDataRoot(env), DEFAULT_STORE_DIRECTORY, DEFAULT_STORE_FILE_NAME);
};

const readStoreSnapshot = ({
                               fsModule = fs,
                               storePath,
                           } = {}) => {
    if (!storePath || typeof fsModule?.readFileSync !== 'function') {
        return {version: STORE_VERSION, namespaces: {}};
    }

    try {
        const raw = fsModule.readFileSync(storePath, 'utf8');
        const parsed = JSON.parse(raw);
        const namespaces = parsed?.namespaces && typeof parsed.namespaces === 'object' && !Array.isArray(parsed.namespaces)
            ? parsed.namespaces
            : {};
        return {
            version: Number.isFinite(Number(parsed?.version))
                ? Math.max(1, Math.floor(Number(parsed.version)))
                : STORE_VERSION,
            namespaces,
        };
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return {version: STORE_VERSION, namespaces: {}};
        }

        return {version: STORE_VERSION, namespaces: {}};
    }
};

const writeStoreSnapshot = ({
                                fsModule = fs,
                                storePath,
                                snapshot,
                            } = {}) => {
    if (!storePath || typeof fsModule?.writeFileSync !== 'function') {
        return false;
    }

    const directory = path.dirname(storePath);
    if (typeof fsModule?.mkdirSync === 'function') {
        fsModule.mkdirSync(directory, {recursive: true});
    }

    const normalizedSnapshot = {
        version: Number.isFinite(Number(snapshot?.version))
            ? Math.max(1, Math.floor(Number(snapshot.version)))
            : STORE_VERSION,
        namespaces:
            snapshot?.namespaces && typeof snapshot.namespaces === 'object' && !Array.isArray(snapshot.namespaces)
                ? snapshot.namespaces
                : {},
    };

    fsModule.writeFileSync(
        storePath,
        `${JSON.stringify(normalizedSnapshot, null, 2)}\n`,
        'utf8',
    );

    return true;
};

const getNamespaceCache = (namespace) => {
    const normalizedNamespace = normalizeNamespace(namespace);
    if (!namespaceCaches.has(normalizedNamespace)) {
        namespaceCaches.set(normalizedNamespace, new Map());
    }

    return namespaceCaches.get(normalizedNamespace);
};

export function normalizeServiceTokenEnvKey(name, suffix = 'TOKEN') {
    const normalizedSuffix = typeof suffix === 'string' ? suffix.trim().toUpperCase() : 'TOKEN';
    return `${String(name ?? '').replace(/-/g, '_').toUpperCase()}_${normalizedSuffix}`;
}

export function generateServiceToken(name, randomBytes = crypto.randomBytes) {
    const safeName = typeof name === 'string' ? name : 'noona';
    const prefix = safeName.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'noona';
    const trimmedPrefix = prefix.slice(0, 24);
    const entropy = randomBytes(18).toString('hex');
    return `${trimmedPrefix}-${entropy}`;
}

export function buildServiceTokenRegistry(names = [], options = {}) {
    const namespace = normalizeNamespace(options?.namespace);
    const cache = options?.cache instanceof Map ? options.cache : getNamespaceCache(namespace);
    const env = options?.env ?? process.env;
    const envKeySuffix = typeof options?.envKeySuffix === 'string' && options.envKeySuffix.trim()
        ? options.envKeySuffix.trim().toUpperCase()
        : 'TOKEN';
    const generator =
        typeof options?.generator === 'function'
            ? options.generator
            : (serviceName) => generateServiceToken(serviceName);
    const persist =
        options?.persist === true
        || (options?.persist !== false && !isNodeTestProcess());
    const storePath = resolveServiceAuthStorePath({
        env,
        cwd: options?.cwd ?? process.cwd(),
        storePath: options?.storePath ?? null,
    });
    const fsModule = options?.fsModule ?? fs;
    const snapshot = persist
        ? readStoreSnapshot({fsModule, storePath})
        : {version: STORE_VERSION, namespaces: {}};
    const storedTokens =
        snapshot.namespaces?.[namespace] && typeof snapshot.namespaces[namespace] === 'object'
            ? {...snapshot.namespaces[namespace]}
            : {};
    let snapshotChanged = false;
    const tokensByService = {};

    for (const rawName of names) {
        if (!rawName || typeof rawName !== 'string') {
            continue;
        }

        const name = rawName.trim();
        if (!name) {
            continue;
        }

        const envKey = normalizeServiceTokenEnvKey(name, envKeySuffix);
        const envToken = sanitizeToken(env?.[envKey]);
        if (envToken) {
            tokensByService[name] = envToken;
            cache.set(name, envToken);
            if (persist && storedTokens[name] !== envToken) {
                storedTokens[name] = envToken;
                snapshotChanged = true;
            }
            continue;
        }

        const storedToken = persist ? sanitizeToken(storedTokens[name]) : '';
        if (storedToken) {
            tokensByService[name] = storedToken;
            cache.set(name, storedToken);
            continue;
        }

        const cachedToken = sanitizeToken(cache.get(name));
        if (cachedToken) {
            tokensByService[name] = cachedToken;
            if (persist && storedTokens[name] !== cachedToken) {
                storedTokens[name] = cachedToken;
                snapshotChanged = true;
            }
            continue;
        }

        const generatedToken = sanitizeToken(generator(name));
        if (!generatedToken) {
            continue;
        }

        tokensByService[name] = generatedToken;
        cache.set(name, generatedToken);
        if (persist) {
            storedTokens[name] = generatedToken;
            snapshotChanged = true;
        }
    }

    if (persist && snapshotChanged) {
        const nextSnapshot = {
            ...snapshot,
            version: STORE_VERSION,
            namespaces: {
                ...(snapshot.namespaces || {}),
                [namespace]: storedTokens,
            },
        };
        writeStoreSnapshot({fsModule, storePath, snapshot: nextSnapshot});
    }

    return tokensByService;
}

export function stringifyServiceTokenMap(tokensByService = {}) {
    return Object.entries(tokensByService)
        .filter(([service, token]) => Boolean(service && sanitizeToken(token)))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([service, token]) => `${service}:${sanitizeToken(token)}`)
        .join(',');
}

export const __testables__ = {
    namespaceCaches,
    sanitizeToken,
    normalizeNamespace,
    readStoreSnapshot,
    resolveDefaultNoonaDataRoot,
    resolveServiceAuthStorePath,
    writeStoreSnapshot,
};

export default {
    buildServiceTokenRegistry,
    generateServiceToken,
    normalizeServiceTokenEnvKey,
    stringifyServiceTokenMap,
};
