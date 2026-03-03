// services/vault/auth/tokenAuth.mjs

const fallbackDebug = (...args) => (console.debug ? console.debug(...args) : console.log(...args));

export function parseTokenMap(tokenMapString = '') {
    const tokenPairs = tokenMapString
        .split(',')
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
            const [service, token] = pair.split(':');
            return [service?.trim(), token?.trim()];
        })
        .filter(([service, token]) => Boolean(service && token));

    const tokensByService = Object.fromEntries(tokenPairs);
    const serviceByToken = Object.fromEntries(tokenPairs.map(([service, token]) => [token, service]));

    return {tokenPairs, tokensByService, serviceByToken};
}

export function extractBearerToken(req) {
    const authHeader = req.headers?.authorization || '';
    if (typeof authHeader !== 'string') {
        return null;
    }

    const [scheme, token] = authHeader.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
        return null;
    }

    return token.trim();
}

export function createRequireAuth({serviceByToken = {}, debug = fallbackDebug} = {}) {
    return function requireAuth(req, res, next) {
        const token = extractBearerToken(req);
        if (!token) {
            return res.status(401).json({error: 'Missing or invalid Authorization header'});
        }

        const serviceName = serviceByToken[token];
        if (!serviceName) {
            debug(`[Vault] Unknown token presented: ${token.slice(0, 6)}***`);
            return res.status(401).json({error: 'Unauthorized service token'});
        }

        req.serviceName = serviceName;
        next();
    };
}

export default createRequireAuth;
