#!/usr/bin/env node
import express from 'express';
import { dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import dockerManager, {
    listServices,
    fetchSettings,
    updateSettings,
    build,
    start,
    stop,
    push,
    pull,
    clean,
    deleteResources
} from './dockerManager.mjs';

const DEFAULT_PORT = 4300;
const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTROL_PANEL_PATH = resolve(__dirname, 'control-panel.html');

const resolvePort = () => {
    const raw = process.env.DEPLOY_SERVER_PORT || process.env.PORT || String(DEFAULT_PORT);
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
};

const normalizeRequestedServices = (input) => {
    if (!input) {
        return undefined;
    }

    if (typeof input === 'string') {
        if (input.trim().toLowerCase() === 'all') {
            return 'all';
        }
        return input
            .split(',')
            .map((name) => name.trim().toLowerCase())
            .filter(Boolean);
    }

    if (Array.isArray(input)) {
        const normalized = input.map((name) => (typeof name === 'string' ? name.trim().toLowerCase() : name));
        if (normalized.some((name) => typeof name === 'string' && name === 'all')) {
            return 'all';
        }
        return normalized;
    }

    return undefined;
};

const normalizeContextServices = (input, availableServices = dockerManager.services) => {
    if (!input) {
        return undefined;
    }
    if (input === 'all') {
        return [...availableServices];
    }
    if (Array.isArray(input)) {
        if (input.some((name) => typeof name === 'string' && name.trim().toLowerCase() === 'all')) {
            return [...availableServices];
        }
        return input
            .map((name) => (typeof name === 'string' ? name.trim().toLowerCase() : ''))
            .filter((name) => availableServices.includes(name));
    }
    if (typeof input === 'string') {
        const normalized = input.trim().toLowerCase();
        return availableServices.includes(normalized) ? [normalized] : [];
    }
    return [];
};

const createStreamingChannel = (res, { action, context } = {}) => {
    let closed = false;

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const write = (payload) => {
        if (closed) {
            return;
        }
        const envelope = { action, ...payload };
        if (context) {
            envelope.context = context;
        }
        res.write(`${JSON.stringify(envelope)}\n`);
    };

    const reporter = {
        info: (message) => write({ type: 'log', level: 'info', message }),
        warn: (message) => write({ type: 'log', level: 'warn', message }),
        error: (message) => write({ type: 'log', level: 'error', message }),
        success: (message) => write({ type: 'log', level: 'success', message }),
        table: (data, columns) => write({ type: 'table', columns, data })
    };

    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        res.end();
    };

    res.on('close', () => {
        closed = true;
    });

    return {
        write,
        reporter,
        close,
        isClosed: () => closed
    };
};

const streamOperation = (res, { action, context, handler }) => {
    const channel = createStreamingChannel(res, { action, context });
    channel.write({ type: 'start' });

    (async () => {
        try {
            const result = await handler(channel);
            channel.write({ type: 'complete', ok: result?.ok !== false, result });
        } catch (error) {
            channel.write({
                type: 'error',
                ok: false,
                message: error?.message || 'Unexpected error',
                stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined
            });
        } finally {
            channel.close();
        }
    })();
};

const createApp = ({
    services = dockerManager.services,
    listServices: listServicesFn = listServices,
    fetchSettings: fetchSettingsFn = fetchSettings,
    updateSettings: updateSettingsFn = updateSettings,
    build: buildFn = build,
    start: startFn = start,
    stop: stopFn = stop,
    push: pushFn = push,
    pull: pullFn = pull,
    clean: cleanFn = clean,
    deleteResources: deleteResourcesFn = deleteResources
} = {}) => {
    const app = express();
    const availableServices = Array.isArray(services) ? services : dockerManager.services;

    app.use(express.json({ limit: '1mb' }));

    app.get('/health', (req, res) => {
        res.json({ ok: true });
    });

    app.get('/', (req, res, next) => {
        res.sendFile(CONTROL_PANEL_PATH, (error) => {
            if (error) {
                next(error);
            }
        });
    });

    app.get('/api/services', async (req, res) => {
        try {
            const includeStopped = req.query.includeStopped !== 'false';
            const result = await listServicesFn({
                includeContainers: true,
                includeHistory: true,
                includeStopped
            });

            const payload = {
                ok: result.ok,
                services: result.services,
                containers: result.containers || [],
                history: result.history || []
            };

            if (result.errors) {
                payload.errors = result.errors;
            }

            res.status(result.ok ? 200 : 207).json(payload);
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Unable to list services' });
        }
    });

    app.get('/api/settings', async (req, res) => {
        try {
            const result = await fetchSettingsFn();
            if (result?.ok) {
                res.json(result.settings);
                return;
            }
            res.status(500).json({ error: result?.error?.message || 'Unable to load settings' });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Unable to load settings' });
        }
    });

    app.patch('/api/settings', async (req, res) => {
        try {
            const result = await updateSettingsFn(req.body || {});
            if (result?.ok) {
                res.json(result.settings);
                return;
            }
            res.status(500).json({ error: result?.error?.message || 'Unable to update settings' });
        } catch (error) {
            res.status(500).json({ error: error?.message || 'Unable to update settings' });
        }
    });

    app.post('/api/build', (req, res) => {
        const { services: requestedServices, useNoCache = false, concurrency = {} } = req.body || {};
        const requested = normalizeRequestedServices(requestedServices);
        const context = {
            services: normalizeContextServices(requested || requestedServices, availableServices)
        };

        streamOperation(res, {
            action: 'build',
            context,
            handler: (channel) =>
                buildFn({
                    services: requested ?? requestedServices,
                    useNoCache,
                    concurrency,
                    reporter: channel.reporter,
                    onProgress: (event) => channel.write({ type: 'progress', event })
                })
        });
    });

    app.post('/api/start', (req, res) => {
        const { services: requestedServices, debugLevel, bootMode } = req.body || {};
        const requested = normalizeRequestedServices(requestedServices);
        const context = {
            services: normalizeContextServices(requested || requestedServices, availableServices),
            debugLevel,
            bootMode
        };

        streamOperation(res, {
            action: 'start',
            context,
            handler: (channel) =>
                startFn({
                    services: requested ?? requestedServices,
                    debugLevel,
                    bootMode,
                    reporter: channel.reporter,
                    onProgress: (event) => channel.write({ type: 'progress', event }),
                    onLog: (event) => channel.write({ type: 'container-log', event })
                })
        });
    });

    app.post('/api/stop', (req, res) => {
        streamOperation(res, {
            action: 'stop',
            handler: (channel) => stopFn({ reporter: channel.reporter })
        });
    });

    app.post('/api/push', (req, res) => {
        const { services: requestedServices } = req.body || {};
        const requested = normalizeRequestedServices(requestedServices);
        const context = {
            services: normalizeContextServices(requested || requestedServices, availableServices)
        };

        streamOperation(res, {
            action: 'push',
            context,
            handler: (channel) =>
                pushFn({
                    services: requested ?? requestedServices,
                    reporter: channel.reporter,
                    onProgress: (event) => channel.write({ type: 'progress', event })
                })
        });
    });

    app.post('/api/pull', (req, res) => {
        const { services: requestedServices } = req.body || {};
        const requested = normalizeRequestedServices(requestedServices);
        const context = {
            services: normalizeContextServices(requested || requestedServices, availableServices)
        };

        streamOperation(res, {
            action: 'pull',
            context,
            handler: (channel) =>
                pullFn({
                    services: requested ?? requestedServices,
                    reporter: channel.reporter,
                    onProgress: (event) => channel.write({ type: 'progress', event })
                })
        });
    });

    app.post('/api/clean', (req, res) => {
        const { services: requestedServices } = req.body || {};
        const requested = normalizeRequestedServices(requestedServices);
        const context = {
            services: normalizeContextServices(requested || requestedServices, availableServices)
        };

        streamOperation(res, {
            action: 'clean',
            context,
            handler: (channel) =>
                cleanFn({
                    services: requested ?? requestedServices,
                    reporter: channel.reporter
                })
        });
    });

    app.post('/api/delete', (req, res) => {
        const { confirm = false } = req.body || {};
        const context = { confirm: Boolean(confirm) };

        streamOperation(res, {
            action: 'delete',
            context,
            handler: (channel) =>
                deleteResourcesFn({
                    reporter: channel.reporter,
                    confirm: Boolean(confirm)
                })
        });
    });

    return app;
};

export { createApp };
export const app = createApp();

const port = resolvePort();

if (process.argv[1]) {
    const entryUrl = pathToFileURL(process.argv[1]).href;
    if (import.meta.url === entryUrl) {
        app.listen(port, () => {
            console.log(`Deployment control server listening on port ${port}`);
        });
    }
}
