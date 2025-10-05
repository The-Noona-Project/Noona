// services/warden/shared/wardenServer.mjs
import http from 'node:http';
import { URL } from 'node:url';

import { errMSG, log, warn } from '../../../utilities/etc/logger.mjs';

const defaultPort = () => Number.parseInt(process.env.WARDEN_API_PORT ?? '4001', 10);

const DEFAULT_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

    const server = http.createServer(async (req, res) => {
        if (!req.url) {
            sendJson(res, 400, { error: 'Invalid request URL.' });
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
            sendJson(res, 200, { status: 'ok' });
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
                    sendJson(res, 200, { items: [], status: 'idle', percent: null });
                    return;
                }

                sendJson(res, 200, progress);
            } catch (error) {
                logger.error?.(`[Warden API] Failed to fetch install progress: ${error.message}`);
                sendJson(res, 500, { error: 'Unable to retrieve installation progress.' });
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
                const history = await warden.getServiceHistory?.(serviceName, { limit: limitParam });
                if (!history) {
                    sendJson(res, 200, {
                        service: serviceName,
                        entries: [],
                        summary: { status: 'idle', percent: null, detail: null, updatedAt: null },
                    });
                    return;
                }

                sendJson(res, 200, history);
            } catch (error) {
                logger.error?.(`[Warden API] Failed to fetch logs for ${serviceName}: ${error.message}`);
                sendJson(res, 500, { error: `Unable to retrieve logs for ${serviceName}.` });
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
                sendJson(res, 400, { error: 'Request body must be valid JSON.' });
                return;
            }

            try {
                const result = await warden.testService?.(serviceName, body);

                if (!result) {
                    sendJson(res, 404, { error: `No test handler registered for ${serviceName}.` });
                    return;
                }

                const statusCode = result.supported === false ? 400 : 200;
                sendJson(res, statusCode, result);
            } catch (error) {
                logger.error?.(`[Warden API] Failed to test ${serviceName}: ${error.message}`);
                sendJson(res, 500, { error: `Unable to execute test for ${serviceName}.` });
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
                sendJson(res, 200, { detection: detection ?? null });
            } catch (error) {
                logger.error?.(`[Warden API] Failed to detect Kavita mount: ${error.message}`);
                sendJson(res, 500, { error: 'Unable to detect Kavita data mount.' });
            }
            return;
        }

        if (req.method === 'GET' && url.pathname === '/api/services') {
            try {
                const includeParam = url.searchParams.get('includeInstalled');
                const includeInstalled = includeParam
                    ? ['1', 'true', 'yes', 'all'].includes(includeParam.trim().toLowerCase())
                    : false;

                const services = await warden.listServices({ includeInstalled });
                sendJson(res, 200, { services });
            } catch (error) {
                logger.error(`[Warden API] Failed to list services: ${error.message}`);
                sendJson(res, 500, { error: 'Unable to list services.' });
            }
            return;
        }

        if (req.method === 'POST' && url.pathname === '/api/services/install') {
            let body;

            try {
                body = await parseJsonBody(req);
            } catch (error) {
                sendJson(res, 400, { error: 'Request body must be valid JSON.' });
                return;
            }

            const services = body?.services;

            if (!Array.isArray(services) || services.length === 0) {
                sendJson(res, 400, { error: 'Body must include a non-empty "services" array.' });
                return;
            }

            try {
                const results = await warden.installServices(services);
                const hasErrors = results.some((entry) => entry.status === 'error');
                const statusCode = hasErrors ? 207 : 200;
                sendJson(res, statusCode, { results });
            } catch (error) {
                logger.error(`[Warden API] Failed to install services: ${error.message}`);
                sendJson(res, 500, { error: 'Failed to install requested services.' });
            }
            return;
        }

        logger.warn(`[Warden API] Route not found: ${req.method} ${url.pathname}`);
        sendJson(res, 404, { error: 'Not Found' });
    });

    server.listen(port, () => {
        logger.log(`[Warden API] Listening on port ${server.address().port}`);
    });

    return { server };
};

export default startWardenServer;
