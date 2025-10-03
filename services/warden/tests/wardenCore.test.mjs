// services/warden/tests/wardenCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createWarden } from '../shared/wardenCore.mjs';

test('resolveHostServiceUrl prefers explicit hostServiceUrl', () => {
    const warden = createWarden({ services: { addon: {}, core: {} } });
    const service = { hostServiceUrl: 'http://custom.local' };

    assert.equal(warden.resolveHostServiceUrl(service), 'http://custom.local');
});

test('resolveHostServiceUrl falls back to HOST_SERVICE_URL and port', () => {
    const warden = createWarden({
        services: { addon: {}, core: {} },
        env: { HOST_SERVICE_URL: 'http://host.example' },
    });
    const service = { port: 8080 };

    assert.equal(warden.resolveHostServiceUrl(service), 'http://host.example:8080');
});

test('startService pulls, runs, waits, and logs when container is absent', async () => {
    const calls = [];
    const dockerUtils = {
        ensureNetwork: async () => {},
        attachSelfToNetwork: async () => {},
        containerExists: async () => false,
        pullImageIfNeeded: async (image) => {
            calls.push(['pull', image]);
        },
        runContainerWithLogs: async (service, networkName, trackedContainers, debug) => {
            trackedContainers.add(service.name);
            calls.push(['run', service.name, networkName, debug]);
        },
        waitForHealthyStatus: async (name, url) => {
            calls.push(['wait', name, url]);
        },
    };
    const logs = [];
    const warden = createWarden({
        dockerUtils,
        services: { addon: {}, core: {} },
        logger: { log: (message) => logs.push(message), warn: () => {} },
        env: { HOST_SERVICE_URL: 'http://host', DEBUG: 'true' },
    });

    const service = { name: 'noona-test', image: 'noona/test:latest', port: 1234 };
    await warden.startService(service, 'http://health.local');

    assert.deepEqual(calls, [
        ['pull', 'noona/test:latest'],
        ['run', 'noona-test', 'noona-network', 'true'],
        ['wait', 'noona-test', 'http://health.local'],
    ]);
    assert.ok(warden.trackedContainers.has('noona-test'));
    assert.ok(logs.some(line => line.includes('host_service_url: http://host:1234')));
});

test('startService skips pull and run when container already exists', async () => {
    const dockerUtils = {
        ensureNetwork: async () => {},
        attachSelfToNetwork: async () => {},
        containerExists: async () => true,
        pullImageIfNeeded: async () => {
            throw new Error('pullImageIfNeeded should not be called');
        },
        runContainerWithLogs: async () => {
            throw new Error('runContainerWithLogs should not be called');
        },
        waitForHealthyStatus: async () => {},
    };
    const logs = [];
    const warden = createWarden({
        dockerUtils,
        services: { addon: {}, core: {} },
        logger: { log: (message) => logs.push(message), warn: () => {} },
    });

    await warden.startService({ name: 'noona-test', image: 'ignored', hostServiceUrl: 'http://custom' });

    assert.ok(logs.some(line => line.includes('already running')));
    assert.ok(logs.some(line => line.includes('host_service_url: http://custom')));
});

test('listServices returns sorted metadata with host URLs', () => {
    const warden = createWarden({
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001, description: 'Cache' },
            },
            core: {
                'noona-sage': { name: 'noona-sage', image: 'sage', hostServiceUrl: 'http://custom-sage', health: 'http://health' },
                'noona-moon': { name: 'noona-moon', image: 'moon', port: 3000 },
            },
        },
        env: { HOST_SERVICE_URL: 'http://localhost' },
    });

    const services = warden.listServices();

    assert.deepEqual(services, [
        {
            name: 'noona-moon',
            category: 'core',
            image: 'moon',
            port: 3000,
            hostServiceUrl: 'http://localhost:3000',
            description: null,
            health: null,
        },
        {
            name: 'noona-redis',
            category: 'addon',
            image: 'redis',
            port: 8001,
            hostServiceUrl: 'http://localhost:8001',
            description: 'Cache',
            health: null,
        },
        {
            name: 'noona-sage',
            category: 'core',
            image: 'sage',
            port: null,
            hostServiceUrl: 'http://custom-sage',
            description: null,
            health: 'http://health',
        },
    ]);
});

test('installServices returns per-service results with errors', async () => {
    const warden = createWarden({
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001 },
            },
            core: {
                'noona-sage': { name: 'noona-sage', image: 'sage', port: 3004 },
            },
        },
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    const results = await warden.installServices(['noona-sage', 'noona-redis', 'unknown', '']);

    assert.deepEqual(results, [
        {
            name: 'noona-sage',
            category: 'core',
            status: 'installed',
            hostServiceUrl: 'http://localhost:3004',
            image: 'sage',
            port: 3004,
        },
        {
            name: 'noona-redis',
            category: 'addon',
            status: 'installed',
            hostServiceUrl: 'http://localhost:8001',
            image: 'redis',
            port: 8001,
        },
        {
            name: 'unknown',
            status: 'error',
            error: 'Service unknown is not registered with Warden.',
        },
        {
            name: '',
            status: 'error',
            error: 'Invalid service name provided.',
        },
    ]);

    assert.deepEqual(started, ['noona-sage', 'noona-redis']);
});

test('bootFull launches services in super boot order with correct health URLs', async () => {
    const dockerUtils = {
        ensureNetwork: async () => {},
        attachSelfToNetwork: async () => {},
        containerExists: async () => true,
        pullImageIfNeeded: async () => {},
        runContainerWithLogs: async () => {},
        waitForHealthyStatus: async () => {},
    };
    const warnings = [];
    const warden = createWarden({
        dockerUtils,
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis' },
            },
            core: {
                'noona-mongo': { name: 'noona-mongo', health: 'http://mongo/health' },
                'noona-sage': { name: 'noona-sage' },
                'noona-moon': { name: 'noona-moon', health: 'http://moon/health' },
                'noona-vault': { name: 'noona-vault', health: 'http://vault/health' },
                'noona-raven': { name: 'noona-raven' },
            },
        },
        logger: { log: () => {}, warn: (message) => warnings.push(message) },
    });

    const order = [];
    warden.startService = async (service, healthUrl) => {
        order.push([service.name, healthUrl]);
    };

    await warden.bootFull();

    assert.deepEqual(order, [
        ['noona-redis', 'http://noona-redis:8001/'],
        ['noona-mongo', 'http://mongo/health'],
        ['noona-sage', 'http://noona-sage:3004/health'],
        ['noona-moon', 'http://moon/health'],
        ['noona-vault', 'http://vault/health'],
        ['noona-raven', null],
    ]);
    assert.equal(warnings.length, 0);
});

test('init ensures network, attaches, and runs minimal boot sequence by default', async () => {
    const events = [];
    const dockerUtils = {
        ensureNetwork: async () => events.push('ensure'),
        attachSelfToNetwork: async () => events.push('attach'),
        containerExists: async () => {
            throw new Error('containerExists should not be invoked when startService is stubbed');
        },
        pullImageIfNeeded: async () => {},
        runContainerWithLogs: async () => {},
        waitForHealthyStatus: async () => {},
    };
    const logger = {
        log: (message) => events.push(message),
        warn: (message) => events.push(`warn:${message}`),
    };
    const warden = createWarden({
        dockerUtils,
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis' },
            },
            core: {
                'noona-moon': { name: 'noona-moon' },
                'noona-sage': { name: 'noona-sage' },
            },
        },
        logger,
    });

    warden.startService = async (service, healthUrl) => {
        events.push(`start:${service.name}:${healthUrl}`);
    };

    const result = await warden.init();

    assert.equal(result.mode, 'minimal');
    assert.ok(events.includes('ensure'));
    assert.ok(events.includes('attach'));
    assert.ok(events.some(event => event.includes('Minimal mode')));
    assert.ok(events.includes('start:noona-redis:http://noona-redis:8001/'));
    assert.ok(events.includes('start:noona-sage:http://noona-sage:3004/health'));
    assert.ok(events.includes('start:noona-moon:http://noona-moon:3000/'));
    assert.ok(events.includes('✅ Warden is ready.'));
});

test('shutdownAll stops, removes, clears tracked containers and exits with code 0', async () => {
    const operations = [];
    const containers = {
        'svc-1': {
            stop: async () => operations.push('stop:svc-1'),
            remove: async () => operations.push('remove:svc-1'),
        },
        'svc-2': {
            stop: async () => operations.push('stop:svc-2'),
            remove: async () => operations.push('remove:svc-2'),
        },
    };
    const dockerInstance = {
        getContainer: (name) => containers[name],
    };
    const trackedContainers = new Set(['svc-1', 'svc-2']);
    let exitCode = null;
    const dockerUtils = {
        ensureNetwork: async () => {},
        attachSelfToNetwork: async () => {},
        containerExists: async () => true,
        pullImageIfNeeded: async () => {},
        runContainerWithLogs: async () => {},
        waitForHealthyStatus: async () => {},
    };
    const logger = {
        log: (message) => operations.push(message),
        warn: (message) => operations.push(`warn:${message}`),
    };

    const warden = createWarden({
        dockerInstance,
        trackedContainers,
        dockerUtils,
        logger,
        processExit: (code) => {
            exitCode = code;
        },
    });

    await warden.shutdownAll();

    assert.deepEqual(operations, [
        'warn:Shutting down all containers...',
        'stop:svc-1',
        'remove:svc-1',
        'Stopped & removed svc-1',
        'stop:svc-2',
        'remove:svc-2',
        'Stopped & removed svc-2',
    ]);
    assert.equal(trackedContainers.size, 0);
    assert.equal(exitCode, 0);
});
