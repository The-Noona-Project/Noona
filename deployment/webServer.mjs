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

const normalizeContextServices = (input) => {
    if (!input) {
        return undefined;
    }
    if (input === 'all') {
        return [...dockerManager.services];
    }
    if (Array.isArray(input)) {
        if (input.some((name) => typeof name === 'string' && name.trim().toLowerCase() === 'all')) {
            return [...dockerManager.services];
        }
        return input
            .map((name) => (typeof name === 'string' ? name.trim().toLowerCase() : ''))
            .filter((name) => dockerManager.services.includes(name));
    }
    if (typeof input === 'string') {
        const normalized = input.trim().toLowerCase();
        return dockerManager.services.includes(normalized) ? [normalized] : [];
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

export const app = express();

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
        const result = await listServices({
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
        const result = await fetchSettings();
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
        const result = await updateSettings(req.body || {});
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
    const { services, useNoCache = false, concurrency = {} } = req.body || {};
    const requested = normalizeRequestedServices(services);
    const context = {
        services: normalizeContextServices(requested || services)
    };

    streamOperation(res, {
        action: 'build',
        context,
        handler: (channel) =>
            build({
                services: requested ?? services,
                useNoCache,
                concurrency,
                reporter: channel.reporter,
                onProgress: (event) => channel.write({ type: 'progress', event })
            })
    });
});

app.post('/api/start', (req, res) => {
    const { services, debugLevel, bootMode } = req.body || {};
    const requested = normalizeRequestedServices(services);
    const context = {
        services: normalizeContextServices(requested || services),
        debugLevel,
        bootMode
    };

    streamOperation(res, {
        action: 'start',
        context,
        handler: (channel) =>
            start({
                services: requested ?? services,
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
        handler: (channel) => stop({ reporter: channel.reporter })
    });
});

app.post('/api/push', (req, res) => {
    const { services } = req.body || {};
    const requested = normalizeRequestedServices(services);
    const context = {
        services: normalizeContextServices(requested || services)
    };

    streamOperation(res, {
        action: 'push',
        context,
        handler: (channel) =>
            push({
                services: requested ?? services,
                reporter: channel.reporter,
                onProgress: (event) => channel.write({ type: 'progress', event })
            })
    });
});

app.post('/api/pull', (req, res) => {
    const { services } = req.body || {};
    const requested = normalizeRequestedServices(services);
    const context = {
        services: normalizeContextServices(requested || services)
    };

    streamOperation(res, {
        action: 'pull',
        context,
        handler: (channel) =>
            pull({
                services: requested ?? services,
                reporter: channel.reporter,
                onProgress: (event) => channel.write({ type: 'progress', event })
            })
    });
});

app.post('/api/clean', (req, res) => {
    const { services } = req.body || {};
    const requested = normalizeRequestedServices(services);
    const context = {
        services: normalizeContextServices(requested || services)
    };

    streamOperation(res, {
        action: 'clean',
        context,
        handler: (channel) =>
            clean({
                services: requested ?? services,
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
            deleteResources({
                reporter: channel.reporter,
                confirm: Boolean(confirm)
            })
    });
});

const port = resolvePort();

if (process.argv[1]) {
    const entryUrl = pathToFileURL(process.argv[1]).href;
    if (import.meta.url === entryUrl) {
        app.listen(port, () => {
            console.log(`Deployment control server listening on port ${port}`);
        });
    }
}
