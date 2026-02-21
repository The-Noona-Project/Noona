// services/vault/shared/vaultApp.mjs
import express from 'express';

let cachedHandlePacket = null;

async function getDefaultHandlePacket() {
    if (!cachedHandlePacket) {
        const module = await import('../../../utilities/database/packetParser.mjs');
        cachedHandlePacket = module.handlePacket;
    }

    return cachedHandlePacket;
}

const fallbackLogger = {
    log: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    debug: (...args) => (console.debug ? console.debug(...args) : console.log(...args)),
};

export function parseTokenMap(tokenMapString = '') {
    const tokenPairs = tokenMapString
        .split(',')
        .map(pair => pair.trim())
        .filter(Boolean)
        .map(pair => {
            const [service, token] = pair.split(':');
            return [service?.trim(), token?.trim()];
        })
        .filter(([service, token]) => Boolean(service && token));

    const tokensByService = Object.fromEntries(tokenPairs);
    const serviceByToken = Object.fromEntries(
        tokenPairs.map(([service, token]) => [token, service])
    );

    return { tokenPairs, tokensByService, serviceByToken };
}

export function extractBearerToken(req) {
    const authHeader = req.headers?.authorization || '';
    if (typeof authHeader !== 'string') return null;

    const [scheme, token] = authHeader.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
        return null;
    }

    return token.trim();
}

export function createRequireAuth({ serviceByToken = {}, debug = fallbackLogger.debug } = {}) {
    return function requireAuth(req, res, next) {
        const token = extractBearerToken(req);
        if (!token) {
            return res
                .status(401)
                .json({ error: 'Missing or invalid Authorization header' });
        }

        const serviceName = serviceByToken[token];
        if (!serviceName) {
            debug(`[Vault] ❌ Unknown token presented: ${token.slice(0, 6)}***`);
            return res.status(401).json({ error: 'Unauthorized service token' });
        }

        req.serviceName = serviceName;
        next();
    };
}

export function createVaultApp(options = {}) {
    const {
        env = process.env,
        handlePacket,
        expressFactory = express,
        logger: loggerOption = {},
        log,
        warn,
        debug,
    } = options;

    const logger = {
        ...fallbackLogger,
        ...loggerOption,
    };

    if (typeof log === 'function') {
        logger.log = log;
    }

    if (typeof warn === 'function') {
        logger.warn = warn;
    }

    if (typeof debug === 'function') {
        logger.debug = debug;
    }

    const { tokenPairs, tokensByService, serviceByToken } = parseTokenMap(
        env.VAULT_TOKEN_MAP || ''
    );

    if (!tokenPairs.length) {
        logger.warn('[Vault] ⚠️ No service tokens were loaded. Protected routes will reject all requests.');
    } else {
        const serviceList = tokenPairs.map(([service]) => service).join(', ');
        logger.log(`[Vault] Loaded API tokens for: ${serviceList}`);
    }

    const app = expressFactory();
    app.use(express.json());

    const requireAuth = createRequireAuth({ serviceByToken, debug: logger.debug });

    const resolvePacketHandler = async () => {
        if (handlePacket) {
            return handlePacket;
        }

        return await getDefaultHandlePacket();
    };

    app.get('/v1/vault/health', (req, res) => {
        res.send('Vault is up and running');
    });

    app.post('/v1/vault/handle', requireAuth, async (req, res) => {
        const packet = req.body;

        logger.debug(`[Vault] Handling packet from ${req.serviceName}`);
        const handler = await resolvePacketHandler();

        const result = await handler(packet);
        if (result?.error) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result ?? {});
    });

    const SECRETS_COLLECTION = env.VAULT_SECRETS_COLLECTION || 'vault_secrets';

    app.get('/api/secrets/:path', requireAuth, async (req, res) => {
        const rawPath = typeof req.params?.path === 'string' ? req.params.path.trim() : '';
        if (!rawPath) {
            res.status(400).json({error: 'path is required.'});
            return;
        }

        const handler = await resolvePacketHandler();
        const packet = {
            storageType: 'mongo',
            operation: 'find',
            payload: {
                collection: SECRETS_COLLECTION,
                query: {path: rawPath},
            },
        };

        const result = await handler(packet);
        if (result?.error) {
            const message = String(result.error || '');
            if (message.toLowerCase().includes('no document found')) {
                res.status(404).json({error: 'Secret not found.'});
                return;
            }

            res.status(500).json({error: message || 'Unable to read secret.'});
            return;
        }

        const doc = result?.data;
        if (!doc || typeof doc !== 'object' || !Object.prototype.hasOwnProperty.call(doc, 'secret')) {
            res.status(404).json({error: 'Secret not found.'});
            return;
        }

        res.json(doc.secret ?? null);
    });

    app.put('/api/secrets/:path', requireAuth, async (req, res) => {
        const rawPath = typeof req.params?.path === 'string' ? req.params.path.trim() : '';
        if (!rawPath) {
            res.status(400).json({error: 'path is required.'});
            return;
        }

        if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'secret')) {
            res.status(400).json({error: 'secret is required.'});
            return;
        }

        const now = new Date().toISOString();
        const secret = req.body.secret;
        const handler = await resolvePacketHandler();

        const packet = {
            storageType: 'mongo',
            operation: 'update',
            payload: {
                collection: SECRETS_COLLECTION,
                query: {path: rawPath},
                update: {
                    $set: {
                        path: rawPath,
                        secret,
                        updatedAt: now,
                        updatedBy: req.serviceName,
                    },
                    $setOnInsert: {
                        createdAt: now,
                        createdBy: req.serviceName,
                    },
                },
                upsert: true,
            },
        };

        const result = await handler(packet);
        if (result?.error) {
            res.status(500).json({error: String(result.error || 'Unable to write secret.')});
            return;
        }

        res.json({ok: true});
    });

    app.delete('/api/secrets/:path', requireAuth, async (req, res) => {
        const rawPath = typeof req.params?.path === 'string' ? req.params.path.trim() : '';
        if (!rawPath) {
            res.status(400).json({error: 'path is required.'});
            return;
        }

        const handler = await resolvePacketHandler();
        const packet = {
            storageType: 'mongo',
            operation: 'delete',
            payload: {
                collection: SECRETS_COLLECTION,
                query: {path: rawPath},
            },
        };

        const result = await handler(packet);
        if (result?.error) {
            res.status(500).json({error: String(result.error || 'Unable to delete secret.')});
            return;
        }

        res.json({deleted: Number(result?.deleted) > 0});
    });

    const port = env.PORT || 3005;

    return {
        app,
        port,
        requireAuth,
        tokensByService,
        serviceByToken,
        logger,
    };
}

export default createVaultApp;
