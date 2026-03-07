// services/warden/api/startWardenServer.mjs
import http from 'node:http';
import {URL} from 'node:url';

import {errMSG, log, warn} from '../../../utilities/etc/logger.mjs';

const defaultPort = () => Number.parseInt(process.env.WARDEN_API_PORT ?? '4001', 10);

const DEFAULT_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

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

const parseJsonBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
        chunks.push(chunk);
    });

    req.on('end', () => {
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

    req.on('error', (error) => reject(error));
});

export const startWardenServer = ({
                                      warden,
                                      port = defaultPort(),
                                      logger: loggerOverrides,
                                  } = {}) => {
    if (!warden) {
        throw new Error('Warden instance is required to start the API server.');
    }

    const logger = resolveLogger(loggerOverrides);
    let activeInstallPromise = null;

    const server = http.createServer(async (req, res) => {
        if (!req.url) {
            sendJson(res, 400, {error: 'Invalid request URL.'});
            return;
        }

        if (req.method === 'OPTIONS') {
            res.writeHead(204, DEFAULT_HEADERS);
            res.end();
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
        const segments = url.pathname.split('/').filter(Boolean);

        if (req.method === 'GET' && url.pathname === '/health') {
            sendJson(res, 200, {status: 'ok'});
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/debug') {
            sendJson(res, 200, readDebugState(warden));
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/debug') {
            let body = {};

            try {
                body = (await parseJsonBody(req)) || {};
            } catch {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
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
                body = (await parseJsonBody(req)) || {};
            } catch (error) {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
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
                sendJson(res, 200, {services});
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
                sendJson(res, 200, config ?? {
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

        if (req.method === 'POST' && url.pathname === '/api/setup/config') {
            let body = {};

            try {
                body = (await parseJsonBody(req)) || {};
            } catch {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
                return;
            }

            if (!body || typeof body !== 'object' || Array.isArray(body)) {
                sendJson(res, 400, {error: 'Setup config payload must be a JSON object.'});
                return;
            }

            try {
                const config = await warden.saveSetupConfig?.(body);
                sendJson(res, 200, config ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to persist setup config snapshot: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to persist setup config snapshot.'});
            }
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/services/install') {
            let body;

            try {
                body = await parseJsonBody(req);
            } catch (error) {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
                return;
            }

            const services = body?.services;
            const asyncRequested =
                parseTruthyQueryValue(url.searchParams.get('async'))
                || parseTruthyQueryValue(url.searchParams.get('background'))
                || body?.async === true;

            if (!Array.isArray(services) || services.length === 0) {
                sendJson(res, 400, {error: 'Body must include a non-empty "services" array.'});
                return;
            }

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

                const installPromise = Promise.resolve(warden.installServices(services));
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
                const results = await warden.installServices(services);
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

                sendJson(res, 200, config);
            } catch (error) {
                logger.error?.(`[Warden API] Failed to load config for ${serviceName}: ${error.message}`);
                sendJson(res, 500, {error: `Unable to retrieve configuration for ${serviceName}.`});
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
                body = (await parseJsonBody(req)) || {};
            } catch {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
                return;
            }

            try {
                const result = await warden.updateServiceConfig?.(serviceName, body);
                sendJson(res, 200, result ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to update config for ${serviceName}: ${error.message}`);
                sendJson(res, 500, {error: `Unable to update configuration for ${serviceName}.`});
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
                body = (await parseJsonBody(req)) || {};
            } catch {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
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
                body = (await parseJsonBody(req)) || {};
            } catch {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
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
                body = (await parseJsonBody(req)) || {};
            } catch {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
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
                body = (await parseJsonBody(req)) || {};
            } catch {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
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
                body = (await parseJsonBody(req)) || {};
            } catch {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
                return;
            }

            try {
                const result = await warden.factoryResetEcosystem?.(body);
                sendJson(res, 200, result ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to run ecosystem factory reset: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to run ecosystem factory reset.'});
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
                body = (await parseJsonBody(req)) || {};
            } catch {
                sendJson(res, 400, {error: 'Request body must be valid JSON.'});
                return;
            }

            try {
                const result = await warden.restartEcosystem?.(body);
                sendJson(res, 200, result ?? {});
            } catch (error) {
                logger.error?.(`[Warden API] Failed to restart ecosystem: ${error.message}`);
                sendJson(res, 500, {error: 'Unable to restart ecosystem.'});
            }
            return;
        }

        logger.warn(`[Warden API] Route not found: ${req.method} ${url.pathname}`);
        sendJson(res, 404, {error: 'Not Found'});
    });

    server.listen(port, () => {
        logger.log(`[Warden API] Listening on port ${server.address().port}`);
    });

    return {server};
};

export default startWardenServer;
