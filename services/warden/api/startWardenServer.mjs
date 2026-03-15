// services/warden/api/startWardenServer.mjs
import http from 'node:http';
import {URL} from 'node:url';

import {isWardenHttpError} from '../core/wardenErrors.mjs';
import {normalizeSetupProfileSnapshot, toPublicSetupSnapshot} from '../core/setupProfile.mjs';
import {buildWardenApiTokenRegistry, stringifyServiceTokenMap} from '../docker/wardenApiTokens.mjs';
import {errMSG, log, warn} from '../../../utilities/etc/logger.mjs';

const SENSITIVE_ENV_PLACEHOLDER = '********';
const DEFAULT_WARDEN_API_CLIENTS = Object.freeze(['noona-sage', 'noona-portal']);
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_HEADERS_TIMEOUT_MS = 15000;
const defaultPort = (env = process.env) => Number.parseInt(env.WARDEN_API_PORT ?? '4001', 10);

const DEFAULT_HEADERS = Object.freeze({
    'Content-Type': 'application/json',
});
const OPTIONS_HEADERS = Object.freeze({
    Allow: 'GET,POST,PUT,DELETE,OPTIONS',
});

const resolveLogger = (overrides = {}) => ({
    error: errMSG,
    log,
    warn,
    ...overrides,
});

const sendJson = (res, statusCode, payload) => {
    res.writeHead(statusCode, {
        ...DEFAULT_HEADERS,
        'Content-Type': 'application/json',
    });
    res.end(JSON.stringify(payload));
};

const parseDebugValue = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value > 0;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return null;
        }

        if (['1', 'true', 'yes', 'on', 'super'].includes(normalized)) {
            return true;
        }

        if (['0', 'false', 'no', 'off'].includes(normalized)) {
            return false;
        }
    }

    return null;
};

const parseTruthyQueryValue = (value) => {
    if (typeof value !== 'string') {
        return false;
    }

    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const readDebugState = (warden) => {
    if (typeof warden?.getDebug === 'function') {
        const payload = warden.getDebug();
        if (payload && typeof payload === 'object') {
            return payload;
        }
    }

    const parsed = parseDebugValue(warden?.DEBUG);
    const enabled =
        typeof warden?.isDebugEnabled === 'function'
            ? warden.isDebugEnabled() === true
            : parsed === true;

    return {
        enabled,
        value: enabled ? 'true' : 'false',
    };
};

class PayloadTooLargeError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PayloadTooLargeError';
        this.statusCode = 413;
    }
}

const normalizePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseJsonBody = (req, {maxBytes = DEFAULT_MAX_BODY_BYTES} = {}) => new Promise((resolve, reject) => {
    const chunks = [];
    const contentLength = Number.parseInt(String(req.headers?.['content-length'] ?? ''), 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        reject(new PayloadTooLargeError(`Request body exceeds the ${maxBytes} byte limit.`));
        return;
    }

    let totalBytes = 0;
    let rejected = false;

    req.on('data', (chunk) => {
        if (rejected) {
            return;
        }

        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
            rejected = true;
            reject(new PayloadTooLargeError(`Request body exceeds the ${maxBytes} byte limit.`));
            return;
        }

        chunks.push(chunk);
    });

    req.on('end', () => {
        if (rejected) {
            return;
        }

        if (chunks.length === 0) {
            resolve(null);
            return;
        }

        try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(parsed);
        } catch (error) {
            reject(error);
        }
    });

    req.on('error', (error) => {
        if (!rejected) {
            reject(error);
        }
    });
});

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
};

const parseTokenMap = (tokenMapString = '') => {
    const tokenPairs = tokenMapString
        .split(',')
        .map((pair) => pair.trim())
        .filter(Boolean)
        .map((pair) => {
            const [serviceName, token] = pair.split(':');
            return [serviceName?.trim(), token?.trim()];
        })
        .filter(([serviceName, token]) => Boolean(serviceName && token));

    return {
        tokenPairs,
        serviceByToken: Object.fromEntries(tokenPairs.map(([serviceName, token]) => [token, serviceName])),
    };
};

const resolveWardenTokenMap = (env = process.env) => {
    const configuredTokenMap = normalizeString(env?.WARDEN_API_TOKEN_MAP);
    if (configuredTokenMap) {
        return configuredTokenMap;
    }

    return stringifyServiceTokenMap(buildWardenApiTokenRegistry(DEFAULT_WARDEN_API_CLIENTS));
};

const extractBearerToken = (req) => {
    const authorization = req.headers?.authorization;
    if (typeof authorization !== 'string') {
        return null;
    }

    const [scheme, token] = authorization.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
        return null;
    }

    return token.trim();
};

const isSecretLikeEnvKey = (key) => /TOKEN|PASSWORD|API_KEY|SECRET|PRIVATE_KEY|MONGO_URI/i.test(key);

const buildEnvFieldMap = (envConfig = []) => {
    const map = new Map();

    for (const field of Array.isArray(envConfig) ? envConfig : []) {
        const key = normalizeString(field?.key);
        if (!key) {
            continue;
        }

        map.set(key, field);
    }

    return map;
};

const isConfiguredEnvValue = (value) => normalizeString(value).length > 0;

const redactEnvValue = (key, value, field) => {
    const normalizedValue = value == null ? '' : String(value);
    if (!(field?.sensitive === true || isSecretLikeEnvKey(key))) {
        return normalizedValue;
    }

    return isConfiguredEnvValue(normalizedValue) ? SENSITIVE_ENV_PLACEHOLDER : '';
};

const redactEnvMap = (env, envConfig = []) => {
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
        return {};
    }

    const fieldMap = buildEnvFieldMap(envConfig);
    const redacted = {};

    for (const [key, value] of Object.entries(env)) {
        const normalizedKey = normalizeString(key);
        if (!normalizedKey) {
            continue;
        }

        redacted[normalizedKey] = redactEnvValue(normalizedKey, value, fieldMap.get(normalizedKey));
    }

    return redacted;
};

const redactEnvConfig = (envConfig = [], envValues = {}) => {
    const values = envValues && typeof envValues === 'object' && !Array.isArray(envValues) ? envValues : {};

    return (Array.isArray(envConfig) ? envConfig : []).map((field) => {
        const key = normalizeString(field?.key);
        if (!key) {
            return field;
        }

        if (!(field?.sensitive === true || isSecretLikeEnvKey(key))) {
            return field;
        }

        const currentValue = Object.prototype.hasOwnProperty.call(values, key)
            ? values[key]
            : field?.defaultValue;

        return {
            ...field,
            defaultValue: redactEnvValue(key, currentValue, field),
            configured: isConfiguredEnvValue(currentValue),
        };
    });
};

const redactServiceConfig = (config = {}) => {
    const envConfig = Array.isArray(config?.envConfig) ? config.envConfig : [];
    const env = redactEnvMap(config?.env, envConfig);
    const runtimeEnv = redactEnvMap(config?.runtimeConfig?.env, envConfig);

    return {
        ...config,
        env,
        envConfig: redactEnvConfig(envConfig, config?.env),
        runtimeConfig: {
            hostPort: config?.runtimeConfig?.hostPort ?? null,
            env: runtimeEnv,
        },
    };
};

const redactServiceList = (services = []) =>
    (Array.isArray(services) ? services : []).map((service) => ({
        ...service,
        envConfig: redactEnvConfig(service?.envConfig, {}),
    }));

const resolveServiceConfigForSecurity = (warden, serviceName, cache = new Map()) => {
    const normalizedName = normalizeString(serviceName);
    if (!normalizedName) {
        return null;
    }

    if (cache.has(normalizedName)) {
        return cache.get(normalizedName);
    }

    try {
        const config = typeof warden?.getServiceConfig === 'function'
            ? warden.getServiceConfig(normalizedName)
            : null;
        cache.set(normalizedName, config ?? null);
    } catch {
        cache.set(normalizedName, null);
    }

    return cache.get(normalizedName);
};

const redactSetupSnapshot = (snapshot, warden, cache = new Map()) => {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return snapshot ?? null;
    }

    const publicSnapshot = toPublicSetupSnapshot(snapshot, {maskSecrets: true});
    if (publicSnapshot) {
        return publicSnapshot;
    }

    const values = {};
    const rawValues = snapshot?.values;

    if (rawValues && typeof rawValues === 'object' && !Array.isArray(rawValues)) {
        for (const [serviceName, env] of Object.entries(rawValues)) {
            const serviceConfig = resolveServiceConfigForSecurity(warden, serviceName, cache);
            values[serviceName] = redactEnvMap(env, serviceConfig?.envConfig);
        }
    }

    return {
        ...snapshot,
        values,
    };
};

const redactSetupConfigResponse = (payload, warden) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return payload ?? null;
    }

    const cache = new Map();
    const runtime = Array.isArray(payload?.runtime)
        ? payload.runtime.map((entry) => {
            const serviceName = normalizeString(entry?.service);
            const serviceConfig = resolveServiceConfigForSecurity(warden, serviceName, cache);
            return {
                ...entry,
                env: redactEnvMap(entry?.env, serviceConfig?.envConfig),
            };
        })
        : payload?.runtime ?? null;

    return {
        ...payload,
        snapshot: redactSetupSnapshot(payload?.snapshot, warden, cache),
        ...(payload?.runtime !== undefined ? {runtime} : {}),
    };
};

const sanitizeSetupSnapshotEnvMap = (candidate, {envConfig = [], currentEnv = {}, currentSnapshotEnv = {}} = {}) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return {};
    }

    const fieldMap = buildEnvFieldMap(envConfig);
    const sanitized = {};

    for (const [rawKey, rawValue] of Object.entries(candidate)) {
        const key = normalizeString(rawKey);
        if (!key) {
            continue;
        }

        const field = fieldMap.get(key);
        if (!field) {
            continue;
        }

        if (field.serverManaged === true || field.readOnly === true) {
            continue;
        }

        const incomingValue = rawValue == null ? '' : String(rawValue);
        if (field.sensitive === true && incomingValue === SENSITIVE_ENV_PLACEHOLDER) {
            const currentValue = Object.prototype.hasOwnProperty.call(currentSnapshotEnv, key)
                ? currentSnapshotEnv[key]
                : currentEnv[key];
            sanitized[key] = currentValue == null ? '' : String(currentValue);
            continue;
        }

        sanitized[key] = incomingValue;
    }

    return sanitized;
};

const sanitizeSetupConfigPayload = (payload, warden) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return payload;
    }

    const currentSetupConfig = typeof warden?.getSetupConfig === 'function'
        ? warden.getSetupConfig({refresh: true})
        : null;
    const currentSnapshotValues =
        currentSetupConfig?.snapshot?.values && typeof currentSetupConfig.snapshot.values === 'object'
            ? currentSetupConfig.snapshot.values
            : {};
    const configCache = new Map();
    const rawValues = payload?.values;

    if (!rawValues || typeof rawValues !== 'object' || Array.isArray(rawValues)) {
        return payload;
    }

    const values = {};
    for (const [serviceName, env] of Object.entries(rawValues)) {
        const serviceConfig = resolveServiceConfigForSecurity(warden, serviceName, configCache);
        if (!serviceConfig) {
            continue;
        }

        values[serviceName] = sanitizeSetupSnapshotEnvMap(env, {
            envConfig: serviceConfig.envConfig,
            currentEnv: serviceConfig.env,
            currentSnapshotEnv:
                currentSnapshotValues?.[serviceName] && typeof currentSnapshotValues[serviceName] === 'object'
                    ? currentSnapshotValues[serviceName]
                    : {},
        });
    }

    return {
        ...payload,
        values,
    };
};

const buildErrorPayload = (error, fallbackMessage) => {
    if (error?.payload && typeof error.payload === 'object' && !Array.isArray(error.payload)) {
        return error.payload;
    }

    return {
        error:
            error instanceof Error && normalizeString(error.message)
                ? error.message
                : fallbackMessage,
    };
};

const sendMappedError = (res, error, fallbackStatusCode, fallbackMessage) => {
    if (error instanceof PayloadTooLargeError || error?.statusCode === 413) {
        sendJson(res, 413, buildErrorPayload(error, fallbackMessage));
        return;
    }

    if (isWardenHttpError(error)) {
        sendJson(res, error.statusCode, buildErrorPayload(error, fallbackMessage));
        return;
    }

    sendJson(res, fallbackStatusCode, buildErrorPayload(error, fallbackMessage));
};

const isPublicRoute = (method, pathname) => method === 'GET' && pathname === '/health';

const isAllowedPortalRoute = (method, pathname, segments = []) =>
    (method === 'GET' && pathname === '/api/services')
    || (method === 'GET' && pathname === '/api/services/install/progress')
    || (
        method === 'GET'
        && segments.length === 4
        && segments[0] === 'api'
        && segments[1] === 'services'
        && segments[3] === 'logs'
    );

const isAuthorizedServiceRoute = (serviceName, method, pathname, segments = []) => {
    if (serviceName === 'noona-sage') {
        return true;
    }

    if (serviceName === 'noona-portal') {
        return isAllowedPortalRoute(method, pathname, segments);
    }

    return false;
};

export const startWardenServer = ({
                                      warden,
                                      port: portOption,
                                      host,
                                      env = process.env,
                                      logger: loggerOverrides,
                                  } = {}) => {
    if (!warden) {
        throw new Error('Warden instance is required to start the API server.');
    }

    const logger = resolveLogger(loggerOverrides);
    const port = portOption ?? defaultPort(env);
    const listenHost = normalizeString(host) || normalizeString(env?.WARDEN_API_HOST) || undefined;
    const maxBodyBytes = normalizePositiveInteger(env?.WARDEN_API_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
    const requestTimeoutMs = normalizePositiveInteger(env?.WARDEN_API_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
    const headersTimeoutMs = normalizePositiveInteger(env?.WARDEN_API_HEADERS_TIMEOUT_MS, DEFAULT_HEADERS_TIMEOUT_MS);
    let activeInstallPromise = null;
    const {tokenPairs, serviceByToken} = parseTokenMap(resolveWardenTokenMap(env));

    if (tokenPairs.length === 0) {
        logger.warn?.('[Warden API] No service tokens were loaded. Protected routes will reject all requests.');
    } else {
        logger.log?.(`[Warden API] Loaded service tokens for: ${tokenPairs.map(([serviceName]) => serviceName).join(', ')}`);
    }

    const server = http.createServer(async (req, res) => {
        if (!req.url) {
            sendJson(res, 400, {error: 'Invalid request URL.'});
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
        const segments = url.pathname.split('/').filter(Boolean);

        if (req.method === 'OPTIONS') {
            res.writeHead(204, OPTIONS_HEADERS);
            res.end();
            return;
        }

        if (isPublicRoute(req.method, url.pathname)) {
            sendJson(res, 200, {status: 'ok'});
            return;
        }

        const token = extractBearerToken(req);
        if (!token) {
            res.writeHead(401, {
                ...DEFAULT_HEADERS,
                'WWW-Authenticate': 'Bearer',
            });
            res.end(JSON.stringify({error: 'Missing or invalid Authorization header.'}));
            return;
        }

        const requesterServiceName = serviceByToken[token];
        if (!requesterServiceName) {
            logger.warn?.('[Warden API] Rejected request with an unknown service token.');
            sendJson(res, 401, {error: 'Unauthorized service token.'});
            return;
        }

        if (!isAuthorizedServiceRoute(requesterServiceName, req.method, url.pathname, segments)) {
            logger.warn?.(`[Warden API] ${requesterServiceName} is not allowed to access ${req.method} ${url.pathname}`);
            sendJson(res, 403, {error: 'Forbidden for this service identity.'});
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/debug') {
            sendJson(res, 200, readDebugState(warden));
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/debug') {
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            const enabled = parseDebugValue(body?.enabled);
            if (enabled == null) {
                sendJson(res, 400, {error: 'enabled must be a boolean value.'});
                return;
            }

            try {
                const result = await warden.setDebug?.(enabled);
                if (result && typeof result === 'object') {
                    sendJson(res, 200, result);
                    return;
                }

                sendJson(res, 200, readDebugState(warden));
            } catch (error) {
                logger.error?.(`[Warden API] Failed to update debug mode: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to update debug mode.'});
            }
            return;
        }

        if (
            req.method === 'GET' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[2] === 'install' &&
            segments[3] === 'progress'
        ) {
            try {
                const progress = await warden.getInstallationProgress?.();
                if (!progress) {
                    sendJson(res, 200, {items: [], status: 'idle', percent: null});
                    return;
                }

                sendJson(res, 200, progress);
            } catch (error) {
                logger.error?.(`[Warden API] Failed to fetch install progress: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to retrieve installation progress.'});
            }
            return;
        }

        if (
            req.method === 'GET' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[2] === 'installation' &&
            segments[3] === 'logs'
        ) {
            const limitParam = url.searchParams.get('limit');

            try {
                const history = await warden.getServiceHistory?.('installation', {limit: limitParam});
                if (!history) {
                    sendJson(res, 200, {
                        service: 'installation',
                        entries: [],
                        summary: {status: 'idle', percent: null, detail: null, updatedAt: null},
                    });
                    return;
                }

                sendJson(res, 200, history);
            } catch (error) {
                logger.error?.(`[Warden API] Failed to fetch installation logs: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to retrieve installation logs.'});
            }
            return;
        }

        if (
            req.method === 'GET' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[3] === 'logs'
        ) {
            const serviceName = decodeURIComponent(segments[2]);
            const limitParam = url.searchParams.get('limit');

            try {
                const history = await warden.getServiceHistory?.(serviceName, {limit: limitParam});
                if (!history) {
                    sendJson(res, 200, {
                        service: serviceName,
                        entries: [],
                        summary: {status: 'idle', percent: null, detail: null, updatedAt: null},
                    });
                    return;
                }

                sendJson(res, 200, history);
            } catch (error) {
                logger.error?.(`[Warden API] Failed to fetch logs for ${serviceName}: ${error.message}`);
                sendJson(res, 500, {error: `Unable to retrieve logs for ${serviceName}.`});
            }
            return;
        }

        if (
            req.method === 'POST' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[3] === 'test'
        ) {
            const serviceName = decodeURIComponent(segments[2]);
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            try {
                const result = await warden.testService?.(serviceName, body);

                if (!result) {
                    sendJson(res, 404, {error: `No test handler registered for ${serviceName}.`});
                    return;
                }

                const statusCode = result.supported === false ? 400 : 200;
                sendJson(res, statusCode, result);
            } catch (error) {
                logger.error?.(`[Warden API] Failed to test ${serviceName}: ${error.message}`);
                sendJson(res, 500, {error: `Unable to execute test for ${serviceName}.`});
            }
            return;
        }

        if (
            req.method === 'POST' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[2] === 'noona-raven' &&
            segments[3] === 'detect'
        ) {
            try {
                const detection = await (warden.detectKavitaMount?.() || warden.detectKavitaDataMount?.());
                sendJson(res, 200, {detection: detection ?? null});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to detect Kavita mount: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to detect Kavita data mount.'});
            }
            return;
        }

        if (
            req.method === 'GET' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[3] === 'health'
        ) {
            const serviceName = decodeURIComponent(segments[2]);
            try {
                const result = await warden.getServiceHealth?.(serviceName);
                if (!result) {
                    sendJson(res, 404, {error: `Health check not supported for ${serviceName}.`});
                    return;
                }

                sendJson(res, 200, result);
            } catch (error) {
                logger.error?.(`[Warden API] Failed to check health for ${serviceName}: ${error.message}`);
                const message = error instanceof Error ? error.message : 'Unable to retrieve service health.';
                sendJson(res, 500, {error: message});
            }
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/services') {
            try {
                const includeParam = url.searchParams.get('includeInstalled');
                const includeInstalled = includeParam
                    ? ['1', 'true', 'yes', 'all'].includes(includeParam.trim().toLowerCase())
                    : false;

                const services = await warden.listServices({includeInstalled});
                sendJson(res, 200, {services: redactServiceList(services)});
            } catch (error) {
                logger.error(`[Warden API] Failed to list services: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to list services.'});
            }
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/storage/layout') {
            try {
                const layout = await warden.getStorageLayout?.();
                sendJson(res, 200, layout ?? {root: null, services: []});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to load storage layout: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to load storage layout.'});
            }
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/setup/config') {
            try {
                const config = await warden.getSetupConfig?.();
                sendJson(res, 200, redactSetupConfigResponse(config, warden) ?? {
                    exists: false,
                    path: null,
                    snapshot: null,
                    error: null,
                });
            } catch (error) {
                logger.error?.(`[Warden API] Failed to load setup config snapshot: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to load setup config snapshot.'});
            }
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/setup/config/normalize') {
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            if (!body || typeof body !== 'object' || Array.isArray(body)) {
                sendJson(res, 400, {error: 'Setup config payload must be a JSON object.'});
                return;
            }

            try {
                const currentSetupConfig = typeof warden?.getSetupConfig === 'function'
                    ? await warden.getSetupConfig({refresh: true})
                    : null;
                const normalized = normalizeSetupProfileSnapshot(body, {
                    currentSnapshot: currentSetupConfig?.snapshot ?? null,
                });

                if (!normalized) {
                    sendJson(res, 400, {error: 'Setup config payload must be a JSON object.'});
                    return;
                }

                sendJson(res, 200, {
                    snapshot: toPublicSetupSnapshot(normalized, {maskSecrets: false}),
                });
            } catch (error) {
                logger.error?.(`[Warden API] Failed to normalize setup config snapshot: ${error.message}`);
                sendMappedError(res, error, 500, 'Unable to normalize setup config snapshot.');
            }
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/setup/config') {
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            if (!body || typeof body !== 'object' || Array.isArray(body)) {
                sendJson(res, 400, {error: 'Setup config payload must be a JSON object.'});
                return;
            }

            try {
                const applyFromQuery = parseDebugValue(url.searchParams.get('apply'));
                const applyFromBody = parseDebugValue(body?.apply);
                const persistOnly = parseDebugValue(body?.persistOnly) === true;
                const apply = persistOnly
                    ? false
                    : applyFromBody != null
                        ? applyFromBody
                        : applyFromQuery != null
                            ? applyFromQuery
                            : true;
                const payload = {...body};
                delete payload.apply;
                delete payload.persistOnly;

                const config = await warden.saveSetupConfig?.(payload, {apply});
                sendJson(res, 200, redactSetupConfigResponse(config, warden) ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to persist setup config snapshot: ${error.message}`);
                sendMappedError(res, error, 500, 'Unable to persist setup config snapshot.');
            }
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/services/install') {
            let body;

            try {
                body = await parseJsonBody(req, {maxBytes: maxBodyBytes});
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            const services = body?.services;
            const asyncRequested =
                parseTruthyQueryValue(url.searchParams.get('async'))
                || parseTruthyQueryValue(url.searchParams.get('background'))
                || body?.async === true;

            if (asyncRequested) {
                if (activeInstallPromise) {
                    const progress = await warden.getInstallationProgress?.();
                    sendJson(res, 202, {
                        accepted: true,
                        started: false,
                        alreadyRunning: true,
                        progress: progress ?? {items: [], status: 'idle', percent: null},
                    });
                    return;
                }

                const installPromise = Promise.resolve(warden.installServices(Array.isArray(services) ? services : []));
                activeInstallPromise = installPromise
                    .catch((error) => {
                        logger.error?.(`[Warden API] Background install failed: ${error.message}`);
                    })
                    .finally(() => {
                        activeInstallPromise = null;
                    });
                const progress = await warden.getInstallationProgress?.();

                sendJson(res, 202, {
                    accepted: true,
                    started: true,
                    alreadyRunning: false,
                    progress: progress ?? {items: [], status: 'idle', percent: null},
                });
                return;
            }

            try {
                const results = await warden.installServices(Array.isArray(services) ? services : []);
                const hasErrors = results.some((entry) => entry.status === 'error');
                const statusCode = hasErrors ? 207 : 200;
                sendJson(res, statusCode, {results});
            } catch (error) {
                logger.error(`[Warden API] Failed to install services: ${error.message}`);
                sendJson(res, 500, {error: 'Failed to install requested services.'});
            }
            return;
        }

        if (
            req.method === 'GET' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[3] === 'config'
        ) {
            const serviceName = decodeURIComponent(segments[2]);
            try {
                const config = await warden.getServiceConfig?.(serviceName);
                if (!config) {
                    sendJson(res, 404, {error: `Service ${serviceName} is not registered.`});
                    return;
                }

                sendJson(res, 200, redactServiceConfig(config));
            } catch (error) {
                logger.error?.(`[Warden API] Failed to load config for ${serviceName}: ${error.message}`);
                sendMappedError(res, error, 500, `Unable to retrieve configuration for ${serviceName}.`);
            }
            return;
        }

        if (
            req.method === 'PUT' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[3] === 'config'
        ) {
            const serviceName = decodeURIComponent(segments[2]);
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            try {
                const result = await warden.updateServiceConfig?.(serviceName, body);
                if (result && typeof result === 'object' && result.service && typeof result.service === 'object') {
                    sendJson(res, 200, {
                        ...result,
                        service: redactServiceConfig(result.service),
                    });
                    return;
                }

                sendJson(res, 200, result ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to update config for ${serviceName}: ${error.message}`);
                sendMappedError(res, error, 500, `Unable to update configuration for ${serviceName}.`);
            }
            return;
        }

        if (
            req.method === 'POST' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[3] === 'restart'
        ) {
            const serviceName = decodeURIComponent(segments[2]);
            try {
                const result = await warden.restartService?.(serviceName);
                sendJson(res, 200, result ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to restart ${serviceName}: ${error.message}`);
                sendJson(res, 500, {error: `Unable to restart ${serviceName}.`});
            }
            return;
        }

        if (
            req.method === 'POST' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[3] === 'update'
        ) {
            const serviceName = decodeURIComponent(segments[2]);
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            try {
                const result = await warden.updateServiceImage?.(serviceName, body);
                sendJson(res, 200, result ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to update image for ${serviceName}: ${error.message}`);
                sendJson(res, 500, {error: `Unable to update image for ${serviceName}.`});
            }
            return;
        }

        if (
            req.method === 'GET' &&
            segments.length === 3 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[2] === 'updates'
        ) {
            try {
                const updates = await warden.listServiceUpdates?.();
                sendJson(res, 200, {updates: Array.isArray(updates) ? updates : []});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to list service updates: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to retrieve service updates.'});
            }
            return;
        }

        if (
            req.method === 'POST' &&
            segments.length === 4 &&
            segments[0] === 'api' &&
            segments[1] === 'services' &&
            segments[2] === 'updates' &&
            segments[3] === 'check'
        ) {
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            const requestedServices = Array.isArray(body?.services) ? body.services : null;

            try {
                const updates = await warden.refreshServiceUpdates?.({services: requestedServices});
                sendJson(res, 200, {updates: Array.isArray(updates) ? updates : []});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to check service updates: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to check service updates.'});
            }
            return;
        }

        if (
            req.method === 'POST' &&
            segments.length === 3 &&
            segments[0] === 'api' &&
            segments[1] === 'ecosystem' &&
            segments[2] === 'start'
        ) {
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            try {
                const result = await warden.startEcosystem?.(body);
                sendJson(res, 200, result ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to start ecosystem: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to start ecosystem.'});
            }
            return;
        }

        if (
            req.method === 'POST' &&
            segments.length === 3 &&
            segments[0] === 'api' &&
            segments[1] === 'ecosystem' &&
            segments[2] === 'stop'
        ) {
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            try {
                const result = await warden.stopEcosystem?.(body);
                sendJson(res, 200, {results: Array.isArray(result) ? result : []});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to stop ecosystem: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to stop ecosystem.'});
            }
            return;
        }

        if (
            req.method === 'POST' &&
            segments.length === 3 &&
            segments[0] === 'api' &&
            segments[1] === 'ecosystem' &&
            segments[2] === 'factory-reset'
        ) {
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            if (body?.confirm !== 'FACTORY_RESET') {
                sendJson(res, 400, {error: 'Factory reset requires confirm: "FACTORY_RESET".'});
                return;
            }

            try {
                const result = await warden.factoryResetEcosystem?.(body);
                sendJson(res, 200, result ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to run ecosystem factory reset: ${error.message}`);
                sendMappedError(res, error, 500, 'Unable to run ecosystem factory reset.');
            }
            return;
        }

        if (
            req.method === 'POST' &&
            segments.length === 3 &&
            segments[0] === 'api' &&
            segments[1] === 'ecosystem' &&
            segments[2] === 'restart'
        ) {
            let body = {};

            try {
                body = (await parseJsonBody(req, {maxBytes: maxBodyBytes})) || {};
            } catch (error) {
                sendMappedError(res, error, 400, 'Request body must be valid JSON.');
                return;
            }

            try {
                const result = await warden.restartEcosystem?.(body);
                sendJson(res, 200, result ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to restart ecosystem: ${error.message}`);
                sendMappedError(res, error, 500, 'Unable to restart ecosystem.');
            }
            return;
        }

        logger.warn(`[Warden API] Route not found: ${req.method} ${url.pathname}`);
        sendJson(res, 404, {error: 'Not Found'});
    });

    server.requestTimeout = requestTimeoutMs;
    server.timeout = requestTimeoutMs;
    server.headersTimeout = Math.min(requestTimeoutMs, headersTimeoutMs);

    server.listen(port, listenHost, () => {
        logger.log(`[Warden API] Listening on port ${server.address().port}`);
    });

    return {server};
};

export default startWardenServer;
