// services/warden/tests/wardenCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { createWarden, defaultDockerSocketDetector } from '../shared/wardenCore.mjs';
import { attachSelfToNetwork } from '../docker/dockerUtilties.mjs';

function createStubDocker(overrides = {}) {
    return {
        ping: async () => {},
        listContainers: async () => [],
        modem: { socketPath: '/var/run/docker.sock' },
        ...overrides,
    };
}

function buildWarden(options = {}) {
    const {
        dockerInstance = createStubDocker(),
        hostDockerSockets = [],
        ...rest
    } = options;

    return createWarden({
        dockerInstance,
        hostDockerSockets,
        ...rest,
    });
}

test('resolveHostServiceUrl prefers explicit hostServiceUrl', () => {
    const warden = buildWarden({ services: { addon: {}, core: {} }, hostDockerSockets: [] });
    const service = { hostServiceUrl: 'http://custom.local' };

    assert.equal(warden.resolveHostServiceUrl(service), 'http://custom.local');
});

test('resolveHostServiceUrl falls back to HOST_SERVICE_URL and port', () => {
    const warden = buildWarden({
        services: { addon: {}, core: {} },
        env: { HOST_SERVICE_URL: 'http://host.example' },
        hostDockerSockets: [],
    });
    const service = { port: 8080 };

    assert.equal(warden.resolveHostServiceUrl(service), 'http://host.example:8080');
});

test('startService pulls, runs, waits, and captures history when container is absent', async () => {
    const pullCalls = [];
    const runCalls = [];
    const waitCalls = [];
    const containerExistsOptions = [];
    const dockerInstance = createStubDocker();
    const dockerUtils = {
        ensureNetwork: async () => {},
        attachSelfToNetwork: async () => {},
        containerExists: async (_name, options = {}) => {
            containerExistsOptions.push(options?.dockerInstance);
            return false;
        },
        pullImageIfNeeded: async (image, options) => {
            pullCalls.push({
                image,
                hasProgress: typeof options?.onProgress === 'function',
                dockerInstance: options?.dockerInstance,
            });
            options?.onProgress?.({ status: 'Downloading', detail: 'layer 1' });
        },
        runContainerWithLogs: async (service, networkName, trackedContainers, debug, options) => {
            trackedContainers.add(service.name);
            runCalls.push({
                service: service.name,
                networkName,
                debug,
                hasLog: typeof options?.onLog === 'function',
                dockerInstance: options?.dockerInstance,
            });
            options?.onLog?.('line one\nline two', { level: 'info' });
        },
        waitForHealthyStatus: async (name, url) => {
            waitCalls.push({ name, url });
        },
    };
    const logs = [];
    const warden = buildWarden({
        dockerInstance,
        dockerUtils,
        services: { addon: {}, core: {} },
        logger: { log: (message) => logs.push(message), warn: () => {} },
        env: { HOST_SERVICE_URL: 'http://host', DEBUG: 'true' },
        hostDockerSockets: [],
    });

    const service = { name: 'noona-test', image: 'noona/test:latest', port: 1234 };
    await warden.startService(service, 'http://health.local');

    assert.deepEqual(containerExistsOptions, [dockerInstance]);
    assert.deepEqual(pullCalls, [{ image: 'noona/test:latest', hasProgress: true, dockerInstance }]);
    assert.deepEqual(
        runCalls,
        [{ service: 'noona-test', networkName: 'noona-network', debug: 'true', hasLog: true, dockerInstance }],
    );
    assert.deepEqual(waitCalls, [{ name: 'noona-test', url: 'http://health.local' }]);
    assert.ok(warden.trackedContainers.has('noona-test'));
    assert.ok(logs.some(line => line.includes('host_service_url: http://host:1234')));

    const history = warden.getServiceHistory('noona-test');
    assert.equal(history.summary.status, 'ready');
    assert.ok(history.entries.some((entry) => entry.type === 'progress' && entry.status === 'Downloading'));
    assert.ok(history.entries.some((entry) => entry.type === 'log' && entry.message === 'line one'));
});

test('startService skips pull and run when container already exists', async () => {
    const dockerInstance = createStubDocker();
    const dockerUtils = {
        ensureNetwork: async () => {},
        attachSelfToNetwork: async () => {},
        containerExists: async (_name, options = {}) => {
            assert.equal(options?.dockerInstance, dockerInstance);
            return true;
        },
        pullImageIfNeeded: async () => {
            throw new Error('pullImageIfNeeded should not be called');
        },
        runContainerWithLogs: async () => {
            throw new Error('runContainerWithLogs should not be called');
        },
        waitForHealthyStatus: async () => {},
    };
    const logs = [];
    const warden = buildWarden({
        dockerInstance,
        dockerUtils,
        services: { addon: {}, core: {} },
        logger: { log: (message) => logs.push(message), warn: () => {} },
        hostDockerSockets: [],
    });

    await warden.startService({ name: 'noona-test', image: 'ignored', hostServiceUrl: 'http://custom' });

    assert.ok(logs.some(line => line.includes('already running')));
    assert.ok(logs.some(line => line.includes('host_service_url: http://custom')));

    const history = warden.getServiceHistory('noona-test');
    assert.equal(history.summary.status, 'ready');
    assert.ok(history.entries.some((entry) => entry.status === 'running'));
});

test('listServices returns sorted metadata with host URLs and install state', async () => {
    const containerChecks = [];
    const dockerInstance = createStubDocker();
    const dockerUtils = {
        containerExists: async (name, options = {}) => {
            assert.equal(options?.dockerInstance, dockerInstance);
            containerChecks.push(name);
            return name === 'noona-redis';
        },
    };
    const warnings = [];
    const warden = buildWarden({
        dockerInstance,
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001, description: 'Cache' },
            },
            core: {
                'noona-sage': {
                    name: 'noona-sage',
                    image: 'sage',
                    hostServiceUrl: 'http://custom-sage',
                    health: 'http://health',
                },
                'noona-moon': { name: 'noona-moon', image: 'moon', port: 3000 },
            },
        },
        dockerUtils,
        env: { HOST_SERVICE_URL: 'http://localhost' },
        hostDockerSockets: [],
        logger: { warn: (message) => warnings.push(message), log: () => {} },
    });

    const services = await warden.listServices();

    assert.deepEqual(services, [
        {
            name: 'noona-moon',
            category: 'core',
            image: 'moon',
            port: 3000,
            hostServiceUrl: 'http://localhost:3000',
            description: null,
            health: null,
            envConfig: [],
            installed: false,
            required: false,
        },
        {
            name: 'noona-redis',
            category: 'addon',
            image: 'redis',
            port: 8001,
            hostServiceUrl: 'http://localhost:8001',
            description: 'Cache',
            health: null,
            envConfig: [],
            installed: true,
            required: true,
        },
        {
            name: 'noona-sage',
            category: 'core',
            image: 'sage',
            port: null,
            hostServiceUrl: 'http://custom-sage',
            description: null,
            health: 'http://health',
            envConfig: [],
            installed: false,
            required: false,
        },
    ]);
    assert.deepEqual(containerChecks, ['noona-moon', 'noona-redis', 'noona-sage']);
    assert.equal(warnings.length, 0);

    const redis = services.find((entry) => entry.name === 'noona-redis');
    assert.equal(redis?.required, true);
    assert.equal(services.find((entry) => entry.name === 'noona-moon')?.required, false);

    const installable = await warden.listServices({ includeInstalled: false });
    assert.deepEqual(
        installable.map((service) => service.name),
        ['noona-moon', 'noona-sage'],
    );
});

test('installServices returns per-service results with errors', async () => {
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001 },
                'noona-mongo': {
                    name: 'noona-mongo',
                    image: 'mongo',
                    hostServiceUrl: 'mongodb://localhost:27017',
                },
            },
            core: {
                'noona-sage': { name: 'noona-sage', image: 'sage', port: 3004 },
                'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
            },
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    const results = await warden.installServices(['noona-sage', 'noona-redis', 'unknown', '']);

    assert.deepEqual(results, [
        {
            name: 'noona-mongo',
            category: 'addon',
            status: 'installed',
            hostServiceUrl: 'mongodb://localhost:27017',
            image: 'mongo',
            port: null,
            required: true,
        },
        {
            name: 'noona-redis',
            category: 'addon',
            status: 'installed',
            hostServiceUrl: 'http://localhost:8001',
            image: 'redis',
            port: 8001,
            required: true,
        },
        {
            name: 'noona-vault',
            category: 'core',
            status: 'installed',
            hostServiceUrl: 'http://localhost:3005',
            image: 'vault',
            port: 3005,
            required: true,
        },
        {
            name: 'noona-sage',
            category: 'core',
            status: 'installed',
            hostServiceUrl: 'http://localhost:3004',
            image: 'sage',
            port: 3004,
            required: false,
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

    assert.deepEqual(started, ['noona-mongo', 'noona-redis', 'noona-vault', 'noona-sage']);
});

test('installServices publishes wizard state transitions', async () => {
    const events = [];
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis', image: 'redis' },
                'noona-mongo': { name: 'noona-mongo', image: 'mongo', hostServiceUrl: 'mongodb://localhost:27017' },
            },
            core: {
                'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
                'noona-portal': { name: 'noona-portal', image: 'portal' },
            },
        },
        dockerUtils: {
            ensureNetwork: async () => {},
            attachSelfToNetwork: async () => {},
            containerExists: async (_name, _options = {}) => false,
            pullImageIfNeeded: async () => {},
            runContainerWithLogs: async () => {},
            waitForHealthyStatus: async () => {},
        },
        wizardState: {
            publisher: {
                async reset(names) {
                    events.push({ type: 'reset', names });
                },
                async trackServiceStatus(name, status) {
                    events.push({ type: 'track', name, status });
                },
                async completeInstall(payload) {
                    events.push({ type: 'complete', ...payload });
                },
            },
        },
        hostDockerSockets: [],
    });

    warden.startService = async () => {};

    const results = await warden.installServices([
        { name: 'noona-redis' },
        { name: 'noona-portal' },
    ]);

    const installed = results.filter((entry) => entry.status === 'installed');
    assert.deepEqual(
        installed.map((entry) => entry.name),
        ['noona-mongo', 'noona-redis', 'noona-vault', 'noona-portal'],
    );
    assert.ok(events.some((event) => event.type === 'reset'));
    const tracked = events.filter((event) => event.type === 'track');
    assert.ok(tracked.some((event) => event.name === 'noona-redis' && event.status === 'installing'));
    assert.ok(
        tracked.some(
            (event) =>
                event.name === 'noona-portal' && (event.status === 'installing' || event.status === 'installed'),
        ),
    );
    const completion = events.find((event) => event.type === 'complete');
    assert.deepEqual(completion, { type: 'complete', hasErrors: false });
});

test('installServices publishes wizard errors when installs fail', async () => {
    const events = [];
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis', image: 'redis' },
                'noona-mongo': { name: 'noona-mongo', image: 'mongo', hostServiceUrl: 'mongodb://localhost:27017' },
            },
            core: {
                'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
                'noona-portal': { name: 'noona-portal', image: 'portal' },
            },
        },
        dockerUtils: {
            ensureNetwork: async () => {},
            attachSelfToNetwork: async () => {},
            containerExists: async (_name, _options = {}) => false,
            pullImageIfNeeded: async () => {},
            runContainerWithLogs: async () => {},
            waitForHealthyStatus: async () => {},
        },
        wizardState: {
            publisher: {
                async reset(names) {
                    events.push({ type: 'reset', names });
                },
                async trackServiceStatus(name, status) {
                    events.push({ type: 'track', name, status });
                },
                async completeInstall(payload) {
                    events.push({ type: 'complete', ...payload });
                },
            },
        },
        hostDockerSockets: [],
    });

    warden.startService = async (service) => {
        if (service.name === 'noona-portal') {
            throw new Error('boom');
        }
    };

    const results = await warden.installServices([
        { name: 'noona-redis' },
        { name: 'noona-portal' },
    ]);

    assert.ok(results.some((entry) => entry.name === 'noona-portal' && entry.status === 'error'));
    const completion = events.find((event) => event.type === 'complete');
    assert.ok(completion && completion.hasErrors === true);
    const portalEvents = events.filter((event) => event.type === 'track' && event.name === 'noona-portal');
    assert.ok(portalEvents.some((event) => event.status === 'error'));
});

test('installServices merges environment overrides before starting services', async () => {
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-vault': { name: 'noona-vault', image: 'vault', env: ['SERVICE_NAME=noona-vault'] },
                'noona-sage': {
                    name: 'noona-sage',
                    image: 'sage',
                    env: ['DEBUG=false', 'SERVICE_NAME=noona-sage', 'WARDEN_BASE_URL=http://default'],
                },
            },
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push({ name: service.name, env: service.env });
    };

    const results = await warden.installServices([
        { name: 'noona-sage', env: { DEBUG: 'true', WARDEN_BASE_URL: 'http://custom' } },
    ]);

    const sageStart = started.find((entry) => entry.name === 'noona-sage');
    assert.ok(sageStart, 'noona-sage should be started');
    assert.ok(sageStart.env.includes('DEBUG=true'));
    assert.ok(sageStart.env.includes('WARDEN_BASE_URL=http://custom'));
    assert.ok(sageStart.env.includes('SERVICE_NAME=noona-sage'));

    const vaultStart = started.find((entry) => entry.name === 'noona-vault');
    assert.ok(vaultStart, 'noona-vault should be started as a dependency');
    const resultNames = results.map((entry) => entry.name);
    assert.ok(resultNames.includes('noona-vault'));
    assert.ok(resultNames.includes('noona-sage'));
});

test('installServices reports invalid environment overrides', async () => {
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-vault': { name: 'noona-vault', image: 'vault' },
                'noona-sage': { name: 'noona-sage', image: 'sage' },
            },
        },
        hostDockerSockets: [],
    });

    const results = await warden.installServices([
        { name: 'noona-sage', env: 'not-an-object' },
    ]);

    const entry = results.find((item) => item.name === 'noona-sage');
    assert.ok(entry, 'Result should include the invalid entry');
    assert.equal(entry.status, 'error');
    assert.match(entry.error, /Environment overrides must be provided as an object map/i);
});

test('installService installs required vault dependencies before target service', async () => {
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001 },
                'noona-mongo': { name: 'noona-mongo', image: 'mongo', port: 27017 },
            },
            core: {
                'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
                'noona-sage': { name: 'noona-sage', image: 'sage', port: 3004 },
            },
        },
        hostDockerSockets: [],
    });

    const order = [];
    warden.startService = async (service) => {
        order.push(service.name);
    };

    const result = await warden.installService('noona-sage');

    assert.equal(result.name, 'noona-sage');
    assert.deepEqual(order, ['noona-mongo', 'noona-redis', 'noona-vault', 'noona-sage']);
});

test('installServices installs vault and dependencies when selected explicitly', async () => {
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001 },
                'noona-mongo': {
                    name: 'noona-mongo',
                    image: 'mongo',
                    hostServiceUrl: 'mongodb://localhost:27017',
                },
            },
            core: {
                'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
            },
        },
        hostDockerSockets: [],
    });

    const order = [];
    warden.startService = async (service) => {
        order.push(service.name);
    };

    const results = await warden.installServices(['noona-vault']);

    assert.deepEqual(order, ['noona-mongo', 'noona-redis', 'noona-vault']);
    assert.deepEqual(results, [
        {
            name: 'noona-mongo',
            category: 'addon',
            status: 'installed',
            hostServiceUrl: 'mongodb://localhost:27017',
            image: 'mongo',
            port: null,
            required: true,
        },
        {
            name: 'noona-redis',
            category: 'addon',
            status: 'installed',
            hostServiceUrl: 'http://localhost:8001',
            image: 'redis',
            port: 8001,
            required: true,
        },
        {
            name: 'noona-vault',
            category: 'core',
            status: 'installed',
            hostServiceUrl: 'http://localhost:3005',
            image: 'vault',
            port: 3005,
            required: true,
        },
    ]);
});

test('installService injects Kavita mount for Raven when detected', async () => {
    const dockerInstance = {
        listContainers: async () => [
            { Id: 'abc', Image: 'ghcr.io/example/kavita:latest', Names: ['/kavita-instance'] },
        ],
        getContainer: (id) => ({
            inspect: async () => ({
                Mounts: [
                    { Destination: '/data', Source: '/host/kavita-data' },
                ],
            }),
        }),
        modem: { socketPath: '/var/run/docker.sock' },
    };
    const services = {
        addon: {
            'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001 },
            'noona-mongo': { name: 'noona-mongo', image: 'mongo', port: 27017 },
        },
        core: {
            'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
            'noona-raven': {
                name: 'noona-raven',
                image: 'captainpax/noona-raven:latest',
                env: ['EXISTING_ENV=1'],
            },
        },
    };

    const warden = buildWarden({
        dockerInstance,
        services,
        logger: { log: () => {}, warn: () => {} },
        hostDockerSockets: [],
    });

    let receivedService = null;
    warden.startService = async (service) => {
        receivedService = service;
    };

    const result = await warden.installService('noona-raven');

    assert.ok(receivedService, 'startService should be invoked');
    assert.ok(receivedService.volumes.includes('/host/kavita-data:/kavita-data'));
    assert.ok(receivedService.env.includes('EXISTING_ENV=1'));
    assert.ok(receivedService.env.includes('APPDATA=/kavita-data'));
    assert.ok(receivedService.env.includes('KAVITA_DATA_MOUNT=/kavita-data'));
    assert.equal(result.kavitaDataMount, '/host/kavita-data');
    assert.deepEqual(result.kavitaDetection, {
        mountPath: '/host/kavita-data',
        socketPath: '/var/run/docker.sock',
        containerId: 'abc',
        containerName: 'kavita-instance',
    });
});

test('installService handles missing Kavita mount for Raven gracefully', async () => {
    let listCalls = 0;
    const dockerInstance = {
        listContainers: async () => {
            listCalls += 1;
            return [];
        },
    };
    const services = {
        addon: {
            'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001 },
            'noona-mongo': { name: 'noona-mongo', image: 'mongo', port: 27017 },
        },
        core: {
            'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
            'noona-raven': {
                name: 'noona-raven',
                image: 'captainpax/noona-raven:latest',
                env: ['BASE_ENV=1'],
            },
        },
    };

    const warden = buildWarden({
        dockerInstance,
        services,
        logger: { log: () => {}, warn: () => {} },
        hostDockerSockets: [],
    });

    let receivedService = null;
    warden.startService = async (service) => {
        receivedService = service;
    };

    const result = await warden.installService('noona-raven');

    assert.equal(listCalls, 1);
    assert.ok(receivedService, 'startService should still run');
    assert.deepEqual(receivedService.env, ['BASE_ENV=1']);
    assert.equal(receivedService.volumes, undefined);
    assert.equal(result.kavitaDataMount, null);
    assert.equal(result.kavitaDetection, null);
});

test('installServices wires manual Raven overrides when Kavita detection fails', async () => {
    const dockerInstance = {
        listContainers: async () => [],
    };
    const services = {
        addon: {
            'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001 },
            'noona-mongo': { name: 'noona-mongo', image: 'mongo', port: 27017 },
        },
        core: {
            'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
            'noona-raven': {
                name: 'noona-raven',
                image: 'captainpax/noona-raven:latest',
            },
        },
    };

    const warden = buildWarden({
        dockerInstance,
        services,
        logger: { log: () => {}, warn: () => {} },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service);
    };

    const overrides = {
        name: 'noona-raven',
        env: {
            APPDATA: '/downloads',
            KAVITA_DATA_MOUNT: '/srv/kavita',
        },
    };

    const results = await warden.installServices([overrides]);

    const ravenStart = started.find((entry) => entry.name === 'noona-raven');
    assert.ok(ravenStart, 'Raven should be started');
    assert.ok(ravenStart.volumes.includes('/srv/kavita:/downloads'));
    assert.ok(ravenStart.env.includes('APPDATA=/downloads'));
    assert.ok(ravenStart.env.includes('KAVITA_DATA_MOUNT=/downloads'));

    const ravenResult = results.find((entry) => entry.name === 'noona-raven');
    assert.ok(ravenResult, 'installServices should return Raven result');
    assert.equal(ravenResult.kavitaDetection, null);
    assert.equal(ravenResult.kavitaDataMount, '/srv/kavita');
});

test('installServices defaults Raven container mount path when only host path is provided', async () => {
    const dockerInstance = {
        listContainers: async () => [],
    };
    const services = {
        addon: {
            'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001 },
            'noona-mongo': { name: 'noona-mongo', image: 'mongo', port: 27017 },
        },
        core: {
            'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
            'noona-raven': { name: 'noona-raven', image: 'captainpax/noona-raven:latest' },
        },
    };

    const warden = buildWarden({
        dockerInstance,
        services,
        logger: { log: () => {}, warn: () => {} },
        hostDockerSockets: [],
    });

    let receivedService = null;
    warden.startService = async (service) => {
        receivedService = service;
    };

    const results = await warden.installServices([
        { name: 'noona-raven', env: { KAVITA_DATA_MOUNT: '/srv/kavita' } },
    ]);

    assert.ok(receivedService, 'Raven should be started');
    assert.ok(receivedService.volumes.includes('/srv/kavita:/kavita-data'));
    assert.ok(receivedService.env.includes('APPDATA=/kavita-data'));
    assert.ok(receivedService.env.includes('KAVITA_DATA_MOUNT=/kavita-data'));

    const ravenResult = results.find((entry) => entry.name === 'noona-raven');
    assert.ok(ravenResult, 'Result should include Raven');
    assert.equal(ravenResult.kavitaDataMount, '/srv/kavita');
    assert.equal(ravenResult.kavitaDetection, null);
});

test('installService inspects alternate docker sockets when primary is missing Kavita', async () => {
    const dockerInstance = {
        listContainers: async () => [],
        getContainer: () => ({
            inspect: async () => ({ Mounts: [] }),
        }),
    };

    const alternateClient = {
        listContainers: async () => [
            { Id: 'secondary', Image: 'ghcr.io/example/kavita:nightly', Names: ['/secondary-kavita'] },
        ],
        getContainer: () => ({
            inspect: async () => ({
                Mounts: [
                    { Destination: '/data', Source: '/alt/kavita-data' },
                ],
            }),
        }),
    };

    const services = {
        addon: {
            'noona-redis': { name: 'noona-redis', image: 'redis', port: 8001 },
            'noona-mongo': { name: 'noona-mongo', image: 'mongo', port: 27017 },
        },
        core: {
            'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
            'noona-raven': {
                name: 'noona-raven',
                image: 'captainpax/noona-raven:latest',
            },
        },
    };

    const fsStub = {
        existsSync: (candidate) => candidate === '/remote/docker.sock',
        statSync: () => ({ isSocket: () => true }),
    };

    const warden = buildWarden({
        dockerInstance,
        services,
        logger: { log: () => {}, warn: () => {} },
        hostDockerSockets: ['/remote/docker.sock'],
        dockerFactory: (socketPath) => {
            if (socketPath !== '/remote/docker.sock') {
                throw new Error(`Unexpected socket request: ${socketPath}`);
            }

            return alternateClient;
        },
        fs: fsStub,
    });

    let receivedService = null;
    warden.startService = async (service) => {
        receivedService = service;
    };

    const result = await warden.installService('noona-raven');

    assert.ok(receivedService, 'startService should be invoked');
    assert.ok(receivedService.volumes.includes('/alt/kavita-data:/kavita-data'));
    assert.equal(result.kavitaDataMount, '/alt/kavita-data');
    assert.deepEqual(result.kavitaDetection, {
        mountPath: '/alt/kavita-data',
        socketPath: '/remote/docker.sock',
        containerId: 'secondary',
        containerName: 'secondary-kavita',
    });
});

test('installation progress and service histories track install lifecycle', async () => {
    const dockerUtils = {
        ensureNetwork: async () => {},
        attachSelfToNetwork: async () => {},
        containerExists: async (_name, _options = {}) => false,
        pullImageIfNeeded: async (image, options) => {
            const layerId = `layer-${image}`;
            options?.onProgress?.({
                id: layerId,
                layerId,
                status: 'Downloading',
                phase: 'Downloading',
                detail: '10/100',
                progressDetail: { current: 10, total: 100 },
                message: `[${layerId}] Downloading 10/100`,
            });
        },
        runContainerWithLogs: async (service, _network, tracked, _debug, options) => {
            tracked.add(service.name);
            options?.onLog?.('starting container', {});
        },
        waitForHealthyStatus: async () => {},
    };

    const warden = buildWarden({
        dockerUtils,
        env: { HOST_SERVICE_URL: 'http://localhost' },
        services: {
            addon: {
                'noona-redis': { name: 'noona-redis', image: 'redis', port: 6379 },
                'noona-mongo': { name: 'noona-mongo', image: 'mongo', port: 27017 },
            },
            core: {
                'noona-sage': { name: 'noona-sage', image: 'sage', port: 3004, health: 'http://noona-sage:3004/health' },
                'noona-vault': { name: 'noona-vault', image: 'vault', port: 3005 },
            },
        },
        hostDockerSockets: [],
    });

    const results = await warden.installServices(['noona-sage']);
    assert.ok(results.filter((entry) => entry.status === 'installed').length >= 3);

    const progress = warden.getInstallationProgress();
    assert.equal(progress.status, 'complete');
    const sageProgress = progress.items.find((entry) => entry.name === 'noona-sage');
    assert.equal(sageProgress?.status, 'installed');

    const installationHistory = warden.getServiceHistory('installation');
    assert.equal(installationHistory.summary.status, 'complete');

    const limitedHistory = warden.getServiceHistory('noona-sage', { limit: 2 });
    assert.ok(limitedHistory.entries.length <= 2);
    const fullHistory = warden.getServiceHistory('noona-sage');
    assert.ok(fullHistory.entries.length >= limitedHistory.entries.length);

    const progressEntry = fullHistory.entries.find((entry) => entry.meta?.layerId === 'layer-sage');
    assert.ok(progressEntry, 'Expected progress entry with layer metadata');
    assert.equal(progressEntry.meta.phase, 'Downloading');
    assert.deepEqual(progressEntry.meta.progressDetail, { current: 10, total: 100 });

    const mirroredEntry = installationHistory.entries.find((entry) => entry.meta?.layerId === 'layer-sage');
    assert.ok(mirroredEntry, 'Installation history should mirror layer metadata');
    assert.ok(mirroredEntry.message.includes('noona-sage'));
});

test('testService prefers host health URL when resolveHostServiceUrl can produce one', async () => {
    const fetchCalls = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-portal': {
                    name: 'noona-portal',
                    image: 'portal',
                    port: 3003,
                    health: 'http://noona-portal:3003/health',
                },
            },
        },
        env: { HOST_SERVICE_URL: 'http://localhost' },
        hostDockerSockets: [],
        fetchImpl: async (url) => {
            fetchCalls.push(url);
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ status: 'ok' }),
            };
        },
    });

    const result = await warden.testService('noona-portal');
    assert.equal(result.success, true);
    assert.deepEqual(fetchCalls, ['http://localhost:3003/health']);

    const history = warden.getServiceHistory('noona-portal');
    assert.ok(history.entries.some((entry) => entry.status === 'tested'));

    await assert.rejects(() => warden.testService('noona-sage', {}), /not registered/i);
});

test('testService falls back to container health URL when host is unavailable', async () => {
    const fetchCalls = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-portal': {
                    name: 'noona-portal',
                    image: 'portal',
                    port: 3003,
                    health: 'http://noona-portal:3003/health',
                },
            },
        },
        env: { HOST_SERVICE_URL: 'http://localhost' },
        hostDockerSockets: [],
        fetchImpl: async (url) => {
            fetchCalls.push(url);
            if (fetchCalls.length === 1) {
                throw new Error('ECONNREFUSED host');
            }

            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ status: 'ok' }),
            };
        },
    });

    const result = await warden.testService('noona-portal');
    assert.equal(result.success, true);
    assert.deepEqual(fetchCalls, [
        'http://localhost:3003/health',
        'http://noona-portal:3003/health',
    ]);
});

test('testService aggregates errors when all health candidates fail', async () => {
    const fetchCalls = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-portal': {
                    name: 'noona-portal',
                    image: 'portal',
                    port: 3003,
                    health: 'http://noona-portal:3003/health',
                },
            },
        },
        env: { HOST_SERVICE_URL: 'http://localhost' },
        hostDockerSockets: [],
        fetchImpl: async (url) => {
            fetchCalls.push(url);
            throw new Error(`Failed to reach ${url}`);
        },
    });

    const result = await warden.testService('noona-portal');
    assert.equal(result.success, false);
    assert.match(result.error, /Portal test failed for all candidates:/);
    assert.match(result.error, /http:\/\/localhost:3003\/health \(Failed to reach http:\/\/localhost:3003\/health\)/);
    assert.match(result.error, /http:\/\/noona-portal:3003\/health \(Failed to reach http:\/\/noona-portal:3003\/health\)/);
    assert.deepEqual(fetchCalls, [
        'http://localhost:3003/health',
        'http://noona-portal:3003/health',
    ]);
});

test('testService runs Vault health check against custom path', async () => {
    const fetchCalls = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-vault': {
                    name: 'noona-vault',
                    image: 'vault',
                    port: 3005,
                    health: 'http://noona-vault:3005/v1/vault/health',
                },
            },
        },
        env: { HOST_SERVICE_URL: 'http://localhost' },
        hostDockerSockets: [],
        fetchImpl: async (url) => {
            fetchCalls.push(url);
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ status: 'ok' }),
            };
        },
    });

    const result = await warden.testService('noona-vault');
    assert.equal(result.success, true);
    assert.deepEqual(fetchCalls, ['http://localhost:3005/v1/vault/health']);
});

test('testService checks Redis health root endpoint', async () => {
    const fetchCalls = [];
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': {
                    name: 'noona-redis',
                    image: 'redis',
                    port: 8001,
                    hostServiceUrl: 'http://localhost:8001',
                    health: 'http://noona-redis:8001/',
                },
            },
            core: {},
        },
        hostDockerSockets: [],
        fetchImpl: async (url) => {
            fetchCalls.push(url);
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ status: 'ok' }),
            };
        },
    });

    const result = await warden.testService('noona-redis');
    assert.equal(result.success, true);
    assert.deepEqual(fetchCalls, ['http://localhost:8001/']);
});

test('testService exercises Raven health endpoint', async () => {
    const fetchCalls = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-raven': {
                    name: 'noona-raven',
                    image: 'raven',
                    port: 3002,
                    health: 'http://noona-raven:8080/v1/library/health',
                },
            },
        },
        env: { HOST_SERVICE_URL: 'http://localhost' },
        hostDockerSockets: [],
        fetchImpl: async (url) => {
            fetchCalls.push(url);
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ status: 'ok' }),
            };
        },
    });

    const result = await warden.testService('noona-raven');
    assert.equal(result.success, true);
    assert.deepEqual(fetchCalls, ['http://localhost:3002/v1/library/health']);
});

test('testService inspects Mongo container state', async () => {
    const dockerInstance = createStubDocker({
        getContainer: () => ({
            inspect: async () => ({
                State: {
                    Running: true,
                    Status: 'running',
                    Health: { Status: 'healthy' },
                },
            }),
        }),
    });

    const warden = buildWarden({
        dockerInstance,
        services: {
            addon: {
                'noona-mongo': {
                    name: 'noona-mongo',
                    image: 'mongo',
                },
            },
            core: {},
        },
        hostDockerSockets: [],
    });

    const result = await warden.testService('noona-mongo');
    assert.equal(result.success, true);
    assert.equal(result.status, 'running');
    assert.equal(result.body.state.Status, 'running');
});

test('testService reports Mongo inspection failures', async () => {
    const dockerInstance = createStubDocker({
        getContainer: () => ({
            inspect: async () => {
                throw new Error('boom');
            },
        }),
    });

    const warden = buildWarden({
        dockerInstance,
        services: {
            addon: {
                'noona-mongo': {
                    name: 'noona-mongo',
                    image: 'mongo',
                },
            },
            core: {},
        },
        hostDockerSockets: [],
    });

    const result = await warden.testService('noona-mongo');
    assert.equal(result.success, false);
    assert.match(result.error, /boom/);
});

test('detectKavitaMount logs detection attempts and returns result', async () => {
    const dockerInstance = {
        listContainers: async () => [],
        modem: { socketPath: null },
    };

    const warden = buildWarden({
        dockerInstance,
        services: { addon: {}, core: {} },
        hostDockerSockets: [],
    });

    const detection = await warden.detectKavitaMount();
    assert.equal(detection, null);

    const history = warden.getServiceHistory('noona-raven');
    assert.ok(history.entries.some((entry) => entry.status === 'detecting'));
    assert.ok(history.entries.some((entry) => entry.status === 'not-found'));
});

test('defaultDockerSocketDetector merges Windows named pipes discovered via PowerShell', () => {
    const spawnCalls = [];
    const result = defaultDockerSocketDetector({
        env: { DOCKER_HOST: 'npipe:////./pipe/docker_alt' },
        fs: { readdirSync: () => [] },
        process: { platform: 'win32' },
        spawnSync: (...args) => {
            spawnCalls.push(args);
            return { stdout: '\\.\pipe\docker_engine\r\n' };
        },
    });

    assert.ok(spawnCalls.length === 1);
    assert.ok(result.includes('//./pipe/docker_engine'));
    assert.ok(result.includes('//./pipe/docker_alt'));
});

test('detectKavitaMount initialises Docker clients for normalized Windows pipes', async () => {
    const dockerInstance = {
        listContainers: async () => [],
        modem: { socketPath: '//./pipe/docker_primary' },
    };

    const dockerFactoryCalls = [];
    const warden = buildWarden({
        dockerInstance,
        services: { addon: {}, core: {} },
        hostDockerSockets: ['npipe:////./pipe/docker_engine_alt'],
        dockerFactory: (socketPath) => {
            dockerFactoryCalls.push(socketPath);
            return {
                listContainers: async () => [],
            };
        },
        fs: {
            readdirSync: () => [],
            existsSync: () => {
                throw new Error('existsSync should not be called for Windows pipes');
            },
            statSync: () => {
                throw new Error('statSync should not be called for Windows pipes');
            },
        },
    });

    await warden.detectKavitaMount();

    assert.deepEqual(dockerFactoryCalls, ['//./pipe/docker_engine_alt']);
});

test('getServiceHealth returns Raven health and records wizard detail', async () => {
    const wizardCalls = [];
    const fetchCalls = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-raven': {
                    name: 'noona-raven',
                    image: 'raven',
                    health: 'http://noona-raven:8080/ready',
                },
            },
        },
        hostDockerSockets: [],
        fetchImpl: async (url) => {
            fetchCalls.push(url);
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ status: 'healthy', message: 'Raven is good' }),
            };
        },
        wizardState: {
            publisher: {
                async recordRavenDetail(...args) {
                    wizardCalls.push(args);
                },
            },
        },
    });

    const result = await warden.getServiceHealth('noona-raven');
    assert.deepEqual(fetchCalls, ['http://noona-raven:8080/ready']);
    assert.deepEqual(result, {
        status: 'healthy',
        detail: 'Raven is good',
        url: 'http://noona-raven:8080/ready',
    });

    assert.equal(wizardCalls.length, 1);
    const [detail, options] = wizardCalls[0];
    assert.equal(detail.health.status, 'healthy');
    assert.equal(detail.health.message, 'Raven is good');
    assert.ok(detail.health.updatedAt);
    assert.equal(options.status, 'in-progress');
    assert.equal(options.error, null);
});

test('getServiceHealth aggregates failures and records Raven error', async () => {
    const wizardCalls = [];
    const fetchCalls = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-raven': {
                    name: 'noona-raven',
                    image: 'raven',
                    port: 8080,
                    health: 'http://noona-raven:8080/ready',
                },
            },
        },
        env: { HOST_SERVICE_URL: 'http://localhost' },
        hostDockerSockets: [],
        fetchImpl: async (url) => {
            fetchCalls.push(url);
            throw new Error(`failed:${url}`);
        },
        wizardState: {
            publisher: {
                async recordRavenDetail(...args) {
                    wizardCalls.push(args);
                },
            },
        },
    });

    await assert.rejects(() => warden.getServiceHealth('noona-raven'), /failed:http:\/\/noona-raven:8080\/ready/);
    assert.deepEqual(fetchCalls, [
        'http://localhost:8080/health',
        'http://noona-raven:8080/ready',
    ]);

    assert.equal(wizardCalls.length, 1);
    const [detail, options] = wizardCalls[0];
    assert.equal(detail.health.status, 'error');
    assert.match(detail.health.message, /failed:http:\/\/noona-raven:8080\/ready/);
    assert.equal(options.status, 'error');
});

test('bootFull launches services in super boot order with correct health URLs', async () => {
    const dockerUtils = {
        ensureNetwork: async () => {},
        attachSelfToNetwork: async () => {},
        containerExists: async (_name, _options = {}) => true,
        pullImageIfNeeded: async () => {},
        runContainerWithLogs: async () => {},
        waitForHealthyStatus: async () => {},
    };
    const warnings = [];
    const warden = buildWarden({
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
        containerExists: async (_name, _options = {}) => {
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
    const warden = buildWarden({
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
    assert.ok(!events.includes('start:noona-redis:http://noona-redis:8001/'));
    assert.ok(events.includes('start:noona-sage:http://noona-sage:3004/health'));
    assert.ok(events.includes('start:noona-moon:http://noona-moon:3000/'));
    assert.ok(events.includes('✅ Warden is ready.'));
});

test('init falls back to alternate docker socket when default ping fails', async () => {
    const failingDocker = createStubDocker({
        ping: async () => {
            const error = new Error('connect ECONNREFUSED /var/run/docker.sock');
            error.code = 'ECONNREFUSED';
            throw error;
        },
    });

    const successfulDocker = createStubDocker({
        ping: async () => {},
        modem: { socketPath: '/remote/docker.sock' },
    });

    const ensureClients = [];
    const attachClients = [];
    const containerExistsClients = [];
    const pullClients = [];
    const runClients = [];
    const dockerFactoryCalls = [];

    const dockerUtils = {
        ensureNetwork: async (client) => ensureClients.push(client),
        attachSelfToNetwork: async (client) => attachClients.push(client),
        containerExists: async (_name, options = {}) => {
            containerExistsClients.push(options?.dockerInstance);
            return false;
        },
        pullImageIfNeeded: async (_image, options = {}) => {
            pullClients.push(options?.dockerInstance);
        },
        runContainerWithLogs: async (service, _network, trackedContainers, _debug, options = {}) => {
            trackedContainers.add(service.name);
            runClients.push(options?.dockerInstance);
        },
        waitForHealthyStatus: async () => {},
    };

    const warnings = [];
    const warden = buildWarden({
        dockerInstance: failingDocker,
        dockerFactory: (socketPath) => {
            dockerFactoryCalls.push(socketPath);
            if (socketPath === '/remote/docker.sock') {
                return successfulDocker;
            }
            throw new Error(`Unexpected socket request: ${socketPath}`);
        },
        fs: {
            existsSync: (candidate) => candidate === '/remote/docker.sock',
            statSync: () => ({ isSocket: () => true }),
        },
        dockerUtils,
        logger: { log: () => {}, warn: (message) => warnings.push(message) },
        hostDockerSockets: ['/remote/docker.sock'],
        services: {
            addon: {},
            core: {
                'noona-sage': { name: 'noona-sage', image: 'sage', hostServiceUrl: 'http://sage' },
                'noona-moon': { name: 'noona-moon', image: 'moon', hostServiceUrl: 'http://moon' },
            },
        },
    });

    await warden.init();

    assert.deepEqual(dockerFactoryCalls, ['/remote/docker.sock']);
    assert.deepEqual(ensureClients, [successfulDocker]);
    assert.deepEqual(attachClients, [successfulDocker]);
    assert.deepEqual(containerExistsClients, [successfulDocker, successfulDocker]);
    assert.deepEqual(pullClients, [successfulDocker, successfulDocker]);
    assert.deepEqual(runClients, [successfulDocker, successfulDocker]);
    assert.ok(
        warnings.some((message) =>
            message.includes('Docker check failed for socket /var/run/docker.sock'),
        ),
    );
});

test('init inspects tcp DOCKER_HOST endpoint when default socket fails', async () => {
    const failingDocker = createStubDocker({
        ping: async () => {
            const error = new Error('connect ECONNREFUSED /var/run/docker.sock');
            error.code = 'ECONNREFUSED';
            throw error;
        },
    });

    const remoteDocker = createStubDocker({
        ping: async () => {},
        modem: { host: 'docker-proxy', port: 2375 },
    });

    const dockerFactoryCalls = [];
    const fsStub = {
        existsSync: (candidate) => {
            if (candidate.startsWith('tcp://')) {
                throw new Error('should not stat tcp endpoints');
            }
            return candidate === '/var/run/docker.sock';
        },
        statSync: (candidate) => {
            if (candidate.startsWith('tcp://')) {
                throw new Error('should not stat tcp endpoints');
            }
            return { isSocket: () => true };
        },
    };

    const dockerUtils = {
        ensureNetwork: async () => {},
        attachSelfToNetwork: async () => {},
        containerExists: async () => false,
        pullImageIfNeeded: async () => {},
        runContainerWithLogs: async (service, _network, trackedContainers) => {
            trackedContainers.add(service.name);
        },
        waitForHealthyStatus: async () => {},
    };

    const warden = buildWarden({
        dockerInstance: failingDocker,
        dockerFactory: (endpoint) => {
            dockerFactoryCalls.push(endpoint);
            if (endpoint === 'tcp://docker-proxy:2375') {
                return remoteDocker;
            }
            throw new Error(`Unexpected endpoint: ${endpoint}`);
        },
        fs: fsStub,
        env: { DOCKER_HOST: 'tcp://docker-proxy:2375' },
        dockerUtils,
        services: {
            addon: {},
            core: {
                'noona-sage': { name: 'noona-sage', image: 'sage', hostServiceUrl: 'http://sage' },
                'noona-moon': { name: 'noona-moon', image: 'moon', hostServiceUrl: 'http://moon' },
            },
        },
    });

    await warden.init();

    assert.deepEqual(dockerFactoryCalls, ['tcp://docker-proxy:2375']);
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
    const dockerInstance = createStubDocker({
        getContainer: (name) => containers[name],
    });
    const trackedContainers = new Set(['svc-1', 'svc-2']);
    let exitCode = null;
    const dockerUtils = {
        ensureNetwork: async () => {},
        attachSelfToNetwork: async () => {},
        containerExists: async (_name, _options = {}) => true,
        pullImageIfNeeded: async () => {},
        runContainerWithLogs: async () => {},
        waitForHealthyStatus: async () => {},
    };
    const logger = {
        log: (message) => operations.push(message),
        warn: (message) => operations.push(`warn:${message}`),
    };

    const warden = buildWarden({
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
        '[noona-warden] 🐳 Docker connection established via socket /var/run/docker.sock.',
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

test('init falls back to SERVICE_NAME when HOSTNAME lookup fails', async () => {
    const originalHostname = process.env.HOSTNAME;
    const originalServiceName = process.env.SERVICE_NAME;

    process.env.HOSTNAME = 'ephemeral-host';
    process.env.SERVICE_NAME = 'noona-warden-fallback';

    const warnings = [];
    const originalConsoleWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.join(' '));
    };

    const connections = [];
    const dockerInstance = createStubDocker({
        getContainer(id) {
            return {
                async inspect() {
                    if (id === 'ephemeral-host') {
                        const error = new Error('not found');
                        error.statusCode = 404;
                        throw error;
                    }

                    if (id === 'noona-warden-fallback') {
                        return { NetworkSettings: { Networks: {} } };
                    }

                    throw new Error(`unexpected container id: ${id}`);
                },
            };
        },
        getNetwork(name) {
            return {
                async connect({ Container }) {
                    connections.push({ network: name, container: Container });
                },
            };
        },
    });

    const warden = buildWarden({
        dockerInstance,
        dockerUtils: {
            ensureNetwork: async () => {},
            attachSelfToNetwork,
            containerExists: async (_name, _options = {}) => false,
            pullImageIfNeeded: async () => {},
            runContainerWithLogs: async () => {},
            waitForHealthyStatus: async () => {},
        },
        services: {
            core: {
                'noona-moon': { name: 'noona-moon' },
                'noona-sage': { name: 'noona-sage' },
            },
            addon: {},
        },
        logger: { log: () => {}, warn: () => {} },
        env: { SERVICE_NAME: 'noona-warden-fallback', DEBUG: 'false' },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    try {
        const result = await warden.init();
        assert.equal(result.mode, 'minimal');
        assert.deepEqual(started, ['noona-sage', 'noona-moon']);
        assert.ok(connections.some(({ container }) => container === 'noona-warden-fallback'));
        assert.ok(
            warnings.some((message) =>
                message.toLowerCase().includes("falling back to service_name 'noona-warden-fallback'"),
            ),
        );
    } finally {
        console.warn = originalConsoleWarn;

        if (originalHostname === undefined) {
            delete process.env.HOSTNAME;
        } else {
            process.env.HOSTNAME = originalHostname;
        }

        if (originalServiceName === undefined) {
            delete process.env.SERVICE_NAME;
        } else {
            process.env.SERVICE_NAME = originalServiceName;
        }
    }
});
