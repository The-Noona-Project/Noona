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

    app.get('/v1/vault/health', (req, res) => {
        res.send('Vault is up and running');
    });

    app.post('/v1/vault/handle', requireAuth, async (req, res) => {
        const packet = req.body;

        logger.debug(`[Vault] Handling packet from ${req.serviceName}`);
        let handler = handlePacket;

        if (!handler) {
            handler = await getDefaultHandlePacket();
        }

        const result = await handler(packet);
        if (result?.error) {
            return res.status(400).json({ error: result.error });
        }

        res.json(result ?? {});
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
