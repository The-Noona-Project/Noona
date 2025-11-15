#!/usr/bin/env node
import express from 'express';
import { pathToFileURL } from 'url';

import {
    SERVICES,
    buildServices,
    startServices,
    stopAllContainers,
    getDeploymentSettings,
    listManagedContainers,
    readLifecycleHistory
} from './deploy.mjs';

const DEFAULT_PORT = 4300;

const resolvePort = () => {
    const raw = process.env.DEPLOY_SERVER_PORT || process.env.PORT || String(DEFAULT_PORT);
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
};

const normalizeContextServices = input => {
    if (!input) {
        return undefined;
    }
    if (input === 'all') {
        return [...SERVICES];
    }
    if (Array.isArray(input)) {
        return input;
    }
    return [input];
};

const createStreamingChannel = (res, { action, context } = {}) => {
    let closed = false;

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const write = payload => {
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
        info: message => write({ type: 'log', level: 'info', message }),
        warn: message => write({ type: 'log', level: 'warn', message }),
        error: message => write({ type: 'log', level: 'error', message }),
        success: message => write({ type: 'log', level: 'success', message }),
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

    return { write, reporter, close, isClosed: () => closed };
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

app.get('/api/services', async (req, res) => {
    try {
        const includeStopped = req.query.includeStopped !== 'false';
        const [containers, history] = await Promise.all([
            listManagedContainers({ includeStopped }).catch(() => []),
            readLifecycleHistory().catch(() => [])
        ]);

        res.json({ services: SERVICES, containers, history });
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Unable to list services' });
    }
});

app.get('/api/settings', async (req, res) => {
    try {
        const settings = await getDeploymentSettings();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error?.message || 'Unable to load settings' });
    }
});

app.post('/api/build', (req, res) => {
    const { services, useNoCache = false, concurrency = {} } = req.body || {};
    const context = {
        services: normalizeContextServices(services)
    };

    streamOperation(res, {
        action: 'build',
        context,
        handler: channel => buildServices(services, {
            useNoCache,
            concurrency,
            reporter: channel.reporter,
            onProgress: event => channel.write({ type: 'progress', event })
        })
    });
});

app.post('/api/start', (req, res) => {
    const { services, debugLevel, bootMode } = req.body || {};
    const context = {
        services: normalizeContextServices(services),
        debugLevel,
        bootMode
    };

    streamOperation(res, {
        action: 'start',
        context,
        handler: channel => startServices(services, {
            debugLevel,
            bootMode,
            reporter: channel.reporter,
            onProgress: event => channel.write({ type: 'progress', event }),
            onLog: event => channel.write({ type: 'container-log', event })
        })
    });
});

app.post('/api/stop', (req, res) => {
    streamOperation(res, {
        action: 'stop',
        handler: channel => stopAllContainers({ reporter: channel.reporter })
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

