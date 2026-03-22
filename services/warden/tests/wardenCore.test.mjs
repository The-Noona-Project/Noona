// services/warden/tests/wardenCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {load as loadYaml} from 'js-yaml';

import {createWarden, defaultDockerSocketDetector} from '../core/createWarden.mjs';
import {attachSelfToNetwork} from '../docker/dockerUtilties.mjs';
import {
    DEFAULT_MANAGED_KOMF_APPLICATION_YML,
    LEGACY_MANAGED_KOMF_APPLICATION_YML,
    normalizeManagedKomfConfigContent,
} from '../docker/komfConfigTemplate.mjs';

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
        storageLayoutBootstrap = false,
        fs = createMemoryFs(),
        ...rest
    } = options;

    return createWarden({
        dockerInstance,
        hostDockerSockets,
        storageLayoutBootstrap,
        fs,
        ...rest,
    });
}

const NOONA_IMAGE_NAMESPACE = 'docker.darkmatterservers.com/the-noona-project';
const noonaImage = (name, tag = 'latest') => `${NOONA_IMAGE_NAMESPACE}/${name}:${tag}`;
const noonaDigest = (name, digest) => `${NOONA_IMAGE_NAMESPACE}/${name}@${digest}`;

function createMemoryFs(initialFiles = {}) {
    const files = new Map(Object.entries(initialFiles).map(([filePath, content]) => [path.normalize(filePath), String(content)]));
    const directories = new Set();
    const removePathSync = (targetPath) => {
        const normalizedPath = path.normalize(targetPath);
        files.delete(normalizedPath);
        directories.delete(normalizedPath);

        for (const filePath of Array.from(files.keys())) {
            if (filePath.startsWith(`${normalizedPath}${path.sep}`)) {
                files.delete(filePath);
            }
        }

        for (const directoryPath of Array.from(directories.values())) {
            if (directoryPath.startsWith(`${normalizedPath}${path.sep}`)) {
                directories.delete(directoryPath);
            }
        }
    };
    const removePath = async (targetPath) => removePathSync(targetPath);

    return {
        mkdirSync(targetPath) {
            directories.add(path.normalize(targetPath));
        },
        readFileSync(targetPath) {
            const normalizedPath = path.normalize(targetPath);
            if (!files.has(normalizedPath)) {
                const error = new Error(`ENOENT: no such file or directory, open '${normalizedPath}'`);
                error.code = 'ENOENT';
                throw error;
            }

            return files.get(normalizedPath);
        },
        writeFileSync(targetPath, content) {
            files.set(path.normalize(targetPath), String(content));
        },
        rmSync(targetPath) {
            return removePathSync(targetPath);
        },
        promises: {
            rm: removePath,
        },
        files,
        directories,
    };
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

test('resolveHostServiceUrl falls back to SERVER_IP and port', () => {
    const warden = buildWarden({
        services: {addon: {}, core: {}},
        env: {SERVER_IP: '192.168.1.25'},
        hostDockerSockets: [],
    });
    const service = {port: 8080};

    assert.equal(warden.resolveHostServiceUrl(service), 'http://192.168.1.25:8080');
});

test('getServiceConfig injects SERVER_IP and rewrites managed host URLs', () => {
    const warden = buildWarden({
        services: {
            addon: {
                'noona-mongo': {
                    name: 'noona-mongo',
                    image: 'mongo',
                    port: 27017,
                    hostServiceUrl: 'mongodb://localhost:27017',
                    env: ['SERVICE_NAME=noona-mongo'],
                },
            },
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    hostServiceUrl: 'http://localhost:3000',
                    env: ['SERVICE_NAME=noona-moon'],
                },
            },
        },
        env: {SERVER_IP: '192.168.1.25'},
        hostDockerSockets: [],
    });

    const moonConfig = warden.getServiceConfig('noona-moon');
    const mongoConfig = warden.getServiceConfig('noona-mongo');

    assert.equal(moonConfig.hostServiceUrl, 'http://192.168.1.25:3000');
    assert.equal(moonConfig.env.SERVER_IP, '192.168.1.25');
    assert.equal(mongoConfig.hostServiceUrl, 'mongodb://192.168.1.25:27017');
    assert.equal(mongoConfig.env.SERVER_IP, '192.168.1.25');
});

test('getServiceConfig exposes noona-warden SERVER_IP and AUTO_UPDATES settings', () => {
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                },
            },
        },
        env: {SERVER_IP: '192.168.1.25', AUTO_UPDATES: 'true'},
        hostDockerSockets: [],
    });

    const config = warden.getServiceConfig('noona-warden');

    assert.equal(config.name, 'noona-warden');
    assert.equal(config.hostServiceUrl, 'http://192.168.1.25');
    assert.equal(config.env.SERVER_IP, '192.168.1.25');
    assert.equal(config.env.AUTO_UPDATES, 'true');
    assert.equal(config.runtimeConfig.hostPort, null);
    assert.deepEqual(config.runtimeConfig.env, {});
    assert.deepEqual(
        config.envConfig.map((entry) => entry?.key),
        ['SERVER_IP', 'AUTO_UPDATES'],
    );
});

test('managed core descriptors default to unless-stopped restart policy', () => {
    const warden = buildWarden({hostDockerSockets: []});

    assert.deepEqual(warden.getServiceConfig('noona-sage').restartPolicy, {Name: 'unless-stopped'});
    assert.deepEqual(warden.getServiceConfig('noona-moon').restartPolicy, {Name: 'unless-stopped'});
    assert.deepEqual(warden.getServiceConfig('noona-portal').restartPolicy, {Name: 'unless-stopped'});
    assert.deepEqual(warden.getServiceConfig('noona-vault').restartPolicy, {Name: 'unless-stopped'});
});

test('default managed Komf template includes provider credential slots and safe provider defaults', () => {
    const config = loadYaml(DEFAULT_MANAGED_KOMF_APPLICATION_YML);

    assert.equal(config?.kavita?.eventListener?.enabled, true);
    assert.equal(config?.database?.file, '/config/database.sqlite');
    assert.equal(config?.metadataProviders?.malClientId, '');
    assert.equal(config?.metadataProviders?.comicVineApiKey, '');
    assert.equal(config?.metadataProviders?.defaultProviders?.mangaUpdates?.enabled, true);
    assert.equal(config?.metadataProviders?.defaultProviders?.mangaUpdates?.mode, 'API');
    assert.equal(config?.metadataProviders?.defaultProviders?.aniList?.enabled, false);
    assert.equal(config?.metadataProviders?.defaultProviders?.mal?.enabled, false);
    assert.equal(config?.metadataProviders?.defaultProviders?.comicVine?.enabled, false);
});

test('normalizeManagedKomfConfigContent upgrades the legacy managed Komf template', () => {
    const normalized = normalizeManagedKomfConfigContent(LEGACY_MANAGED_KOMF_APPLICATION_YML);
    const config = loadYaml(normalized);

    assert.equal(normalized, normalizeManagedKomfConfigContent(DEFAULT_MANAGED_KOMF_APPLICATION_YML));
    assert.equal(config?.metadataProviders?.defaultProviders?.mangaUpdates?.enabled, true);
    assert.equal(config?.metadataProviders?.defaultProviders?.mangaUpdates?.mode, 'API');
    assert.equal(config?.metadataProviders?.defaultProviders?.aniList?.enabled, false);
});

test('normalizeManagedKomfConfigContent decodes escaped newline payloads', () => {
    const escaped =
        'metadataProviders:\\n  defaultProviders:\\n    aniList:\\n      enabled: true\\n';
    const normalized = normalizeManagedKomfConfigContent(escaped);

    assert.match(normalized, /metadataProviders:\n/);
    assert.match(normalized, /aniList:\n/);
    assert.ok(!normalized.includes('\\n'));
});

test('getServiceConfig surfaces managed Komf application.yml from disk', () => {
    const komfConfigPath = path.join('/srv/noona', 'komf', 'config', 'application.yml');
    const memoryFs = createMemoryFs({
        [komfConfigPath]: 'metadataProviders:\n  defaultProviders:\n    aniList:\n      enabled: true\n',
    });
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {
                'noona-komf': {
                    name: 'noona-komf',
                    image: 'sndxr/komf:latest',
                    port: 8085,
                    env: ['KOMF_KAVITA_BASE_URI=http://noona-kavita:5000'],
                    envConfig: [{key: 'KOMF_APPLICATION_YML', defaultValue: ''}],
                },
            },
            core: {},
        },
    });

    const komfConfig = warden.getServiceConfig('noona-komf');
    assert.match(komfConfig.env.KOMF_APPLICATION_YML, /metadataProviders:/);
    assert.match(komfConfig.env.KOMF_APPLICATION_YML, /aniList:/);
});

test('startService writes managed Komf application.yml and strips it from container env', async () => {
    const started = [];
    const memoryFs = createMemoryFs();
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async (service) => {
            started.push(service);
            return {Id: `${service.name}-container`};
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerUtils,
        services: {
            addon: {
                'noona-komf': {
                    name: 'noona-komf',
                    image: 'sndxr/komf:latest',
                    port: 8085,
                    env: ['KOMF_KAVITA_BASE_URI=http://noona-kavita:5000'],
                    user: '1000:1000',
                },
            },
            core: {},
        },
    });

    await warden.startService({
        name: 'noona-komf',
        image: 'sndxr/komf:latest',
        port: 8085,
        env: [
            'KOMF_KAVITA_BASE_URI=http://noona-kavita:5000',
            'KOMF_APPLICATION_YML=metadataProviders:\n  defaultProviders:\n    mal:\n      enabled: true',
        ],
        user: '1000:1000',
    });

    const komfStart = started[0];
    assert.ok(komfStart, 'Komf should be started');
    assert.ok(!komfStart.env.some((entry) => entry.startsWith('KOMF_APPLICATION_YML=')));

    const writtenPath = path.join('/srv/noona', 'komf', 'config', 'application.yml');
    assert.match(memoryFs.files.get(path.normalize(writtenPath)) || '', /metadataProviders:/);
    assert.match(memoryFs.files.get(path.normalize(writtenPath)) || '', /mal:/);
});

test('startService mirrors managed Komf application.yml to host mount through helper container', async () => {
    const helperCreateCalls = [];
    const dockerInstance = createStubDocker({
        createContainer: async (config) => {
            helperCreateCalls.push(config);
            return {
                start: async () => {
                },
                wait: async () => ({StatusCode: 0}),
            };
        },
    });
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => ({Id: 'noona-komf-container'}),
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerInstance,
        fs: createMemoryFs(),
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerUtils,
        services: {
            addon: {
                'noona-komf': {
                    name: 'noona-komf',
                    image: 'sndxr/komf:latest',
                    port: 8085,
                    env: ['KOMF_KAVITA_BASE_URI=http://noona-kavita:5000'],
                    user: '1000:1000',
                },
            },
            core: {},
        },
    });

    await warden.startService({
        name: 'noona-komf',
        image: 'sndxr/komf:latest',
        port: 8085,
        env: [
            'KOMF_KAVITA_BASE_URI=http://noona-kavita:5000',
            'KOMF_APPLICATION_YML=metadataProviders:\n  defaultProviders:\n    mal:\n      enabled: true',
        ],
        user: '1000:1000',
    });

    assert.equal(helperCreateCalls.length, 1);
    assert.equal(helperCreateCalls[0]?.Image, 'busybox:1.36');
    assert.match(helperCreateCalls[0]?.HostConfig?.Binds?.[0] ?? '', /komf[\\/]config:\/target$/);
    assert.ok(
        (helperCreateCalls[0]?.Env ?? []).some((entry) => entry.startsWith('NOONA_KOMF_CONFIG_B64=')),
    );
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
        waitForHealthyStatus: async (name, url, tries, delay) => {
            waitCalls.push({name, url, tries, delay});
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

    const service = {
        name: 'noona-test',
        image: 'noona/test:latest',
        port: 1234,
        healthTries: 45,
        healthDelayMs: 1500,
    };
    await warden.startService(service, 'http://health.local');

    assert.deepEqual(containerExistsOptions, [dockerInstance]);
    assert.deepEqual(pullCalls, [{ image: 'noona/test:latest', hasProgress: true, dockerInstance }]);
    assert.deepEqual(
        runCalls,
        [{ service: 'noona-test', networkName: 'noona-network', debug: 'true', hasLog: true, dockerInstance }],
    );
    assert.deepEqual(waitCalls, [{name: 'noona-test', url: 'http://health.local', tries: 45, delay: 1500}]);
    assert.ok(warden.trackedContainers.has('noona-test'));
    assert.ok(logs.some(line => line.includes('host_service_url: http://host:1234')));

    const history = warden.getServiceHistory('noona-test');
    assert.equal(history.summary.status, 'ready');
    assert.ok(history.entries.some((entry) => entry.type === 'progress' && entry.status === 'Downloading'));
    assert.ok(history.entries.some((entry) => entry.type === 'log' && entry.message === 'line one'));

    const wardenHistory = warden.getServiceHistory('noona-warden');
    assert.ok(
        wardenHistory.entries.some((entry) => entry.type === 'log' && entry.message.includes('Docker connection established')),
    );
});

test('startService skips pull and run when container is already running', async () => {
    const dockerInstance = createStubDocker({
        listContainers: async () => [
            {
                Id: 'running-test',
                Names: ['/noona-test'],
                State: 'running',
                Status: 'Up 10 seconds',
            },
        ],
    });
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

test('startService recreates a stopped container before launching it again', async () => {
    const pullCalls = [];
    const runCalls = [];
    const waitCalls = [];
    const removeCalls = [];
    const dockerInstance = createStubDocker({
        listContainers: async () => [
            {
                Id: 'stopped-test',
                Names: ['/noona-test'],
                State: 'exited',
                Status: 'Exited (0) 5 seconds ago',
            },
        ],
    });
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async (_name, options = {}) => {
            assert.equal(options?.dockerInstance, dockerInstance);
            return true;
        },
        removeContainers: async (name, options = {}) => {
            removeCalls.push({name, dockerInstance: options?.dockerInstance});
        },
        pullImageIfNeeded: async (image, options = {}) => {
            pullCalls.push({image, dockerInstance: options?.dockerInstance});
        },
        runContainerWithLogs: async (service, _networkName, trackedContainers, _debug, options = {}) => {
            trackedContainers.add(service.name);
            runCalls.push({service: service.name, dockerInstance: options?.dockerInstance});
        },
        waitForHealthyStatus: async (name, url) => {
            waitCalls.push({name, url});
        },
    };
    const warden = buildWarden({
        dockerInstance,
        dockerUtils,
        services: {addon: {}, core: {}},
        logger: {
            log: () => {
            }, warn: () => {
            }
        },
        hostDockerSockets: [],
    });

    await warden.startService(
        {name: 'noona-test', image: noonaImage('noona-test')},
        'http://health.local',
    );

    assert.deepEqual(removeCalls, [{name: 'noona-test', dockerInstance}]);
    assert.deepEqual(pullCalls, [{image: noonaImage('noona-test'), dockerInstance}]);
    assert.deepEqual(runCalls, [{service: 'noona-test', dockerInstance}]);
    assert.deepEqual(waitCalls, [{name: 'noona-test', url: 'http://health.local'}]);
});

test('startService can reuse a stopped container without recreating it', async () => {
    const waitCalls = [];
    const removeCalls = [];
    const startCalls = [];
    const dockerInstance = createStubDocker({
        listContainers: async () => [
            {
                Id: 'stopped-test',
                Names: ['/noona-test'],
                State: 'exited',
                Status: 'Exited (0) 5 seconds ago',
            },
        ],
        getContainer: (name) => ({
            start: async () => {
                startCalls.push(name);
            },
        }),
    });
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async (_name, options = {}) => {
            assert.equal(options?.dockerInstance, dockerInstance);
            return true;
        },
        removeContainers: async (name) => {
            removeCalls.push(name);
        },
        pullImageIfNeeded: async () => {
            throw new Error('pullImageIfNeeded should not be called when reusing a stopped container');
        },
        runContainerWithLogs: async () => {
            throw new Error('runContainerWithLogs should not be called when reusing a stopped container');
        },
        waitForHealthyStatus: async (name, url) => {
            waitCalls.push({name, url});
        },
    };
    const warden = buildWarden({
        dockerInstance,
        dockerUtils,
        services: {addon: {}, core: {}},
        logger: {
            log: () => {
            }, warn: () => {
            }
        },
        hostDockerSockets: [],
    });

    await warden.startService(
        {name: 'noona-test', image: noonaImage('noona-test')},
        'http://health.local',
        {reuseStoppedContainer: true},
    );

    assert.deepEqual(removeCalls, []);
    assert.deepEqual(startCalls, ['noona-test']);
    assert.deepEqual(waitCalls, [{name: 'noona-test', url: 'http://health.local'}]);
});

test('stopService stops compose-style containers without removing them by default', async () => {
    const operations = [];
    const dockerInstance = createStubDocker({
        listContainers: async () => [
            {
                Id: 'vault-compose-1',
                Names: ['/stack_noona-vault_1'],
                State: 'running',
                Status: 'Up 5 minutes',
            },
        ],
        getContainer: (id) => ({
            stop: async () => operations.push(`stop:${id}`),
            remove: async () => operations.push(`remove:${id}`),
        }),
    });
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => true,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerInstance,
        dockerUtils,
        services: {addon: {}, core: {'noona-vault': {name: 'noona-vault'}}},
        hostDockerSockets: [],
    });

    const result = await warden.stopService('noona-vault');

    assert.deepEqual(operations, ['stop:vault-compose-1']);
    assert.deepEqual(result, {
        service: 'noona-vault',
        stopped: true,
        removed: false,
        reason: null,
    });
});

test('listServices returns sorted metadata with host URLs plus distinct installed and running state', async () => {
    const dockerInstance = createStubDocker({
        listContainers: async () => ([
            {Names: ['/stack_noona-redis_1'], State: 'exited', Status: 'Exited (0) 5 seconds ago'},
            {Names: ['/stack_noona-sage_1'], State: 'running', Status: 'Up 5 seconds'},
        ]),
    });
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
            running: false,
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
            running: false,
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
            installed: true,
            running: true,
            required: false,
        },
    ]);
    assert.equal(warnings.length, 0);

    const redis = services.find((entry) => entry.name === 'noona-redis');
    assert.equal(redis?.required, true);
    assert.equal(redis?.installed, true);
    assert.equal(redis?.running, false);
    assert.equal(services.find((entry) => entry.name === 'noona-moon')?.required, false);
    assert.equal(services.find((entry) => entry.name === 'noona-sage')?.running, true);

    const installable = await warden.listServices({ includeInstalled: false });
    assert.deepEqual(
        installable.map((service) => service.name),
        ['noona-moon'],
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

test('installServices uses the persisted setup profile when no explicit services are supplied', async () => {
    const warden = buildWarden({
        fs: createMemoryFs(),
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-portal': {
                    name: 'noona-portal',
                    image: 'portal',
                    port: 3003,
                    envConfig: [
                        {key: 'DISCORD_BOT_TOKEN'},
                        {key: 'DISCORD_CLIENT_ID'},
                        {key: 'DISCORD_CLIENT_SECRET'},
                        {key: 'DISCORD_GUILD_ID'},
                        {key: 'KAVITA_BASE_URL'},
                        {key: 'KAVITA_API_KEY'},
                    ],
                },
                'noona-raven': {
                    name: 'noona-raven',
                    image: 'raven',
                    port: 3006,
                    envConfig: [
                        {key: 'KAVITA_BASE_URL'},
                        {key: 'KAVITA_API_KEY'},
                        {key: 'KAVITA_DATA_MOUNT'},
                        {key: 'KAVITA_LIBRARY_ROOT'},
                    ],
                },
            },
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    await warden.saveSetupConfig({
        version: 3,
        storageRoot: '/srv/noona',
        kavita: {
            mode: 'external',
            baseUrl: 'https://kavita.example',
            apiKey: 'kavita-api',
            sharedLibraryPath: '/mnt/manga',
            account: {
                username: '',
                email: '',
                password: '',
            },
        },
        komf: {
            mode: 'external',
            baseUrl: '',
            applicationYml: '',
        },
        discord: {
            botToken: 'portal-token',
            clientId: 'client-id',
            clientSecret: 'client-secret',
            guildId: 'guild-id',
        },
    }, {apply: false});

    const results = await warden.installServices([]);

    assert.deepEqual(results.map((entry) => entry.name), ['noona-portal', 'noona-raven']);
    assert.deepEqual(started, ['noona-portal', 'noona-raven']);
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
    assert.ok(
        tracked.some(
            (event) =>
                event.name === 'noona-redis' &&
                ['pending', 'downloading', 'installing', 'installed'].includes(event.status),
        ),
    );
    assert.ok(
        tracked.some(
            (event) =>
                event.name === 'noona-portal' &&
                ['pending', 'downloading', 'installing', 'installed'].includes(event.status),
        ),
    );
    const completion = events.find((event) => event.type === 'complete');
    assert.deepEqual(completion, { type: 'complete', hasErrors: false });
});

test('installServices keeps Portal on the control network while Vault bridges the private data network', async () => {
    const started = [];
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis', image: 'redis'},
                'noona-mongo': {name: 'noona-mongo', image: 'mongo'},
            },
            core: {
                'noona-vault': {name: 'noona-vault', image: 'vault'},
                'noona-portal': {name: 'noona-portal', image: 'portal'},
            },
        },
        networkName: 'noona-control-test',
        dataNetworkName: 'noona-data-test',
        hostDockerSockets: [],
    });

    warden.startService = async (service) => {
        started.push({
            name: service.name,
            networks: [...(service.networks || [])],
        });
    };

    await warden.installServices([{name: 'noona-portal'}]);

    assert.deepEqual(
        started.map((entry) => entry.name),
        ['noona-mongo', 'noona-redis', 'noona-vault', 'noona-portal'],
    );
    assert.deepEqual(
        started.find((entry) => entry.name === 'noona-mongo')?.networks,
        ['noona-data-test'],
    );
    assert.deepEqual(
        started.find((entry) => entry.name === 'noona-redis')?.networks,
        ['noona-data-test'],
    );
    assert.deepEqual(
        started.find((entry) => entry.name === 'noona-vault')?.networks,
        ['noona-control-test', 'noona-data-test'],
    );
    assert.deepEqual(
        started.find((entry) => entry.name === 'noona-portal')?.networks,
        ['noona-control-test'],
    );
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

test('installServices mounts Redis and Mongo under the shared Noona vault folder', async () => {
    const started = [];
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async (service, _network, tracked, _debug, options) => {
            tracked.add(service.name);
            started.push({
                name: service.name,
                env: [...(service.env || [])],
                volumes: [...(service.volumes || [])],
            });
            options?.onLog?.('container started', {});
        },
        waitForHealthyStatus: async () => {
        },
    };
    const services = {
        addon: {
            'noona-redis': {name: 'noona-redis', image: 'redis', port: 6379},
            'noona-mongo': {name: 'noona-mongo', image: 'mongo', port: 27017},
        },
        core: {
            'noona-vault': {name: 'noona-vault', image: 'vault', port: 3005},
            'noona-raven': {name: 'noona-raven', image: 'raven'},
        },
    };

    const warden = buildWarden({
        dockerUtils,
        services,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerInstance: createStubDocker({
            listContainers: async () => [],
        }),
        hostDockerSockets: [],
    });

    await warden.installServices([
        {name: 'noona-vault', env: {VAULT_DATA_FOLDER: 'vault-store'}},
        {name: 'noona-raven', env: {KAVITA_DATA_MOUNT: '/srv/noona/raven'}},
    ]);

    const redisStart = started.find((entry) => entry.name === 'noona-redis');
    const mongoStart = started.find((entry) => entry.name === 'noona-mongo');
    assert.ok(redisStart, 'Redis should be started');
    assert.ok(mongoStart, 'Mongo should be started');

    const expectedVaultRoot = path.join(path.normalize('/srv/noona'), 'vault-store');
    const expectedRedisMount = `${path.join(expectedVaultRoot, 'redis')}:/data`;
    const expectedMongoMount = `${path.join(expectedVaultRoot, 'mongo')}:/data/db`;

    assert.ok(redisStart.volumes.includes(expectedRedisMount));
    assert.ok(mongoStart.volumes.includes(expectedMongoMount));
    assert.ok(redisStart.env.includes('VAULT_DATA_FOLDER=vault-store'));
    assert.ok(mongoStart.env.includes('VAULT_DATA_FOLDER=vault-store'));
});

test('getStorageLayout exposes dedicated log container paths for managed services', () => {
    const warden = buildWarden({
        services: {addon: {}, core: {}},
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        hostDockerSockets: [],
    });

    const layout = warden.getStorageLayout({
        installOverridesByName: new Map([
            ['noona-vault', {VAULT_DATA_FOLDER: 'vault-store'}],
        ]),
    });

    const findFolder = (serviceName, key) => {
        const service = layout.services.find((entry) => entry.service === serviceName);
        return service?.folders.find((entry) => entry.key === key) ?? null;
    };

    assert.equal(findFolder('noona-moon', 'logs')?.containerPath, '/var/log/noona');
    assert.equal(findFolder('noona-portal', 'logs')?.containerPath, '/var/log/noona');
    assert.equal(findFolder('noona-raven', 'logs')?.containerPath, '/app/logs');
    assert.equal(findFolder('noona-sage', 'logs')?.containerPath, '/var/log/noona');
    assert.equal(findFolder('noona-vault', 'logs')?.containerPath, '/var/log/noona');
    assert.equal(
        findFolder('noona-vault', 'logs')?.hostPath,
        path.join(path.normalize('/srv/noona'), 'vault-store', 'logs'),
    );
});

test('installServices mounts managed service log folders and injects NOONA_LOG_DIR', async () => {
    const started = [];
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async (service, _network, tracked, _debug, options) => {
            tracked.add(service.name);
            started.push({
                name: service.name,
                env: [...(service.env || [])],
                volumes: [...(service.volumes || [])],
            });
            options?.onLog?.('container started', {});
        },
        waitForHealthyStatus: async () => {
        },
    };
    const services = {
        addon: {
            'noona-redis': {name: 'noona-redis', image: 'redis', port: 6379},
            'noona-mongo': {name: 'noona-mongo', image: 'mongo', port: 27017},
        },
        core: {
            'noona-moon': {name: 'noona-moon', image: 'moon', port: 3000},
            'noona-portal': {name: 'noona-portal', image: 'portal', port: 3003},
            'noona-raven': {name: 'noona-raven', image: 'raven', port: 8080},
            'noona-vault': {name: 'noona-vault', image: 'vault', port: 3005},
        },
    };

    const warden = buildWarden({
        dockerUtils,
        services,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerInstance: createStubDocker({
            listContainers: async () => [],
        }),
        hostDockerSockets: [],
    });

    await warden.installServices([
        {name: 'noona-moon'},
        {name: 'noona-portal'},
        {name: 'noona-raven'},
        {name: 'noona-vault', env: {VAULT_DATA_FOLDER: 'vault-store'}},
    ]);

    const moonStart = started.find((entry) => entry.name === 'noona-moon');
    const portalStart = started.find((entry) => entry.name === 'noona-portal');
    const ravenStart = started.find((entry) => entry.name === 'noona-raven');
    const vaultStart = started.find((entry) => entry.name === 'noona-vault');

    assert.ok(moonStart, 'Moon should be started');
    assert.ok(portalStart, 'Portal should be started');
    assert.ok(ravenStart, 'Raven should be started');
    assert.ok(vaultStart, 'Vault should be started');

    assert.ok(moonStart.env.includes('NOONA_LOG_DIR=/var/log/noona'));
    assert.ok(moonStart.volumes.includes(`${path.join('/srv/noona', 'moon', 'logs')}:/var/log/noona`));

    assert.ok(portalStart.env.includes('NOONA_LOG_DIR=/var/log/noona'));
    assert.ok(portalStart.volumes.includes(`${path.join('/srv/noona', 'portal', 'logs')}:/var/log/noona`));

    assert.ok(ravenStart.env.includes('NOONA_LOG_DIR=/app/logs'));
    assert.ok(ravenStart.volumes.includes(`${path.join('/srv/noona', 'raven', 'downloads')}:/downloads`));
    assert.ok(ravenStart.volumes.includes(`${path.join('/srv/noona', 'raven', 'logs')}:/app/logs`));

    assert.ok(vaultStart.env.includes('NOONA_LOG_DIR=/var/log/noona'));
    assert.ok(vaultStart.volumes.includes(`${path.join('/srv/noona', 'vault-store', 'logs')}:/var/log/noona`));
});

test('startService bootstraps managed log folders through helper container during storage bootstrap', async () => {
    const helperCreateCalls = [];
    const lifecycleEvents = [];
    let startedService = null;
    const dockerInstance = createStubDocker({
        createContainer: async (config) => {
            helperCreateCalls.push(config);
            return {
                start: async () => {
                    lifecycleEvents.push('helper:start');
                },
                wait: async () => {
                    lifecycleEvents.push('helper:wait');
                    return {StatusCode: 0};
                },
            };
        },
    });
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async (service) => {
            lifecycleEvents.push('service:start');
            startedService = service;
            return {Id: 'noona-moon-container'};
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerInstance,
        dockerUtils,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    user: '1000:1001',
                },
            },
        },
        storageLayoutBootstrap: true,
    });

    await warden.startService({
        name: 'noona-moon',
        image: 'moon',
        port: 3000,
        user: '1000:1001',
    });

    assert.deepEqual(lifecycleEvents, ['helper:start', 'helper:wait', 'service:start']);
    assert.equal(helperCreateCalls.length, 1);
    assert.equal(helperCreateCalls[0]?.Image, 'busybox:1.36');
    assert.match(helperCreateCalls[0]?.HostConfig?.Binds?.[0] ?? '', /moon[\\/]logs:\/target$/);
    assert.match(helperCreateCalls[0]?.Cmd?.[2] ?? '', /mkdir -p \/target/);
    assert.match(helperCreateCalls[0]?.Cmd?.[2] ?? '', /chown -R 1000:1001 \/target; chmod 775 \/target/);
    assert.ok(startedService?.env?.includes('NOONA_LOG_DIR=/var/log/noona'));
    assert.ok(startedService?.volumes?.includes(`${path.join('/srv/noona', 'moon', 'logs')}:/var/log/noona`));
});

test('restartService fails fast when containerized Warden is missing the same-path NOONA_DATA_ROOT bind', async () => {
    let started = false;
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        removeContainers: async () => [],
        runContainerWithLogs: async () => {
            started = true;
        },
        waitForContainerHealthy: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };

    const warden = buildWarden({
        dockerUtils,
        services: {
            addon: {},
            core: {
                'noona-vault': {name: 'noona-vault', image: 'vault', port: 3005},
            },
        },
        env: {
            HOSTNAME: 'warden-self',
            NOONA_DATA_ROOT: '/srv/noona',
        },
        dockerInstance: createStubDocker({
            getContainer: (name) => ({
                inspect: async () => {
                    if (name === 'warden-self') {
                        return {
                            Name: '/noona-warden',
                            Mounts: [
                                {
                                    Type: 'bind',
                                    Source: '/var/run/docker.sock',
                                    Destination: '/var/run/docker.sock',
                                },
                            ],
                        };
                    }

                    const error = new Error('Not found');
                    error.statusCode = 404;
                    throw error;
                },
            }),
        }),
        hostDockerSockets: [],
    });

    await assert.rejects(
        () => warden.restartService('noona-vault'),
        /Containerized Warden must bind-mount NOONA_DATA_ROOT '\/srv\/noona'.*-v \/srv\/noona:\/srv\/noona/s,
    );
    assert.equal(started, false);
});

test('restartService mounts Vault TLS assets when containerized Warden shares NOONA_DATA_ROOT at the same path', async () => {
    const started = [];
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        removeContainers: async () => [],
        runContainerWithLogs: async (service, _network, tracked, _debug, options) => {
            tracked.add(service.name);
            started.push({
                name: service.name,
                volumes: [...(service.volumes || [])],
            });
            options?.onLog?.('container started', {});
        },
        waitForContainerHealthy: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };

    const warden = buildWarden({
        dockerUtils,
        services: {
            addon: {},
            core: {
                'noona-vault': {name: 'noona-vault', image: 'vault', port: 3005},
            },
        },
        env: {
            HOSTNAME: 'warden-self',
            NOONA_DATA_ROOT: '/srv/noona',
        },
        dockerInstance: createStubDocker({
            getContainer: (name) => ({
                inspect: async () => {
                    if (name === 'warden-self') {
                        return {
                            Name: '/noona-warden',
                            Mounts: [
                                {
                                    Type: 'bind',
                                    Source: '/srv/noona',
                                    Destination: '/srv/noona',
                                },
                            ],
                        };
                    }

                    const error = new Error('Not found');
                    error.statusCode = 404;
                    throw error;
                },
            }),
        }),
        hostDockerSockets: [],
    });

    await warden.restartService('noona-vault');

    assert.equal(started.length, 1);
    assert.ok(
        started[0].volumes.includes(`${path.join('/srv/noona', 'vault', 'tls')}:/var/lib/noona/vault-tls`),
        'Vault should receive the shared TLS bind mount when Warden shares the same storage root.',
    );
});

test('installServices respects explicit Redis and Mongo host mount folder overrides from Vault settings', async () => {
    const started = [];
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async (service, _network, tracked, _debug, options) => {
            tracked.add(service.name);
            started.push({
                name: service.name,
                env: [...(service.env || [])],
                volumes: [...(service.volumes || [])],
            });
            options?.onLog?.('container started', {});
        },
        waitForHealthyStatus: async () => {
        },
    };
    const services = {
        addon: {
            'noona-redis': {name: 'noona-redis', image: 'redis', port: 6379},
            'noona-mongo': {name: 'noona-mongo', image: 'mongo', port: 27017},
        },
        core: {
            'noona-vault': {name: 'noona-vault', image: 'vault', port: 3005},
            'noona-raven': {name: 'noona-raven', image: 'raven'},
        },
    };

    const warden = buildWarden({
        dockerUtils,
        services,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerInstance: createStubDocker({
            listContainers: async () => [],
        }),
        hostDockerSockets: [],
    });

    await warden.installServices([
        {
            name: 'noona-vault',
            env: {
                VAULT_DATA_FOLDER: 'vault-store',
                VAULT_REDIS_HOST_MOUNT_PATH: './data/redis-custom',
                VAULT_MONGO_HOST_MOUNT_PATH: './data/mongo-custom',
            },
        },
        {name: 'noona-raven', env: {KAVITA_DATA_MOUNT: '/srv/noona/raven'}},
    ]);

    const redisStart = started.find((entry) => entry.name === 'noona-redis');
    const mongoStart = started.find((entry) => entry.name === 'noona-mongo');
    assert.ok(redisStart, 'Redis should be started');
    assert.ok(mongoStart, 'Mongo should be started');

    const expectedRedisMount = `${path.resolve(process.cwd(), 'data/redis-custom')}:/data`;
    const expectedMongoMount = `${path.resolve(process.cwd(), 'data/mongo-custom')}:/data/db`;
    assert.ok(redisStart.volumes.includes(expectedRedisMount));
    assert.ok(mongoStart.volumes.includes(expectedMongoMount));
});

test('startService defaults Redis Vault folder name to "vault"', async () => {
    const started = [];
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async (service, _network, tracked, _debug, options) => {
            tracked.add(service.name);
            started.push(service);
            options?.onLog?.('container started', {});
        },
        waitForHealthyStatus: async () => {
        },
    };

    const warden = buildWarden({
        dockerUtils,
        services: {addon: {}, core: {}},
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerInstance: createStubDocker({
            getContainer: () => ({
                inspect: async () => {
                    const error = new Error('Not found');
                    error.statusCode = 404;
                    throw error;
                },
            }),
        }),
        hostDockerSockets: [],
    });

    await warden.startService({name: 'noona-redis', image: 'redis', env: []});

    assert.equal(started.length, 1);
    const [service] = started;
    assert.ok(service.env.includes('VAULT_DATA_FOLDER=vault'));
    assert.ok(Array.isArray(service.volumes));
    const mount = service.volumes.find((entry) => typeof entry === 'string' && entry.endsWith(':/data'));
    assert.ok(mount, 'Redis should include a /data bind mount');
    assert.match(mount, /vault[\\/]+redis:\/data$/);
});

test('installServices wires managed Kavita and noona-komf into the shared Noona storage root', async () => {
    const started = [];
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async (service, _network, tracked, _debug, options) => {
            tracked.add(service.name);
            started.push({
                name: service.name,
                env: [...(service.env || [])],
                volumes: [...(service.volumes || [])],
                user: service.user ?? null,
                restartPolicy: service.restartPolicy ?? null,
            });
            options?.onLog?.('container started', {});
        },
        waitForHealthyStatus: async () => {
        },
    };
    const services = {
        addon: {
            'noona-kavita': {
                name: 'noona-kavita',
                image: noonaImage('noona-kavita'),
                port: 5000,
                env: ['TZ=UTC']
            },
            'noona-komf': {
                name: 'noona-komf',
                image: 'sndxr/komf:latest',
                port: 8085,
                env: ['KOMF_KAVITA_BASE_URI=http://noona-kavita:5000', 'KOMF_KAVITA_API_KEY='],
                user: '1000:1000',
                restartPolicy: {Name: 'unless-stopped'},
            },
            'noona-redis': {name: 'noona-redis', image: 'redis', port: 6379},
            'noona-mongo': {name: 'noona-mongo', image: 'mongo', port: 27017},
        },
        core: {
            'noona-vault': {name: 'noona-vault', image: 'vault', port: 3005},
            'noona-raven': {name: 'noona-raven', image: 'raven'},
        },
    };

    const warden = buildWarden({
        dockerUtils,
        services,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerInstance: createStubDocker({
            listContainers: async () => [],
        }),
        hostDockerSockets: [],
    });

    await warden.installServices([
        {
            name: 'noona-kavita',
            env: {
                KAVITA_ADMIN_USERNAME: 'reader-admin',
                KAVITA_ADMIN_EMAIL: 'reader-admin@example.com',
                KAVITA_ADMIN_PASSWORD: 'Password123!',
            },
        },
        {name: 'noona-komf', env: {KOMF_KAVITA_API_KEY: 'api-key'}},
    ]);

    const kavitaStart = started.find((entry) => entry.name === 'noona-kavita');
    const komfStart = started.find((entry) => entry.name === 'noona-komf');

    assert.ok(kavitaStart, 'Kavita should be started');
    assert.ok(komfStart, 'Komf should be started');

    assert.ok(kavitaStart.volumes.includes(`${path.join('/srv/noona', 'kavita', 'config')}:/kavita/config`));
    assert.ok(kavitaStart.volumes.includes(`${path.join('/srv/noona', 'raven', 'downloads')}:/manga`));
    assert.ok(kavitaStart.env.includes('KAVITA_ADMIN_USERNAME=reader-admin'));
    assert.ok(kavitaStart.env.includes('KAVITA_ADMIN_EMAIL=reader-admin@example.com'));
    assert.ok(kavitaStart.env.includes('KAVITA_ADMIN_PASSWORD=Password123!'));
    assert.ok(komfStart.volumes.includes(`${path.join('/srv/noona', 'komf', 'config')}:/config`));
    assert.ok(komfStart.env.includes('KOMF_KAVITA_BASE_URI=http://noona-kavita:5000'));
    assert.ok(komfStart.env.includes('KOMF_KAVITA_API_KEY=api-key'));
    assert.equal(komfStart.user, '1000:1000');
    assert.deepEqual(komfStart.restartPolicy, {Name: 'unless-stopped'});
});

test('installServices provisions managed Kavita API keys before starting portal and noona-komf', async () => {
    const started = [];
    const fetchCalls = [];
    let loginAttempts = 0;
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async (service, _network, tracked, _debug, options) => {
            tracked.add(service.name);
            started.push({
                name: service.name,
                env: [...(service.env || [])],
            });
            options?.onLog?.('container started', {});
        },
        waitForHealthyStatus: async () => {
        },
    };
    const services = {
        addon: {
            'noona-mongo': {name: 'noona-mongo', image: 'mongo', port: 27017},
            'noona-redis': {name: 'noona-redis', image: 'redis', port: 6379},
            'noona-kavita': {
                name: 'noona-kavita',
                image: noonaImage('noona-kavita'),
                port: 5000,
                internalPort: 5000,
                health: 'http://noona-kavita:5000/api/Health',
                env: [
                    'KAVITA_ADMIN_USERNAME=reader-admin',
                    'KAVITA_ADMIN_EMAIL=reader-admin@example.com',
                    'KAVITA_ADMIN_PASSWORD=Password123!',
                ],
            },
            'noona-komf': {
                name: 'noona-komf',
                image: 'sndxr/komf:latest',
                port: 8085,
                env: [
                    'KOMF_KAVITA_BASE_URI=http://noona-kavita:5000',
                    'KOMF_KAVITA_API_KEY=',
                ],
            },
        },
        core: {
            'noona-vault': {name: 'noona-vault', image: 'vault', port: 3005},
            'noona-raven': {name: 'noona-raven', image: 'raven'},
            'noona-portal': {
                name: 'noona-portal',
                image: 'portal',
                port: 3003,
                env: [
                    'KAVITA_BASE_URL=http://noona-kavita:5000',
                    'KAVITA_API_KEY=',
                    'VAULT_BASE_URL=https://noona-vault:3005',
                    'VAULT_API_TOKEN=vault-token',
                    'DISCORD_BOT_TOKEN=discord-token',
                    'DISCORD_CLIENT_ID=discord-client',
                    'DISCORD_GUILD_ID=discord-guild',
                ],
            },
        },
    };

    const warden = buildWarden({
        dockerUtils,
        services,
        dockerInstance: createStubDocker({
            listContainers: async () => [],
        }),
        fetchImpl: async (url, options = {}) => {
            const requestUrl = new URL(url);
            fetchCalls.push({
                pathname: requestUrl.pathname,
                method: options.method,
                body: options.body ? JSON.parse(options.body) : null,
            });

            if (requestUrl.pathname === '/api/Account/login') {
                loginAttempts += 1;
                if (loginAttempts === 1) {
                    return {
                        ok: false,
                        status: 401,
                        text: async () => JSON.stringify({error: 'Unauthorized'}),
                    };
                }

                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({token: 'managed-jwt-token'}),
                };
            }

            if (requestUrl.pathname === '/api/Account/register') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 7, username: 'reader-admin'}),
                };
            }

            if (requestUrl.pathname === '/api/Account/auth-keys') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify([
                        {id: 9, key: 'managed-api-key', name: 'Noona Managed Services'},
                    ]),
                };
            }

            if (requestUrl.pathname === '/api/plugin/authenticate') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({username: 'reader-admin', token: 'plugin-token'}),
                };
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`);
        },
        hostDockerSockets: [],
    });

    await warden.installServices([
        {name: 'noona-portal'},
        {name: 'noona-kavita'},
        {name: 'noona-komf'},
    ]);

    assert.deepEqual(
        started.map((entry) => entry.name),
        ['noona-mongo', 'noona-redis', 'noona-vault', 'noona-kavita', 'noona-komf', 'noona-portal'],
    );

    const portalStart = started.find((entry) => entry.name === 'noona-portal');
    const komfStart = started.find((entry) => entry.name === 'noona-komf');

    assert.ok(portalStart.env.includes('KAVITA_BASE_URL=http://noona-kavita:5000'));
    assert.ok(portalStart.env.includes('KAVITA_API_KEY=managed-api-key'));
    assert.ok(komfStart.env.includes('KOMF_KAVITA_BASE_URI=http://noona-kavita:5000'));
    assert.ok(komfStart.env.includes('KOMF_KAVITA_API_KEY=managed-api-key'));
    assert.deepEqual(
        fetchCalls.map((entry) => entry.pathname),
        [
            '/api/Account/login',
            '/api/Account/register',
            '/api/Account/login',
            '/api/Account/auth-keys',
            '/api/plugin/authenticate',
        ],
    );
});

test('installServices keeps managed Kavita startup moving when Vault warm-up blocks runtime config persistence', async () => {
    const started = [];
    const warnings = [];
    const fetchCalls = [];
    let loginAttempts = 0;
    const memoryFs = createMemoryFs();
    const warmupError = new Error(
        "All Vault endpoints failed: https://noona-vault:3005 (Unable to read Vault CA certificate at /srv/noona/vault/tls/ca-cert.pem: ENOENT: no such file or directory, open '/srv/noona/vault/tls/ca-cert.pem')",
    );
    warmupError.code = 'ENOENT';
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async (service, _network, tracked, _debug, options) => {
            tracked.add(service.name);
            started.push({
                name: service.name,
                env: [...(service.env || [])],
            });
            options?.onLog?.('container started', {});
        },
        waitForHealthyStatus: async () => {
        },
    };
    const services = {
        addon: {
            'noona-mongo': {name: 'noona-mongo', image: 'mongo', port: 27017},
            'noona-redis': {name: 'noona-redis', image: 'redis', port: 6379},
            'noona-kavita': {
                name: 'noona-kavita',
                image: noonaImage('noona-kavita'),
                port: 5000,
                internalPort: 5000,
                health: 'http://noona-kavita:5000/api/Health',
                env: [
                    'KAVITA_ADMIN_USERNAME=reader-admin',
                    'KAVITA_ADMIN_EMAIL=reader-admin@example.com',
                    'KAVITA_ADMIN_PASSWORD=Password123!',
                ],
            },
            'noona-komf': {
                name: 'noona-komf',
                image: 'sndxr/komf:latest',
                port: 8085,
                env: [
                    'KOMF_KAVITA_BASE_URI=http://noona-kavita:5000',
                    'KOMF_KAVITA_API_KEY=',
                ],
            },
        },
        core: {
            'noona-vault': {name: 'noona-vault', image: 'vault', port: 3005},
            'noona-raven': {name: 'noona-raven', image: 'raven'},
            'noona-portal': {
                name: 'noona-portal',
                image: 'portal',
                port: 3003,
                env: [
                    'KAVITA_BASE_URL=http://noona-kavita:5000',
                    'KAVITA_API_KEY=',
                    'VAULT_BASE_URL=https://noona-vault:3005',
                    'VAULT_API_TOKEN=vault-token',
                    'DISCORD_BOT_TOKEN=discord-token',
                    'DISCORD_CLIENT_ID=discord-client',
                    'DISCORD_GUILD_ID=discord-guild',
                ],
            },
        },
    };

    const warden = buildWarden({
        dockerUtils,
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        logger: {
            log: () => {
            },
            warn: (message) => warnings.push(String(message)),
        },
        services,
        settings: {
            client: {
                mongo: {
                    update: async () => {
                        throw warmupError;
                    },
                    delete: async () => {
                        throw warmupError;
                    },
                },
            },
        },
        dockerInstance: createStubDocker({
            listContainers: async () => [],
        }),
        fetchImpl: async (url, options = {}) => {
            const requestUrl = new URL(url);
            fetchCalls.push(requestUrl.pathname);

            if (requestUrl.pathname === '/api/Account/login') {
                loginAttempts += 1;
                if (loginAttempts === 1) {
                    return {
                        ok: false,
                        status: 401,
                        text: async () => JSON.stringify({error: 'Unauthorized'}),
                    };
                }

                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({token: 'managed-jwt-token'}),
                };
            }

            if (requestUrl.pathname === '/api/Account/register') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 7, username: 'reader-admin'}),
                };
            }

            if (requestUrl.pathname === '/api/Account/auth-keys') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify([
                        {id: 9, key: 'managed-api-key', name: 'Noona Managed Services'},
                    ]),
                };
            }

            if (requestUrl.pathname === '/api/plugin/authenticate') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({username: 'reader-admin', token: 'plugin-token'}),
                };
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`);
        },
        hostDockerSockets: [],
    });

    await warden.installServices([
        {name: 'noona-portal'},
        {name: 'noona-kavita'},
        {name: 'noona-komf'},
    ]);

    assert.deepEqual(
        started.map((entry) => entry.name),
        ['noona-mongo', 'noona-redis', 'noona-vault', 'noona-kavita', 'noona-komf', 'noona-portal'],
    );
    assert.deepEqual(fetchCalls, [
        '/api/Account/login',
        '/api/Account/register',
        '/api/Account/login',
        '/api/Account/auth-keys',
        '/api/plugin/authenticate',
    ]);

    const portalStart = started.find((entry) => entry.name === 'noona-portal');
    const komfStart = started.find((entry) => entry.name === 'noona-komf');
    assert.ok(portalStart.env.includes('KAVITA_API_KEY=managed-api-key'));
    assert.ok(komfStart.env.includes('KOMF_KAVITA_API_KEY=managed-api-key'));

    const runtimeSnapshotPath = path.join('/srv/noona', 'warden', 'service-runtime-config.json');
    assert.equal(memoryFs.files.has(path.normalize(runtimeSnapshotPath)), true);
    const runtimeSnapshot = JSON.parse(memoryFs.files.get(path.normalize(runtimeSnapshotPath)));
    assert.equal(runtimeSnapshot.services['noona-portal'].env.KAVITA_API_KEY, 'managed-api-key');
    assert.equal(runtimeSnapshot.services['noona-komf'].env.KOMF_KAVITA_API_KEY, 'managed-api-key');
    assert.ok(
        warnings.some((message) =>
            message.includes('local snapshot fallback while Vault settings warm up'),
        ),
    );
});

test('startService bootstraps the shared Noona storage tree before launching services', async () => {
    const mkdirCalls = [];
    const warden = buildWarden({
        storageLayoutBootstrap: true,
        services: {
            addon: {},
            core: {
                'noona-sage': {name: 'noona-sage', image: 'sage', port: 3004},
            },
        },
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        fs: {
            mkdirSync(target, options) {
                mkdirCalls.push({target, options});
            },
        },
        dockerUtils: {
            ensureNetwork: async () => {
            },
            attachSelfToNetwork: async () => {
            },
            containerExists: async () => false,
            pullImageIfNeeded: async () => {
            },
            runContainerWithLogs: async (_service, _network, tracked) => {
                tracked.add('noona-sage');
            },
            waitForHealthyStatus: async () => {
            },
        },
        dockerInstance: createStubDocker({
            listContainers: async () => [],
        }),
        hostDockerSockets: [],
    });

    await warden.startService({name: 'noona-sage', image: 'sage', port: 3004});

    const ensuredTargets = new Set(mkdirCalls.map((entry) => entry.target));
    assert.ok(ensuredTargets.has(path.normalize('/srv/noona')));
    assert.ok(ensuredTargets.has(path.normalize(path.join('/srv/noona', 'moon', 'logs'))));
    assert.ok(ensuredTargets.has(path.normalize(path.join('/srv/noona', 'portal', 'logs'))));
    assert.ok(ensuredTargets.has(path.normalize(path.join('/srv/noona', 'raven', 'downloads'))));
    assert.ok(ensuredTargets.has(path.normalize(path.join('/srv/noona', 'sage', 'logs'))));
    assert.ok(ensuredTargets.has(path.normalize(path.join('/srv/noona', 'vault', 'mongo'))));
    assert.ok(ensuredTargets.has(path.normalize(path.join('/srv/noona', 'vault', 'redis'))));
    assert.ok(ensuredTargets.has(path.normalize(path.join('/srv/noona', 'kavita', 'config'))));
    assert.ok(ensuredTargets.has(path.normalize(path.join('/srv/noona', 'komf', 'config'))));

    for (const call of mkdirCalls) {
        assert.deepEqual(call.options, {recursive: true});
    }
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
                image: noonaImage('noona-raven'),
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
                image: noonaImage('noona-raven'),
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
                image: noonaImage('noona-raven'),
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
            'noona-raven': {name: 'noona-raven', image: noonaImage('noona-raven')},
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
                image: noonaImage('noona-raven'),
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
                    health: 'https://noona-vault:3005/v1/vault/health',
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
                'noona-kavita': {name: 'noona-kavita', health: 'http://kavita/health'},
                'noona-portal': {name: 'noona-portal', health: 'http://portal/health'},
                'noona-komf': {name: 'noona-komf'},
            },
        },
        logger: { log: () => {}, warn: (message) => warnings.push(message) },
    });

    const order = [];
    warden.startService = async (service, healthUrl, options = {}) => {
        order.push([service.name, healthUrl, options.reuseStoppedContainer === true]);
    };

    await warden.bootFull();

    assert.deepEqual(order, [
        ['noona-mongo', 'http://mongo/health', true],
        ['noona-redis', 'http://noona-redis:8001/', true],
        ['noona-vault', 'http://vault/health', true],
        ['noona-sage', 'http://noona-sage:3004/health', true],
        ['noona-moon', 'http://moon/health', true],
        ['noona-kavita', 'http://kavita/health', true],
        ['noona-raven', null, true],
        ['noona-komf', null, true],
        ['noona-portal', 'http://portal/health', true],
    ]);
    assert.equal(warnings.length, 0);
});

test('bootFull provisions managed Kavita API keys before starting dependent services', async () => {
    const fetchCalls = [];
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo'},
                'noona-kavita': {
                    name: 'noona-kavita',
                    port: 5000,
                    internalPort: 5000,
                    env: [
                        'KAVITA_ADMIN_USERNAME=reader-admin',
                        'KAVITA_ADMIN_EMAIL=reader-admin@example.com',
                        'KAVITA_ADMIN_PASSWORD=Password123!',
                    ],
                    health: 'http://kavita/health',
                },
                'noona-komf': {
                    name: 'noona-komf',
                    env: [
                        'KOMF_KAVITA_BASE_URI=http://noona-kavita:5000',
                        'KOMF_KAVITA_API_KEY=',
                    ],
                },
            },
            core: {
                'noona-vault': {name: 'noona-vault', health: 'http://vault/health'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', health: 'http://moon/health'},
                'noona-raven': {name: 'noona-raven'},
                'noona-portal': {
                    name: 'noona-portal',
                    health: 'http://portal/health',
                    env: [
                        'KAVITA_BASE_URL=http://noona-kavita:5000',
                        'KAVITA_API_KEY=',
                    ],
                },
            },
        },
        fetchImpl: async (url) => {
            const requestUrl = new URL(url);
            fetchCalls.push(requestUrl.pathname);

            if (requestUrl.pathname === '/api/Account/login') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({token: 'managed-jwt-token'}),
                };
            }

            if (requestUrl.pathname === '/api/Account/auth-keys') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify([
                        {id: 2, key: 'managed-api-key', name: 'Noona Managed Services'},
                    ]),
                };
            }

            if (requestUrl.pathname === '/api/plugin/authenticate') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({username: 'reader-admin', token: 'plugin-token'}),
                };
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`);
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service, healthUrl) => {
        started.push({
            name: service.name,
            healthUrl,
            env: [...(service.env || [])],
        });
    };

    await warden.bootFull({
        services: [
            'noona-redis',
            'noona-mongo',
            'noona-vault',
            'noona-sage',
            'noona-moon',
            'noona-raven',
            'noona-kavita',
            'noona-portal',
            'noona-komf',
        ],
    });

    const portalStart = started.find((entry) => entry.name === 'noona-portal');
    const komfStart = started.find((entry) => entry.name === 'noona-komf');

    assert.ok(portalStart.env.includes('KAVITA_API_KEY=managed-api-key'));
    assert.ok(komfStart.env.includes('KOMF_KAVITA_API_KEY=managed-api-key'));
    assert.deepEqual(fetchCalls, ['/api/Account/login', '/api/Account/auth-keys', '/api/plugin/authenticate']);
});

test('bootFull continues startup when managed Kavita credentials are missing during restore', async () => {
    const warnings = [];
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo'},
                'noona-kavita': {
                    name: 'noona-kavita',
                    port: 5000,
                    internalPort: 5000,
                    env: ['TZ=UTC'],
                    health: 'http://kavita/health',
                },
                'noona-komf': {
                    name: 'noona-komf',
                    env: [
                        'KOMF_KAVITA_BASE_URI=http://noona-kavita:5000',
                        'KOMF_KAVITA_API_KEY=',
                    ],
                },
            },
            core: {
                'noona-vault': {name: 'noona-vault', health: 'http://vault/health'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', health: 'http://moon/health'},
                'noona-raven': {name: 'noona-raven'},
                'noona-portal': {
                    name: 'noona-portal',
                    health: 'http://portal/health',
                    env: [
                        'KAVITA_BASE_URL=http://noona-kavita:5000',
                        'KAVITA_API_KEY=',
                    ],
                },
            },
        },
        fetchImpl: async () => {
            throw new Error('Managed Kavita HTTP calls should be skipped when credentials are missing during boot.');
        },
        logger: {
            log: () => {
            },
            warn: (message) => warnings.push(message),
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service, healthUrl) => {
        started.push({
            name: service.name,
            healthUrl,
            env: [...(service.env || [])],
        });
    };

    await warden.bootFull({
        services: [
            'noona-redis',
            'noona-mongo',
            'noona-vault',
            'noona-sage',
            'noona-moon',
            'noona-raven',
            'noona-kavita',
            'noona-portal',
            'noona-komf',
        ],
    });

    assert.ok(started.some((entry) => entry.name === 'noona-portal'));
    assert.ok(started.some((entry) => entry.name === 'noona-komf'));
    assert.ok(
        warnings.some((message) =>
            String(message).includes('Managed Kavita API key provisioning skipped because KAVITA_ADMIN_USERNAME'),
        ),
    );
});

test('bootFull validates recovered managed Portal Kavita API keys from existing container env during restore', async () => {
    const fetchCalls = [];
    const dockerInstance = createStubDocker({
        listContainers: async () => [
            {
                Id: 'portal-container',
                Names: ['/noona-portal'],
                State: 'running',
                Status: 'Up 3 minutes',
            },
        ],
        getContainer: (id) => ({
            inspect: async () => {
                if (id !== 'portal-container') {
                    throw new Error(`Unexpected container id: ${id}`);
                }

                return {
                    Config: {
                        Env: [
                            'KAVITA_BASE_URL=http://noona-kavita:5000',
                            'KAVITA_API_KEY=recovered-api-key',
                        ],
                    },
                };
            },
        }),
    });
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo'},
                'noona-kavita': {
                    name: 'noona-kavita',
                    port: 5000,
                    internalPort: 5000,
                    env: ['TZ=UTC'],
                    health: 'http://kavita/health',
                },
            },
            core: {
                'noona-vault': {name: 'noona-vault', health: 'http://vault/health'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', health: 'http://moon/health'},
                'noona-raven': {name: 'noona-raven'},
                'noona-portal': {
                    name: 'noona-portal',
                    health: 'http://portal/health',
                    env: [
                        'KAVITA_BASE_URL=http://noona-kavita:5000',
                        'KAVITA_API_KEY=',
                    ],
                },
            },
        },
        fetchImpl: async (url) => {
            const requestUrl = new URL(url);
            fetchCalls.push(requestUrl.pathname);

            if (requestUrl.pathname === '/api/plugin/authenticate') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({username: 'reader-admin', token: 'plugin-token'}),
                };
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`);
        },
        dockerInstance,
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service, healthUrl, options = {}) => {
        started.push({
            name: service.name,
            healthUrl,
            env: [...(service.env || [])],
            recreate: options.recreate === true,
        });
    };

    await warden.bootFull({
        services: [
            'noona-redis',
            'noona-mongo',
            'noona-vault',
            'noona-sage',
            'noona-moon',
            'noona-raven',
            'noona-kavita',
            'noona-portal',
        ],
    });

    const portalStart = started.find((entry) => entry.name === 'noona-portal');
    assert.ok(portalStart, 'Portal should be started');
    assert.ok(portalStart.env.includes('KAVITA_API_KEY=recovered-api-key'));
    assert.deepEqual(fetchCalls, ['/api/plugin/authenticate']);
});

test('bootFull reloads persisted service configs from noona_settings before starting managed services', async () => {
    const settingsReads = [];
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo', health: 'http://mongo/health'},
            },
            core: {
                'noona-vault': {name: 'noona-vault', health: 'http://vault/health'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', port: 3000, internalPort: 3000},
            },
        },
        settings: {
            client: {
                mongo: {
                    findMany: async (collection, query) => {
                        settingsReads.push({collection, query});
                        return [
                            {
                                key: 'services.config.noona-vault',
                                type: 'service-runtime-config',
                                service: 'noona-vault',
                                env: {VAULT_UI_TITLE: 'Noona Vault'},
                            },
                            {
                                key: 'services.config.noona-moon',
                                type: 'service-runtime-config',
                                service: 'noona-moon',
                                env: {WEBGUI_PORT: '3010'},
                            },
                        ];
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    const starts = [];
    const restarts = [];
    warden.startService = async (service, healthUrl) => {
        starts.push({
            name: service.name,
            port: service.port ?? null,
            healthUrl,
        });
    };
    warden.restartService = async (name) => {
        restarts.push(name);
        return {service: name, restarted: true};
    };

    await warden.bootFull({
        services: ['noona-redis', 'noona-mongo', 'noona-vault', 'noona-sage', 'noona-moon'],
    });

    assert.deepEqual(settingsReads, [
        {
            collection: 'noona_settings',
            query: {type: 'service-runtime-config'},
        },
    ]);
    assert.deepEqual(restarts, ['noona-vault']);
    assert.deepEqual(starts, [
        {name: 'noona-mongo', port: null, healthUrl: 'http://mongo/health'},
        {name: 'noona-redis', port: null, healthUrl: 'http://noona-redis:8001/'},
        {name: 'noona-vault', port: null, healthUrl: 'http://vault/health'},
        {name: 'noona-sage', port: null, healthUrl: 'http://noona-sage:3004/health'},
        {name: 'noona-moon', port: 3010, healthUrl: 'http://noona-moon:3010/'},
    ]);
});

test('bootFull applies setup snapshot runtime values when persisted settings are unavailable', async () => {
    const snapshotPath = path.join('/srv/noona', 'wardenm', 'noona-settings.json');
    const memoryFs = createMemoryFs({
        [snapshotPath]: JSON.stringify({
            version: 2,
            selected: ['noona-portal'],
            storageRoot: '/srv/noona',
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'portal-token',
                    DISCORD_CLIENT_ID: 'portal-client',
                    DISCORD_GUILD_ID: 'portal-guild',
                    KAVITA_API_KEY: 'kavita-api',
                },
            },
        }),
    });
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo', health: 'http://mongo/health'},
            },
            core: {
                'noona-vault': {name: 'noona-vault', health: 'http://vault/health'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', port: 3000, internalPort: 3000},
                'noona-portal': {
                    name: 'noona-portal',
                    port: 3003,
                    internalPort: 3003,
                    env: [
                        'DISCORD_BOT_TOKEN=',
                        'DISCORD_CLIENT_ID=',
                        'DISCORD_GUILD_ID=',
                        'KAVITA_API_KEY=',
                    ],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    findMany: async () => {
                        throw new Error('vault settings unavailable');
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    const starts = [];
    warden.startService = async (service, healthUrl) => {
        starts.push({
            name: service.name,
            env: [...(service.env || [])],
            healthUrl,
        });
    };

    await warden.bootFull({
        services: ['noona-redis', 'noona-mongo', 'noona-vault', 'noona-sage', 'noona-moon', 'noona-portal'],
    });

    const portalStart = starts.find((entry) => entry.name === 'noona-portal');
    assert.ok(portalStart, 'Portal should be started');
    assert.ok(portalStart.env.includes('DISCORD_BOT_TOKEN=portal-token'));
    assert.ok(portalStart.env.includes('DISCORD_CLIENT_ID=portal-client'));
    assert.ok(portalStart.env.includes('DISCORD_GUILD_ID=portal-guild'));
    assert.ok(portalStart.env.includes('KAVITA_API_KEY=kavita-api'));
});

test('bootFull loads legacy NOONA_DATA_ROOT setup snapshots without applying unsupported noona-vault runtime overrides', async () => {
    const snapshotPath = path.join('/srv/noona', 'wardenm', 'noona-settings.json');
    const memoryFs = createMemoryFs({
        [snapshotPath]: JSON.stringify({
            version: 2,
            selected: ['noona-portal'],
            values: {
                'noona-vault': {
                    NOONA_DATA_ROOT: '/srv/noona',
                },
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'portal-token',
                    KAVITA_BASE_URL: 'https://kavita.example',
                    KAVITA_API_KEY: 'kavita-api',
                },
            },
        }),
    });
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        settings: {
            client: {
                mongo: {
                    findMany: async () => {
                        throw new Error('vault settings unavailable');
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    const starts = [];
    warden.startService = async (service) => {
        starts.push(service.name);
    };

    await warden.bootFull({
        services: ['noona-redis', 'noona-mongo', 'noona-vault', 'noona-sage', 'noona-moon', 'noona-portal'],
    });

    assert.ok(starts.includes('noona-portal'));
    assert.equal(warden.getSetupConfig().snapshot.storageRoot, '/srv/noona');
    assert.equal(warden.getServiceConfig('noona-vault').runtimeConfig.env.NOONA_DATA_ROOT, undefined);
    assert.equal(warden.getServiceConfig('noona-raven').runtimeConfig.env.KAVITA_API_KEY, 'kavita-api');
    assert.equal(Object.prototype.hasOwnProperty.call(warden.getServiceConfig('noona-raven').runtimeConfig.env, 'NOONA_DATA_ROOT'), false);
});

test('bootFull prefers setup snapshot runtime values before other persisted config sources', async () => {
    const snapshotPath = path.join('/srv/noona', 'wardenm', 'noona-settings.json');
    const memoryFs = createMemoryFs({
        [snapshotPath]: JSON.stringify({
            version: 2,
            selected: ['noona-portal'],
            storageRoot: '/srv/noona',
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'snapshot-token',
                },
            },
        }),
    });
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo', health: 'http://mongo/health'},
            },
            core: {
                'noona-vault': {name: 'noona-vault', health: 'http://vault/health'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', port: 3000, internalPort: 3000},
                'noona-portal': {
                    name: 'noona-portal',
                    port: 3003,
                    internalPort: 3003,
                    env: [
                        'DISCORD_BOT_TOKEN=',
                        'DISCORD_CLIENT_ID=',
                    ],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    findMany: async () => [
                        {
                            key: 'services.config.noona-portal',
                            type: 'service-runtime-config',
                            service: 'noona-portal',
                            env: {
                                DISCORD_BOT_TOKEN: 'mongo-token',
                                DISCORD_CLIENT_ID: 'mongo-client',
                            },
                        },
                    ],
                },
            },
        },
        hostDockerSockets: [],
    });

    const starts = [];
    warden.startService = async (service) => {
        starts.push({
            name: service.name,
            env: [...(service.env || [])],
        });
    };

    await warden.bootFull({
        services: ['noona-redis', 'noona-mongo', 'noona-vault', 'noona-sage', 'noona-moon', 'noona-portal'],
    });

    const portalStart = starts.find((entry) => entry.name === 'noona-portal');
    assert.ok(portalStart, 'Portal should be started');
    assert.ok(portalStart.env.includes('DISCORD_BOT_TOKEN=snapshot-token'));
    assert.ok(portalStart.env.includes('DISCORD_CLIENT_ID=mongo-client'));
});

test('bootFull applies startup auto-updates after loading persisted noona-warden config', async () => {
    const settingsReads = [];
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo', health: 'http://mongo/health'},
            },
            core: {
                'noona-vault': {name: 'noona-vault', health: 'http://vault/health'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', port: 3000, internalPort: 3000},
            },
        },
        settings: {
            client: {
                mongo: {
                    findMany: async (collection, query) => {
                        settingsReads.push({collection, query});
                        return [
                            {
                                key: 'services.config.noona-warden',
                                type: 'service-runtime-config',
                                service: 'noona-warden',
                                env: {AUTO_UPDATES: 'true'},
                            },
                        ];
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    const starts = [];
    const restarts = [];
    const updateCalls = [];
    warden.startService = async (service, healthUrl) => {
        starts.push({
            name: service.name,
            healthUrl,
        });
    };
    warden.restartService = async (name) => {
        restarts.push(name);
        return {service: name, restarted: true};
    };
    warden.updateServiceImage = async (name, options = {}) => {
        updateCalls.push({
            name,
            restart: options.restart !== false,
        });

        return {
            service: name,
            updated: name === 'noona-redis',
            installed: true,
            restarted: false,
        };
    };

    await warden.bootFull({
        services: ['noona-redis', 'noona-mongo', 'noona-vault', 'noona-sage', 'noona-moon'],
    });

    assert.deepEqual(settingsReads, [
        {
            collection: 'noona_settings',
            query: {type: 'service-runtime-config'},
        },
    ]);
    assert.deepEqual(updateCalls, [
        {name: 'noona-mongo', restart: false},
        {name: 'noona-redis', restart: false},
        {name: 'noona-vault', restart: false},
        {name: 'noona-sage', restart: false},
        {name: 'noona-moon', restart: false},
    ]);
    assert.deepEqual(restarts, ['noona-redis', 'noona-vault']);
    assert.deepEqual(starts, [
        {name: 'noona-mongo', healthUrl: 'http://mongo/health'},
        {name: 'noona-redis', healthUrl: 'http://noona-redis:8001/'},
        {name: 'noona-vault', healthUrl: 'http://vault/health'},
        {name: 'noona-sage', healthUrl: 'http://noona-sage:3004/health'},
        {name: 'noona-moon', healthUrl: null},
    ]);
});

test('bootFull keeps starting services when a startup auto-update fails', async () => {
    const warnings = [];
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo', health: 'http://mongo/health'},
            },
            core: {
                'noona-vault': {name: 'noona-vault', health: 'http://vault/health'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', port: 3000, internalPort: 3000},
            },
        },
        env: {AUTO_UPDATES: 'true'},
        logger: {
            log: () => {
            },
            warn: (message) => warnings.push(String(message)),
        },
        hostDockerSockets: [],
    });

    const starts = [];
    const updateCalls = [];
    warden.startService = async (service, healthUrl) => {
        starts.push({
            name: service.name,
            healthUrl,
        });
    };
    warden.updateServiceImage = async (name, options = {}) => {
        updateCalls.push({
            name,
            restart: options.restart !== false,
        });

        if (name === 'noona-vault') {
            throw new Error('registry unavailable');
        }

        return {
            service: name,
            updated: false,
            installed: true,
            restarted: false,
        };
    };

    await warden.bootFull({
        services: ['noona-redis', 'noona-mongo', 'noona-vault', 'noona-sage', 'noona-moon'],
    });

    assert.deepEqual(updateCalls, [
        {name: 'noona-mongo', restart: false},
        {name: 'noona-redis', restart: false},
        {name: 'noona-vault', restart: false},
        {name: 'noona-sage', restart: false},
        {name: 'noona-moon', restart: false},
    ]);
    assert.deepEqual(starts, [
        {name: 'noona-mongo', healthUrl: 'http://mongo/health'},
        {name: 'noona-redis', healthUrl: 'http://noona-redis:8001/'},
        {name: 'noona-vault', healthUrl: 'http://vault/health'},
        {name: 'noona-sage', healthUrl: 'http://noona-sage:3004/health'},
        {name: 'noona-moon', healthUrl: null},
    ]);
    assert.ok(
        warnings.some((message) => message.includes('Failed to auto-update noona-vault during startup: registry unavailable')),
    );
});

test('bootFull defers managed service restarts until after managed Kavita provisioning', async () => {
    const warden = buildWarden({
        services: {
            addon: {
                'noona-mongo': {name: 'noona-mongo'},
                'noona-redis': {name: 'noona-redis'},
                'noona-kavita': {name: 'noona-kavita', health: 'http://kavita/health'},
                'noona-komf': {name: 'noona-komf'},
            },
            core: {
                'noona-vault': {name: 'noona-vault', health: 'http://vault/health'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', health: 'http://moon/health'},
                'noona-raven': {name: 'noona-raven'},
                'noona-portal': {name: 'noona-portal', health: 'http://portal/health'},
            },
        },
        env: {AUTO_UPDATES: 'true'},
        hostDockerSockets: [],
    });

    const updateCalls = [];
    const starts = [];
    const provisioningCalls = [];
    warden.updateServiceImage = async (name, options = {}) => {
        updateCalls.push({
            name,
            restart: options.restart !== false,
        });

        return {
            service: name,
            updated: name === 'noona-portal',
            installed: name === 'noona-portal',
            restarted: false,
        };
    };
    warden.needsManagedKavitaProvisioning = (name) => name === 'noona-portal' || name === 'noona-komf';
    warden.ensureManagedKavitaAccess = async (options = {}) => {
        provisioningCalls.push([...(options.targetServices || [])]);
        return {
            skipped: false,
            configuredServices: ['noona-portal', 'noona-komf'],
        };
    };
    warden.startService = async (service, healthUrl, options = {}) => {
        starts.push({
            name: service.name,
            healthUrl,
            recreate: options.recreate === true,
        });
    };

    await warden.bootFull({
        services: [
            'noona-mongo',
            'noona-redis',
            'noona-vault',
            'noona-sage',
            'noona-moon',
            'noona-kavita',
            'noona-raven',
            'noona-portal',
            'noona-komf',
        ],
    });

    assert.deepEqual(updateCalls, [
        {name: 'noona-mongo', restart: false},
        {name: 'noona-redis', restart: false},
        {name: 'noona-vault', restart: false},
        {name: 'noona-sage', restart: false},
        {name: 'noona-moon', restart: false},
        {name: 'noona-kavita', restart: false},
        {name: 'noona-raven', restart: false},
        {name: 'noona-komf', restart: false},
        {name: 'noona-portal', restart: false},
    ]);
    assert.deepEqual(provisioningCalls, [['noona-komf', 'noona-portal']]);

    const portalStart = starts.find((entry) => entry.name === 'noona-portal');
    const komfStart = starts.find((entry) => entry.name === 'noona-komf');
    assert.equal(portalStart?.recreate, true);
    assert.equal(komfStart?.recreate, true);
});

test('init ensures network, attaches, and runs minimal boot sequence by default', async () => {
    const events = [];
    const dockerUtils = {
        ensureNetwork: async () => events.push('ensure'),
        attachSelfToNetwork: async () => events.push('attach'),
        containerExists: async () => false,
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

test('init restores the installed managed stack when setup state is unavailable', async () => {
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async (name) => [
            'noona-mongo',
            'noona-redis',
            'noona-vault',
            'noona-sage',
            'noona-moon',
            'noona-portal',
        ].includes(name),
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerUtils,
        services: {
            addon: {
                'noona-mongo': {name: 'noona-mongo'},
                'noona-redis': {name: 'noona-redis'},
            },
            core: {
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon'},
                'noona-vault': {name: 'noona-vault'},
                'noona-portal': {name: 'noona-portal'},
            },
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    const result = await warden.init();

    assert.equal(result.mode, 'full');
    assert.equal(result.setupCompleted, false);
    assert.deepEqual(started, [
        'noona-mongo',
        'noona-redis',
        'noona-vault',
        'noona-sage',
        'noona-moon',
        'noona-portal',
    ]);
});

test('init restores full lifecycle from setup snapshot selection when wizard state is unavailable', async () => {
    const snapshotPath = path.join('/srv/noona', 'wardenm', 'noona-settings.json');
    const memoryFs = createMemoryFs({
        [snapshotPath]: JSON.stringify({
            version: 2,
            selected: ['noona-portal'],
            storageRoot: '/srv/noona',
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'portal-token',
                    DISCORD_CLIENT_ID: 'portal-client',
                    DISCORD_GUILD_ID: 'portal-guild',
                },
            },
        }),
    });
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerUtils,
        services: {
            addon: {
                'noona-mongo': {name: 'noona-mongo'},
                'noona-redis': {name: 'noona-redis'},
            },
            core: {
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon'},
                'noona-vault': {name: 'noona-vault'},
                'noona-portal': {name: 'noona-portal'},
            },
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    const result = await warden.init();

    assert.equal(result.mode, 'full');
    assert.equal(result.setupCompleted, false);
    assert.deepEqual(started, [
        'noona-mongo',
        'noona-redis',
        'noona-vault',
        'noona-sage',
        'noona-moon',
        'noona-portal',
    ]);
});

test('bootFull retries persisted runtime config load before starting managed services', async () => {
    const sleepCalls = [];
    const settingsReads = [];
    const memoryFs = createMemoryFs();
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerUtils,
        settings: {
            client: {
                mongo: {
                    findMany: async () => {
                        settingsReads.push('findMany');
                        if (settingsReads.length === 1) {
                            throw new Error('Vault settings store is warming up');
                        }

                        return [
                            {
                                type: 'service-runtime-config',
                                key: 'services.config.noona-portal',
                                service: 'noona-portal',
                                env: {
                                    DISCORD_BOT_TOKEN: 'portal-token',
                                    DISCORD_CLIENT_ID: 'portal-client',
                                    DISCORD_GUILD_ID: 'portal-guild',
                                },
                            },
                        ];
                    },
                },
            },
        },
        services: {
            addon: {
                'noona-mongo': {name: 'noona-mongo', image: 'mongo'},
                'noona-redis': {name: 'noona-redis', image: 'redis'},
            },
            core: {
                'noona-vault': {name: 'noona-vault', image: 'vault'},
                'noona-sage': {name: 'noona-sage', image: 'sage'},
                'noona-moon': {name: 'noona-moon', image: 'moon', port: 3000, internalPort: 3000},
                'noona-portal': {
                    name: 'noona-portal',
                    image: 'portal',
                    port: 3003,
                    internalPort: 3003,
                    env: [
                        'DISCORD_BOT_TOKEN=',
                        'DISCORD_CLIENT_ID=',
                        'DISCORD_GUILD_ID=',
                    ],
                },
            },
        },
        sleepImpl: async (delayMs) => {
            sleepCalls.push(delayMs);
        },
        hostDockerSockets: [],
    });

    const starts = [];
    warden.startService = async (service) => {
        starts.push({
            name: service.name,
            env: [...(service.env || [])],
        });
    };

    await warden.bootFull({
        services: [
            'noona-mongo',
            'noona-redis',
            'noona-vault',
            'noona-sage',
            'noona-moon',
            'noona-portal',
        ],
    });

    assert.deepEqual(settingsReads, ['findMany', 'findMany']);
    assert.deepEqual(sleepCalls, [1500]);

    const portalStart = starts.find((entry) => entry.name === 'noona-portal');
    assert.ok(portalStart, 'Portal should be started after runtime config loads.');
    assert.ok(portalStart.env.includes('DISCORD_BOT_TOKEN=portal-token'));
    assert.ok(portalStart.env.includes('DISCORD_CLIENT_ID=portal-client'));
    assert.ok(portalStart.env.includes('DISCORD_GUILD_ID=portal-guild'));
});

test('startEcosystem restores the installed managed stack when setupCompleted is false', async () => {
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async (name) => [
            'noona-mongo',
            'noona-redis',
            'noona-vault',
            'noona-sage',
            'noona-moon',
            'noona-raven',
        ].includes(name),
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerUtils,
        services: {
            addon: {
                'noona-mongo': {name: 'noona-mongo'},
                'noona-redis': {name: 'noona-redis'},
            },
            core: {
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon'},
                'noona-vault': {name: 'noona-vault'},
                'noona-raven': {name: 'noona-raven'},
            },
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    const result = await warden.startEcosystem({setupCompleted: false});

    assert.equal(result.mode, 'full');
    assert.equal(result.setupCompleted, false);
    assert.deepEqual(started, [
        'noona-mongo',
        'noona-redis',
        'noona-vault',
        'noona-sage',
        'noona-moon',
        'noona-raven',
    ]);
});

test('startEcosystem uses persisted setup snapshot selection when setupCompleted is false and Docker discovery is unavailable', async () => {
    const snapshotPath = path.join('/srv/noona', 'wardenm', 'noona-settings.json');
    const memoryFs = createMemoryFs({
        [snapshotPath]: JSON.stringify({
            version: 2,
            selected: ['noona-portal'],
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'portal-token',
                    DISCORD_CLIENT_ID: 'portal-client',
                    DISCORD_GUILD_ID: 'portal-guild',
                },
            },
        }),
    });
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerInstance: {
            ping: async () => {
                throw new Error('docker unavailable during cold start');
            },
        },
        services: {
            addon: {
                'noona-mongo': {name: 'noona-mongo'},
                'noona-redis': {name: 'noona-redis'},
            },
            core: {
                'noona-vault': {name: 'noona-vault'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', port: 3000, internalPort: 3000},
                'noona-portal': {name: 'noona-portal'},
            },
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    const result = await warden.startEcosystem({setupCompleted: false});

    assert.equal(result.mode, 'full');
    assert.equal(result.setupCompleted, false);
    assert.deepEqual(started, [
        'noona-mongo',
        'noona-redis',
        'noona-vault',
        'noona-sage',
        'noona-moon',
        'noona-portal',
    ]);
});

test('startEcosystem uses persisted minimal selection when the setup snapshot explicitly selects no services', async () => {
    const snapshotPath = path.join('/srv/noona', 'wardenm', 'noona-settings.json');
    const memoryFs = createMemoryFs({
        [snapshotPath]: JSON.stringify({
            version: 2,
            selected: [],
            selectionMode: 'minimal',
            values: {},
        }),
    });
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerInstance: {
            ping: async () => {
                throw new Error('docker unavailable during cold start');
            },
        },
        services: {
            addon: {
                'noona-mongo': {name: 'noona-mongo'},
                'noona-redis': {name: 'noona-redis'},
            },
            core: {
                'noona-vault': {name: 'noona-vault'},
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon', port: 3000, internalPort: 3000},
                'noona-portal': {name: 'noona-portal'},
            },
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    const result = await warden.startEcosystem({setupCompleted: false});

    assert.equal(result.mode, 'minimal');
    assert.equal(result.setupCompleted, false);
    assert.deepEqual(started, ['noona-sage', 'noona-moon']);
});

test('bootMinimal checks startup image updates when AUTO_UPDATES is enabled', async () => {
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-moon': {name: 'noona-moon', port: 3000, internalPort: 3000},
                'noona-sage': {name: 'noona-sage'},
            },
        },
        env: {AUTO_UPDATES: 'true'},
        hostDockerSockets: [],
    });

    const starts = [];
    const updateCalls = [];
    warden.startService = async (service, healthUrl) => {
        starts.push({
            name: service.name,
            healthUrl,
        });
    };
    warden.updateServiceImage = async (name, options = {}) => {
        updateCalls.push({
            name,
            restart: options.restart !== false,
        });

        return {
            service: name,
            updated: false,
            installed: false,
            restarted: false,
        };
    };

    await warden.bootMinimal();

    assert.deepEqual(updateCalls, [
        {name: 'noona-sage', restart: true},
        {name: 'noona-moon', restart: true},
    ]);
    assert.deepEqual(starts, [
        {name: 'noona-sage', healthUrl: 'http://noona-sage:3004/health'},
        {name: 'noona-moon', healthUrl: 'http://noona-moon:3000/'},
    ]);
});

test('bootMinimal continues startup when a startup auto-update fails', async () => {
    const warnings = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-moon': {name: 'noona-moon', port: 3000, internalPort: 3000},
                'noona-sage': {name: 'noona-sage'},
            },
        },
        env: {AUTO_UPDATES: 'true'},
        logger: {
            log: () => {
            },
            warn: (message) => warnings.push(String(message)),
        },
        hostDockerSockets: [],
    });

    const starts = [];
    const updateCalls = [];
    warden.startService = async (service, healthUrl) => {
        starts.push({
            name: service.name,
            healthUrl,
        });
    };
    warden.updateServiceImage = async (name, options = {}) => {
        updateCalls.push({
            name,
            restart: options.restart !== false,
        });

        if (name === 'noona-sage') {
            throw new Error('pull timeout');
        }

        return {
            service: name,
            updated: false,
            installed: true,
            restarted: false,
        };
    };

    await warden.bootMinimal();

    assert.deepEqual(updateCalls, [
        {name: 'noona-sage', restart: true},
        {name: 'noona-moon', restart: true},
    ]);
    assert.deepEqual(starts, [
        {name: 'noona-sage', healthUrl: 'http://noona-sage:3004/health'},
        {name: 'noona-moon', healthUrl: 'http://noona-moon:3000/'},
    ]);
    assert.ok(
        warnings.some((message) => message.includes('Failed to auto-update noona-sage during startup: pull timeout')),
    );
});


test('Moon WEBGUI_PORT override updates service config and minimal boot health target', async () => {
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    envConfig: [{key: 'WEBGUI_PORT'}, {key: 'MOON_EXTERNAL_URL'}],
                },
                'noona-sage': {name: 'noona-sage', image: 'sage'},
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        env: {HOST_SERVICE_URL: 'http://localhost'},
        hostDockerSockets: [],
    });

    await warden.updateServiceConfig('noona-moon', {
        env: {WEBGUI_PORT: '3010'},
    });

    const moonConfig = warden.getServiceConfig('noona-moon');
    assert.equal(moonConfig.port, 3010);
    assert.equal(moonConfig.internalPort, 3010);
    assert.equal(moonConfig.hostServiceUrl, 'http://localhost:3010');
    assert.equal(moonConfig.health, 'http://noona-moon:3010/');
    assert.equal(moonConfig.env.WEBGUI_PORT, '3010');
    assert.deepEqual(moonConfig.runtimeConfig.env, {WEBGUI_PORT: '3010'});

    const starts = [];
    warden.startService = async (service, healthUrl) => {
        starts.push({
            name: service.name,
            port: service.port ?? null,
            internalPort: service.internalPort ?? null,
            healthUrl,
        });
    };

    await warden.bootMinimal();

    assert.deepEqual(starts, [
        {
            name: 'noona-sage',
            port: null,
            internalPort: null,
            healthUrl: 'http://noona-sage:3004/health',
        },
        {
            name: 'noona-moon',
            port: 3010,
            internalPort: 3010,
            healthUrl: 'http://noona-moon:3010/',
        },
    ]);
});

test('Moon MOON_EXTERNAL_URL override publishes external hostServiceUrl metadata', async () => {
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    envConfig: [{key: 'WEBGUI_PORT'}, {key: 'MOON_EXTERNAL_URL'}],
                },
                'noona-sage': {name: 'noona-sage', image: 'sage'},
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        env: {HOST_SERVICE_URL: 'http://localhost'},
        hostDockerSockets: [],
    });

    await warden.updateServiceConfig('noona-moon', {
        env: {MOON_EXTERNAL_URL: 'https://moon.example.com'},
    });

    const moonConfig = warden.getServiceConfig('noona-moon');
    assert.equal(moonConfig.hostServiceUrl, 'https://moon.example.com/');
    assert.equal(moonConfig.env.MOON_EXTERNAL_URL, 'https://moon.example.com');
    assert.deepEqual(moonConfig.runtimeConfig.env, {MOON_EXTERNAL_URL: 'https://moon.example.com'});

    const services = await warden.listServices({includeInstalled: true});
    const moonService = services.find((entry) => entry.name === 'noona-moon');
    assert.equal(moonService?.hostServiceUrl, 'https://moon.example.com/');
});

test('Moon SAGE_BASE_URL override persists runtime config and returns it in service config', async () => {
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    envConfig: [{key: 'WEBGUI_PORT'}, {key: 'MOON_EXTERNAL_URL'}, {key: 'SAGE_BASE_URL'}],
                },
                'noona-sage': {name: 'noona-sage', image: 'sage'},
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        env: {HOST_SERVICE_URL: 'http://localhost'},
        hostDockerSockets: [],
    });

    await warden.updateServiceConfig('noona-moon', {
        env: {SAGE_BASE_URL: 'https://sage.example.com'},
    });

    const moonConfig = warden.getServiceConfig('noona-moon');
    assert.equal(moonConfig.env.SAGE_BASE_URL, 'https://sage.example.com');
    assert.deepEqual(moonConfig.runtimeConfig.env, {SAGE_BASE_URL: 'https://sage.example.com'});
});

test('managed noona-kavita inherits the current Moon URL for Noona login defaults', async () => {
    const warden = buildWarden({
        services: {
            addon: {
                'noona-kavita': {
                    name: 'noona-kavita',
                    image: 'kavita',
                    port: 5000,
                    internalPort: 5000,
                    env: [
                        'SERVICE_NAME=noona-kavita',
                        'NOONA_MOON_BASE_URL=',
                        'NOONA_PORTAL_BASE_URL=',
                        'NOONA_SOCIAL_LOGIN_ONLY=',
                    ],
                },
            },
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    envConfig: [{key: 'WEBGUI_PORT'}, {key: 'MOON_EXTERNAL_URL'}],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        env: {HOST_SERVICE_URL: 'http://localhost'},
        hostDockerSockets: [],
    });

    await warden.updateServiceConfig('noona-moon', {
        env: {WEBGUI_PORT: '3010'},
    });

    const kavitaConfig = warden.getServiceConfig('noona-kavita');
    assert.equal(kavitaConfig.env.NOONA_MOON_BASE_URL, 'http://localhost:3010');
    assert.equal(kavitaConfig.env.NOONA_PORTAL_BASE_URL, 'http://noona-portal:3003');
    assert.equal(kavitaConfig.env.NOONA_SOCIAL_LOGIN_ONLY, 'true');
});

test('updating Moon external URL restarts managed noona-kavita so Kavita login redirect stays in sync', async () => {
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async (name) => name === 'noona-kavita',
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerUtils,
        services: {
            addon: {
                'noona-kavita': {
                    name: 'noona-kavita',
                    image: 'kavita',
                    port: 5000,
                    internalPort: 5000,
                    env: [
                        'SERVICE_NAME=noona-kavita',
                        'NOONA_MOON_BASE_URL=',
                        'NOONA_PORTAL_BASE_URL=',
                        'NOONA_SOCIAL_LOGIN_ONLY=',
                    ],
                },
            },
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    envConfig: [{key: 'WEBGUI_PORT'}, {key: 'MOON_EXTERNAL_URL'}],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        env: {HOST_SERVICE_URL: 'http://localhost'},
        hostDockerSockets: [],
    });

    const restarts = [];
    warden.startService = async (service, _healthUrl, options = {}) => {
        restarts.push({
            name: service.name,
            recreate: options.recreate === true,
            noonaMoonBaseUrl: service.env?.find((entry) => entry.startsWith('NOONA_MOON_BASE_URL=')) ?? null,
        });
    };

    const result = await warden.updateServiceConfig('noona-moon', {
        env: {MOON_EXTERNAL_URL: 'https://moon.example.com'},
        restart: true,
    });

    assert.deepEqual(
        restarts.map((entry) => ({name: entry.name, recreate: entry.recreate})),
        [
            {name: 'noona-moon', recreate: true},
            {name: 'noona-kavita', recreate: true},
        ],
    );
    assert.equal(
        restarts[1]?.noonaMoonBaseUrl,
        'NOONA_MOON_BASE_URL=https://moon.example.com',
    );
    assert.deepEqual(result.linkedRestarts, ['noona-kavita']);
    assert.equal(result.service.env.MOON_EXTERNAL_URL, 'https://moon.example.com');
});

test('blank managed noona-kavita Noona overrides are treated as unset', async () => {
    const warden = buildWarden({
        services: {
            addon: {
                'noona-kavita': {
                    name: 'noona-kavita',
                    image: 'kavita',
                    port: 5000,
                    internalPort: 5000,
                    env: ['SERVICE_NAME=noona-kavita'],
                },
            },
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    envConfig: [{key: 'WEBGUI_PORT'}, {key: 'MOON_EXTERNAL_URL'}],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        env: {HOST_SERVICE_URL: 'http://localhost'},
        hostDockerSockets: [],
    });

    await warden.updateServiceConfig('noona-moon', {
        env: {MOON_EXTERNAL_URL: 'https://moon.example.com'},
    });

    await warden.updateServiceConfig('noona-kavita', {
        env: {
            NOONA_MOON_BASE_URL: '',
            NOONA_PORTAL_BASE_URL: '',
            NOONA_SOCIAL_LOGIN_ONLY: '',
        },
    });

    const kavitaConfig = warden.getServiceConfig('noona-kavita');
    assert.equal(kavitaConfig.env.NOONA_MOON_BASE_URL, 'https://moon.example.com');
    assert.equal(kavitaConfig.env.NOONA_PORTAL_BASE_URL, 'http://noona-portal:3003');
    assert.equal(kavitaConfig.env.NOONA_SOCIAL_LOGIN_ONLY, 'true');
    assert.deepEqual(kavitaConfig.runtimeConfig.env, {});
});

test('updateServiceConfig persists service runtime overrides to noona_settings', async () => {
    const writes = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    envConfig: [{key: 'WEBGUI_PORT'}],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async (...args) => {
                        writes.push(args);
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    await warden.updateServiceConfig('noona-moon', {
        env: {WEBGUI_PORT: '3010'},
        hostPort: 3010,
    });

    assert.equal(writes.length, 1);
    const [collection, query, update, options] = writes[0];
    assert.equal(collection, 'noona_settings');
    assert.deepEqual(query, {key: 'services.config.noona-moon'});
    assert.deepEqual(options, {upsert: true});
    assert.equal(update.$set.type, 'service-runtime-config');
    assert.equal(update.$set.service, 'noona-moon');
    assert.deepEqual(update.$set.env, {WEBGUI_PORT: '3010'});
    assert.equal(update.$set.hostPort, 3010);
    assert.match(update.$set.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('updateServiceConfig falls back to the local runtime snapshot when Vault settings are still warming up', async () => {
    const memoryFs = createMemoryFs();
    const warmupError = new Error(
        "All Vault endpoints failed: https://noona-vault:3005 (Unable to read Vault CA certificate at /srv/noona/vault/tls/ca-cert.pem: ENOENT: no such file or directory, open '/srv/noona/vault/tls/ca-cert.pem')",
    );
    warmupError.code = 'ENOENT';
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    envConfig: [{key: 'WEBGUI_PORT'}],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                        throw warmupError;
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    const result = await warden.updateServiceConfig('noona-moon', {
        env: {WEBGUI_PORT: '3010'},
        hostPort: 3010,
    });

    assert.equal(result.saved, true);
    assert.equal(result.restarted, false);
    assert.equal(result.service.runtimeConfig.env.WEBGUI_PORT, '3010');
    assert.equal(result.service.runtimeConfig.hostPort, 3010);

    const runtimeSnapshotPath = path.join('/srv/noona', 'warden', 'service-runtime-config.json');
    assert.equal(memoryFs.files.has(path.normalize(runtimeSnapshotPath)), true);
    const runtimeSnapshot = JSON.parse(memoryFs.files.get(path.normalize(runtimeSnapshotPath)));
    assert.equal(runtimeSnapshot.services['noona-moon'].env.WEBGUI_PORT, '3010');
    assert.equal(runtimeSnapshot.services['noona-moon'].hostPort, 3010);
});

test('updateServiceConfig preserves masked sensitive values and rejects managed credential changes', async () => {
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-portal': {
                    name: 'noona-portal',
                    image: 'portal',
                    port: 3003,
                    internalPort: 3003,
                    env: [
                        'SERVICE_NAME=noona-portal',
                        'VAULT_API_TOKEN=vault-token',
                        'DISCORD_BOT_TOKEN=portal-token',
                    ],
                    envConfig: [
                        {key: 'SERVICE_NAME', defaultValue: 'noona-portal', readOnly: true, serverManaged: true},
                        {
                            key: 'VAULT_API_TOKEN',
                            defaultValue: 'vault-token',
                            readOnly: true,
                            sensitive: true,
                            serverManaged: true
                        },
                        {key: 'DISCORD_BOT_TOKEN', defaultValue: 'portal-token', sensitive: true},
                    ],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    const preserved = await warden.updateServiceConfig('noona-portal', {
        env: {
            DISCORD_BOT_TOKEN: '********',
        },
    });

    assert.deepEqual(preserved.service.runtimeConfig.env, {
        DISCORD_BOT_TOKEN: 'portal-token',
    });

    await assert.rejects(
        async () => {
            await warden.updateServiceConfig('noona-portal', {
                env: {
                    VAULT_API_TOKEN: 'rotated-token',
                    DISCORD_BOT_TOKEN: 'portal-token',
                },
            });
        },
        /VAULT_API_TOKEN is managed by Warden and cannot be changed/,
    );
});

test('updateServiceConfig with restart returns partial success when restart fails after save', async () => {
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    env: ['WEBGUI_PORT=3000'],
                    envConfig: [{key: 'WEBGUI_PORT'}],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    warden.restartService = async () => {
        throw new Error('docker restart failed');
    };

    const result = await warden.updateServiceConfig('noona-moon', {
        env: {WEBGUI_PORT: '3010'},
        restart: true,
    });

    assert.equal(result.saved, true);
    assert.equal(result.restarted, false);
    assert.equal(result.pendingRestart, true);
    assert.match(result.warnings[0], /Saved noona-moon, but restart failed: docker restart failed/);
    assert.equal(result.service.runtimeConfig.env.WEBGUI_PORT, '3010');
    assert.equal(result.service.env.WEBGUI_PORT, '3010');
});

test('installServices rejects managed environment overrides', async () => {
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-portal': {
                    name: 'noona-portal',
                    image: 'portal',
                    port: 3003,
                    internalPort: 3003,
                    env: [
                        'SERVICE_NAME=noona-portal',
                        'VAULT_API_TOKEN=vault-token',
                    ],
                    envConfig: [
                        {key: 'SERVICE_NAME', defaultValue: 'noona-portal', readOnly: true, serverManaged: true},
                        {
                            key: 'VAULT_API_TOKEN',
                            defaultValue: 'vault-token',
                            readOnly: true,
                            sensitive: true,
                            serverManaged: true
                        },
                    ],
                },
            },
        },
        hostDockerSockets: [],
    });

    const results = await warden.installServices([
        {
            name: 'noona-portal',
            env: {
                VAULT_API_TOKEN: 'rotated-token',
            },
        },
    ]);

    const portalResult = results.find((entry) => entry?.name === 'noona-portal');
    assert.deepEqual(portalResult, {
        name: 'noona-portal',
        status: 'error',
        error: 'VAULT_API_TOKEN is managed by Warden and cannot be changed.',
    });
});

test('saveSetupConfig writes setup snapshot to disk and applies runtime env overrides', async () => {
    const memoryFs = createMemoryFs();
    const stopCalls = [];
    const startCalls = [];
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-portal': {
                    name: 'noona-portal',
                    port: 3003,
                    internalPort: 3003,
                    env: [
                        'DISCORD_BOT_TOKEN=',
                        'KAVITA_API_KEY=',
                    ],
                    envConfig: [
                        {key: 'DISCORD_BOT_TOKEN', sensitive: true},
                        {key: 'KAVITA_API_KEY', sensitive: true},
                    ],
                },
                'noona-raven': {
                    name: 'noona-raven',
                    envConfig: [],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        hostDockerSockets: [],
    });
    warden.stopEcosystem = async (options = {}) => {
        stopCalls.push(options);
        return [{service: 'noona-portal', stopped: true, removed: false}];
    };
    warden.startEcosystem = async (options = {}) => {
        startCalls.push(options);
        return {mode: 'full', setupCompleted: true};
    };

    const payload = {
        version: 2,
        selected: ['noona-portal'],
        storageRoot: '/srv/noona',
        values: {
            'noona-portal': {
                DISCORD_BOT_TOKEN: 'portal-token',
                KAVITA_API_KEY: 'kavita-api',
            },
        },
    };

    const result = await warden.saveSetupConfig(payload);
    const expectedPath = path.join('/srv/noona', 'wardenm', 'noona-settings.json');
    const legacyRootPath = path.join('/srv/noona', 'noona-settings.json');
    const legacyPath = path.join('/srv/noona', 'warden', 'setup-wizard-state.json');

    assert.equal(result.exists, true);
    assert.equal(result.path, expectedPath);
    assert.deepEqual(result.selected, ['noona-portal', 'noona-raven']);
    assert.equal(result.saved, true);
    assert.equal(result.restarted, true);
    assert.equal(result.rolledBack, false);
    assert.equal(result.snapshot.version, 3);
    assert.equal(result.snapshot.storageRoot, path.normalize('/srv/noona'));
    assert.equal(result.snapshot.discord.botToken, 'portal-token');
    assert.equal(result.snapshot.kavita.apiKey, 'kavita-api');
    assert.equal(typeof result.snapshot.savedAt, 'string');
    assert.ok(memoryFs.files.has(path.normalize(expectedPath)));
    assert.equal(memoryFs.files.has(path.normalize(legacyRootPath)), false);
    assert.equal(memoryFs.files.has(path.normalize(legacyPath)), false);
    assert.deepEqual(result.mirroredPaths, []);
    assert.deepEqual(stopCalls, [{trackedOnly: false, remove: false}]);
    assert.deepEqual(startCalls, [{
        forceFull: true,
        setupCompleted: true,
        services: ['noona-moon', 'noona-sage', 'noona-portal', 'noona-raven'],
    }]);

    const loadedSnapshot = warden.getSetupConfig();
    assert.equal(loadedSnapshot.exists, true);
    assert.equal(loadedSnapshot.path, expectedPath);
    assert.equal(loadedSnapshot.snapshot.discord.botToken, 'portal-token');
    assert.equal(loadedSnapshot.snapshot.values['noona-portal'].DISCORD_BOT_TOKEN, 'portal-token');

    const portalConfig = warden.getServiceConfig('noona-portal');
    assert.equal(portalConfig.runtimeConfig.env.DISCORD_BOT_TOKEN, 'portal-token');
    assert.equal(portalConfig.runtimeConfig.env.KAVITA_API_KEY, 'kavita-api');

    const runtimeSnapshotPath = path.join('/srv/noona', 'warden', 'service-runtime-config.json');
    assert.ok(memoryFs.files.has(path.normalize(runtimeSnapshotPath)));

    const runtimeSnapshot = JSON.parse(memoryFs.files.get(path.normalize(runtimeSnapshotPath)));
    assert.equal(runtimeSnapshot.services['noona-portal'].env.DISCORD_BOT_TOKEN, 'portal-token');
    assert.equal(runtimeSnapshot.services['noona-portal'].env.KAVITA_API_KEY, 'kavita-api');
});

test('saveSetupConfig rejects snapshot storage roots outside the canonical Noona root', async () => {
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    envConfig: [{key: 'WEBGUI_PORT'}],
                },
                'noona-sage': {
                    name: 'noona-sage',
                    envConfig: [],
                },
                'noona-portal': {
                    name: 'noona-portal',
                    envConfig: [{key: 'DISCORD_BOT_TOKEN'}],
                },
                'noona-raven': {
                    name: 'noona-raven',
                    envConfig: [],
                },
            },
        },
        hostDockerSockets: [],
    });

    await assert.rejects(
        async () => {
            await warden.saveSetupConfig({
                selected: ['noona-portal'],
                storageRoot: '/tmp/outside',
                values: {
                    'noona-portal': {
                        DISCORD_BOT_TOKEN: 'portal-token',
                    },
                },
            });
        },
        /storageRoot must stay within Warden's managed Noona data root/,
    );
});

test('saveSetupConfig ignores legacy platform selections and keeps the derived setup profile stable', async () => {
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-portal': {
                    name: 'noona-portal',
                    envConfig: [{key: 'DISCORD_BOT_TOKEN'}],
                },
                'noona-raven': {
                    name: 'noona-raven',
                    envConfig: [],
                },
            },
        },
        hostDockerSockets: [],
    });

    const result = await warden.saveSetupConfig({
        version: 2,
        selected: ['noona-moon', 'noona-sage', 'noona-portal'],
        values: {
            'noona-portal': {
                DISCORD_BOT_TOKEN: 'portal-token',
            },
        },
    }, {apply: false});

    assert.deepEqual(result.selected, ['noona-portal', 'noona-raven']);
    assert.equal(result.snapshot.discord.botToken, 'portal-token');
    assert.equal(result.snapshot.kavita.mode, 'external');
});

test('saveSetupConfig imports legacy NOONA_DATA_ROOT into storageRoot without persisting noona-vault runtime overrides', async () => {
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        hostDockerSockets: [],
    });

    const result = await warden.saveSetupConfig({
        version: 2,
        selected: ['noona-moon', 'noona-sage', 'noona-portal', 'noona-kavita'],
        values: {
            'noona-vault': {
                NOONA_DATA_ROOT: '/srv/noona',
            },
            'noona-portal': {
                DISCORD_BOT_TOKEN: 'portal-token',
                KAVITA_BASE_URL: 'http://noona-kavita:5000',
                KAVITA_API_KEY: 'kavita-api',
            },
            'noona-kavita': {
                KAVITA_ADMIN_USERNAME: 'admin',
                KAVITA_ADMIN_EMAIL: 'admin@example.com',
                KAVITA_ADMIN_PASSWORD: 'admin-pass',
            },
        },
    }, {apply: false});

    const persistedSnapshot = warden.getSetupConfig({refresh: true}).snapshot;

    assert.equal(persistedSnapshot.storageRoot, path.normalize('/srv/noona'));
    assert.deepEqual(result.selected, ['noona-kavita', 'noona-portal', 'noona-raven']);
    assert.equal(persistedSnapshot.values['noona-vault'], undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(persistedSnapshot.values['noona-raven'] ?? {}, 'NOONA_DATA_ROOT'), false);
});

test('saveSetupConfig rejects read-only and server-managed env keys', async () => {
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-portal': {
                    name: 'noona-portal',
                    env: ['VAULT_API_TOKEN=vault-token'],
                    envConfig: [
                        {key: 'VAULT_API_TOKEN', readOnly: true, serverManaged: true, sensitive: true},
                    ],
                },
            },
        },
        hostDockerSockets: [],
    });

    await assert.rejects(
        async () => {
            await warden.saveSetupConfig({
                selected: ['noona-portal'],
                values: {
                    'noona-portal': {
                        VAULT_API_TOKEN: 'rotated-token',
                    },
                },
            });
        },
        /VAULT_API_TOKEN is managed by Warden and cannot be changed/,
    );
});

test('saveSetupConfig rejects invalid SERVER_IP values', async () => {
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {addon: {}, core: {}},
        hostDockerSockets: [],
    });

    await assert.rejects(
        async () => {
            await warden.saveSetupConfig({
                selected: [],
                values: {
                    'noona-warden': {
                        SERVER_IP: 'http://192.168.1.25/not-allowed',
                    },
                },
            });
        },
        /SERVER_IP must be a valid hostname, IP address, or http\(s\) URL without a path/,
    );
});

test('saveSetupConfig rejects effective ecosystem host port collisions', async () => {
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    env: ['WEBGUI_PORT=3000'],
                    envConfig: [{key: 'WEBGUI_PORT'}],
                },
                'noona-portal': {
                    name: 'noona-portal',
                    image: 'portal',
                    port: 3003,
                    internalPort: 3003,
                    envConfig: [{key: 'DISCORD_BOT_TOKEN'}],
                },
            },
        },
        hostDockerSockets: [],
    });

    await assert.rejects(
        async () => {
            await warden.saveSetupConfig({
                selected: ['noona-portal'],
                values: {
                    'noona-moon': {
                        WEBGUI_PORT: '3003',
                    },
                },
            });
        },
        /Host port collision detected: noona-moon and noona-portal both use port 3003/,
    );
});

test('saveSetupConfig restarts using the imported service selection', async () => {
    const startCalls = [];
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-sage': {name: 'noona-sage', port: 3004, internalPort: 3004},
                'noona-moon': {
                    name: 'noona-moon',
                    port: 3000,
                    internalPort: 3000,
                    env: ['WEBGUI_PORT=3000'],
                    envConfig: [{key: 'WEBGUI_PORT'}],
                },
                'noona-portal': {
                    name: 'noona-portal',
                    port: 3003,
                    internalPort: 3003,
                    envConfig: [{key: 'DISCORD_BOT_TOKEN'}]
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        hostDockerSockets: [],
    });
    warden.stopEcosystem = async () => [];
    warden.startEcosystem = async (options = {}) => {
        startCalls.push(options);
        return {mode: 'full', setupCompleted: true};
    };

    await warden.saveSetupConfig({
        selected: ['noona-portal'],
        values: {
            'noona-portal': {
                DISCORD_BOT_TOKEN: 'portal-token',
            },
        },
    });

    assert.deepEqual(startCalls, [{
        forceFull: true,
        setupCompleted: true,
        services: ['noona-moon', 'noona-sage', 'noona-portal', 'noona-raven'],
    }]);
});

test('saveSetupConfig supports persist-only snapshots without restarting the ecosystem', async () => {
    const startCalls = [];
    const stopCalls = [];
    const warden = buildWarden({
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-sage': {name: 'noona-sage', port: 3004, internalPort: 3004},
                'noona-moon': {name: 'noona-moon', port: 3000, internalPort: 3000, envConfig: [{key: 'WEBGUI_PORT'}]},
                'noona-portal': {
                    name: 'noona-portal',
                    port: 3003,
                    internalPort: 3003,
                    envConfig: [{key: 'DISCORD_BOT_TOKEN'}]
                },
                'noona-raven': {
                    name: 'noona-raven',
                    port: 3006,
                    internalPort: 3006,
                    envConfig: [],
                },
            },
        },
        hostDockerSockets: [],
    });
    warden.stopEcosystem = async (options = {}) => {
        stopCalls.push(options);
        return [];
    };
    warden.startEcosystem = async (options = {}) => {
        startCalls.push(options);
        return {mode: 'full', setupCompleted: true};
    };

    const result = await warden.saveSetupConfig({
        version: 3,
        storageRoot: '/srv/noona',
        kavita: {
            mode: 'external',
            baseUrl: 'https://kavita.example',
            apiKey: 'kavita-api',
            sharedLibraryPath: '/mnt/manga',
            account: {
                username: '',
                email: '',
                password: '',
            },
        },
        komf: {
            mode: 'external',
            baseUrl: '',
            applicationYml: '',
        },
        discord: {
            botToken: 'portal-token',
            clientId: 'client-id',
            clientSecret: 'client-secret',
            guildId: 'guild-id',
        },
    }, {apply: false});

    assert.equal(result.selectionMode, 'selected');
    assert.equal(result.restarted, false);
    assert.equal(result.persistOnly, true);
    assert.deepEqual(result.selected, ['noona-portal', 'noona-raven']);
    assert.deepEqual(stopCalls, []);
    assert.deepEqual(startCalls, []);
});

test('saveSetupConfig applies public v3 snapshots with the real service descriptors without persisting storageRoot as a runtime override', async () => {
    const memoryFs = createMemoryFs();
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        hostDockerSockets: [],
    });
    warden.stopEcosystem = async () => [];
    warden.startEcosystem = async () => ({mode: 'full', setupCompleted: true});

    const result = await warden.saveSetupConfig({
        version: 3,
        storageRoot: '/srv/noona',
        kavita: {
            mode: 'external',
            baseUrl: 'https://kavita.example',
            apiKey: 'kavita-api',
            sharedLibraryPath: '/mnt/manga',
            account: {
                username: '',
                email: '',
                password: '',
            },
        },
        komf: {
            mode: 'managed',
            baseUrl: '',
            applicationYml: 'server:\n  port: 8085\n',
        },
        discord: {
            botToken: 'portal-token',
            clientId: 'client-id',
            clientSecret: 'client-secret',
            guildId: 'guild-id',
        },
    });

    const persistedSnapshot = warden.getSetupConfig({refresh: true}).snapshot;
    assert.equal(persistedSnapshot.values['noona-vault'], undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(persistedSnapshot.values['noona-raven'] ?? {}, 'NOONA_DATA_ROOT'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(persistedSnapshot.values['noona-komf'] ?? {}, 'NOONA_DATA_ROOT'), false);

    const runtimeSnapshotPath = path.join('/srv/noona', 'warden', 'service-runtime-config.json');
    const runtimeSnapshot = JSON.parse(memoryFs.files.get(path.normalize(runtimeSnapshotPath)));
    const runtimeServices = runtimeSnapshot?.services ?? {};
    assert.equal(runtimeServices['noona-vault'], undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(runtimeServices['noona-raven']?.env ?? {}, 'NOONA_DATA_ROOT'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(runtimeServices['noona-komf']?.env ?? {}, 'NOONA_DATA_ROOT'), false);
});

test('saveSetupConfig rolls back persisted snapshot and runtime state when restart fails', async () => {
    const memoryFs = createMemoryFs();
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-portal': {
                    name: 'noona-portal',
                    port: 3003,
                    internalPort: 3003,
                    envConfig: [{key: 'DISCORD_BOT_TOKEN'}],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    await warden.saveSetupConfig({
        selected: ['noona-portal'],
        values: {
            'noona-portal': {
                DISCORD_BOT_TOKEN: 'old-token',
            },
        },
    }, {apply: false});

    warden.stopEcosystem = async () => [];
    warden.startEcosystem = async () => {
        throw new Error('restart failed');
    };

    await assert.rejects(
        async () => {
            await warden.saveSetupConfig({
                selected: ['noona-portal'],
                values: {
                    'noona-portal': {
                        DISCORD_BOT_TOKEN: 'new-token',
                    },
                },
            });
        },
        /Failed to apply setup config snapshot/,
    );

    assert.equal(
        warden.getSetupConfig().snapshot.discord.botToken,
        'old-token',
    );
    assert.equal(
        warden.getServiceConfig('noona-portal').runtimeConfig.env.DISCORD_BOT_TOKEN,
        'old-token',
    );
});

test('getSetupConfig migrates the legacy root setup snapshot path into the WardenM file', () => {
    const canonicalPath = path.join('/srv/noona', 'wardenm', 'noona-settings.json');
    const legacyRootPath = path.join('/srv/noona', 'noona-settings.json');
    const memoryFs = createMemoryFs({
        [legacyRootPath]: JSON.stringify({
            version: 2,
            selected: ['noona-portal'],
            storageRoot: '/srv/noona',
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'portal-token',
                },
            },
        }),
    });
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-portal': {name: 'noona-portal'},
            },
        },
        hostDockerSockets: [],
    });

    const loadedSnapshot = warden.getSetupConfig();

    assert.equal(loadedSnapshot.exists, true);
    assert.equal(loadedSnapshot.path, canonicalPath);
    assert.equal(loadedSnapshot.snapshot.discord.botToken, 'portal-token');
    assert.equal(memoryFs.files.has(canonicalPath), true);
    assert.equal(memoryFs.files.has(legacyRootPath), false);
});

test('getSetupConfig migrates the legacy Warden snapshot path into the WardenM file', () => {
    const canonicalPath = path.join('/srv/noona', 'wardenm', 'noona-settings.json');
    const legacyPath = path.join('/srv/noona', 'warden', 'setup-wizard-state.json');
    const memoryFs = createMemoryFs({
        [legacyPath]: JSON.stringify({
            version: 2,
            selected: ['noona-portal'],
            storageRoot: '/srv/noona',
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'portal-token',
                },
            },
        }),
    });
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-portal': {name: 'noona-portal'},
            },
        },
        hostDockerSockets: [],
    });

    const loadedSnapshot = warden.getSetupConfig();

    assert.equal(loadedSnapshot.exists, true);
    assert.equal(loadedSnapshot.path, canonicalPath);
    assert.equal(loadedSnapshot.snapshot.discord.botToken, 'portal-token');
    assert.equal(memoryFs.files.has(canonicalPath), true);
    assert.equal(memoryFs.files.has(legacyPath), false);
});

test('getSetupConfig keeps the canonical WardenM snapshot and removes legacy duplicates when both exist', () => {
    const canonicalPath = path.join('/srv/noona', 'wardenm', 'noona-settings.json');
    const legacyRootPath = path.join('/srv/noona', 'noona-settings.json');
    const legacyPath = path.join('/srv/noona', 'warden', 'setup-wizard-state.json');
    const memoryFs = createMemoryFs({
        [canonicalPath]: JSON.stringify({
            version: 3,
            storageRoot: '/srv/noona',
            discord: {
                botToken: 'canonical-token',
            },
        }),
        [legacyRootPath]: JSON.stringify({
            version: 2,
            selected: ['noona-portal'],
            storageRoot: '/srv/noona',
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'legacy-root-token',
                },
            },
        }),
        [legacyPath]: JSON.stringify({
            version: 2,
            selected: ['noona-portal'],
            storageRoot: '/srv/noona',
            values: {
                'noona-portal': {
                    DISCORD_BOT_TOKEN: 'legacy-warden-token',
                },
            },
        }),
    });
    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-portal': {name: 'noona-portal'},
            },
        },
        hostDockerSockets: [],
    });

    const loadedSnapshot = warden.getSetupConfig();

    assert.equal(loadedSnapshot.exists, true);
    assert.equal(loadedSnapshot.path, canonicalPath);
    assert.equal(loadedSnapshot.snapshot.discord.botToken, 'canonical-token');
    assert.equal(memoryFs.files.has(canonicalPath), true);
    assert.equal(memoryFs.files.has(legacyRootPath), false);
    assert.equal(memoryFs.files.has(legacyPath), false);
});

test('updateServiceConfig on noona-warden persists SERVER_IP and AUTO_UPDATES and rewrites host-facing URLs', async () => {
    const writes = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-kavita': {name: 'noona-kavita', image: 'kavita', port: 5000},
                'noona-moon': {name: 'noona-moon', image: 'moon', port: 3000, internalPort: 3000},
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async (...args) => {
                        writes.push(args);
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    assert.equal(warden.getServiceConfig('noona-kavita').hostServiceUrl, 'http://localhost:5000');

    const result = await warden.updateServiceConfig('noona-warden', {
        env: {SERVER_IP: '192.168.1.25', AUTO_UPDATES: 'true'},
    });

    assert.equal(result.restarted, false);
    assert.equal(result.service.name, 'noona-warden');
    assert.equal(result.service.hostServiceUrl, 'http://192.168.1.25');
    assert.equal(result.service.env.SERVER_IP, '192.168.1.25');
    assert.equal(result.service.env.AUTO_UPDATES, 'true');
    assert.deepEqual(result.service.runtimeConfig.env, {SERVER_IP: '192.168.1.25', AUTO_UPDATES: 'true'});
    assert.equal(warden.getServiceConfig('noona-kavita').hostServiceUrl, 'http://192.168.1.25:5000');
    assert.equal(warden.getServiceConfig('noona-kavita').env.SERVER_IP, '192.168.1.25');
    assert.equal(warden.getServiceConfig('noona-moon').hostServiceUrl, 'http://192.168.1.25:3000');

    assert.equal(writes.length, 1);
    const [collection, query, update, options] = writes[0];
    assert.equal(collection, 'noona_settings');
    assert.deepEqual(query, {key: 'services.config.noona-warden'});
    assert.deepEqual(options, {upsert: true});
    assert.equal(update.$set.service, 'noona-warden');
    assert.deepEqual(update.$set.env, {SERVER_IP: '192.168.1.25', AUTO_UPDATES: 'true'});
    assert.equal(update.$set.hostPort, null);
});

test('updateServiceConfig removes persisted service runtime overrides when cleared', async () => {
    const deletes = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-moon': {
                    name: 'noona-moon',
                    image: 'moon',
                    port: 3000,
                    internalPort: 3000,
                    envConfig: [{key: 'WEBGUI_PORT'}],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async (...args) => {
                        deletes.push(args);
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    await warden.updateServiceConfig('noona-moon', {
        env: {WEBGUI_PORT: '3010'},
        hostPort: 3010,
    });
    await warden.updateServiceConfig('noona-moon', {
        env: {},
        hostPort: null,
    });

    assert.deepEqual(deletes, [
        ['noona_settings', {key: 'services.config.noona-moon'}],
    ]);
    assert.deepEqual(warden.getServiceConfig('noona-moon').runtimeConfig, {
        hostPort: null,
        env: {},
    });
});

test('setDebug persists runtime debug overrides for managed services', async () => {
    const writes = [];
    const warden = buildWarden({
        services: {
            addon: {},
            core: {
                'noona-moon': {name: 'noona-moon'},
                'noona-sage': {name: 'noona-sage'},
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async (...args) => {
                        writes.push(args);
                    },
                },
            },
        },
        hostDockerSockets: [],
    });

    await warden.setDebug(true);

    assert.equal(writes.length, 2);
    assert.deepEqual(
        writes.map(([collection, query, update]) => ({
            collection,
            key: query.key,
            env: update.$set.env,
        })),
        [
            {
                collection: 'noona_settings',
                key: 'services.config.noona-moon',
                env: {DEBUG: 'true'},
            },
            {
                collection: 'noona_settings',
                key: 'services.config.noona-sage',
                env: {DEBUG: 'true'},
            },
        ],
    );
});

test('init stays in minimal mode after setup completes', async () => {
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerUtils,
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo'},
            },
            core: {
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon'},
                'noona-vault': {name: 'noona-vault'},
                'noona-portal': {name: 'noona-portal'},
                'noona-raven': {name: 'noona-raven'},
                'noona-oracle': {name: 'noona-oracle'},
            },
        },
        wizardState: {
            client: {
                async loadState() {
                    return {
                        completed: true,
                        verification: {
                            actor: {
                                metadata: {
                                    selectedServices: [
                                        'noona-raven',
                                        'noona-portal',
                                        'noona-moon',
                                        'noona-sage',
                                        'noona-vault',
                                        'noona-redis',
                                        'noona-mongo',
                                    ],
                                },
                            },
                        },
                    };
                },
            },
        },
        hostDockerSockets: [],
    });

    const started = [];
    warden.startService = async (service) => {
        started.push(service.name);
    };

    const result = await warden.init();

    assert.equal(result.mode, 'minimal');
    assert.equal(result.setupCompleted, true);
    assert.deepEqual(started, [
        'noona-sage',
        'noona-moon',
    ]);
});

test('stopEcosystem uses the persisted setup selection in reverse lifecycle order', async () => {
    const warden = buildWarden({
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo'},
            },
            core: {
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon'},
                'noona-vault': {name: 'noona-vault'},
                'noona-portal': {name: 'noona-portal'},
                'noona-raven': {name: 'noona-raven'},
            },
        },
        wizardState: {
            client: {
                async loadState() {
                    return {
                        completed: true,
                        verification: {
                            actor: {
                                metadata: {
                                    selectedServices: [
                                        'noona-raven',
                                        'noona-portal',
                                        'noona-moon',
                                        'noona-sage',
                                        'noona-vault',
                                        'noona-redis',
                                        'noona-mongo',
                                    ],
                                },
                            },
                        },
                    };
                },
            },
        },
        hostDockerSockets: [],
    });

    const stopped = [];
    warden.stopService = async (name, options = {}) => {
        stopped.push({name, options});
        return {service: name, stopped: true, removed: options.remove === true, reason: null};
    };

    await warden.stopEcosystem({trackedOnly: false});

    assert.deepEqual(stopped, [
        {name: 'noona-portal', options: {remove: false}},
        {name: 'noona-raven', options: {remove: false}},
        {name: 'noona-moon', options: {remove: false}},
        {name: 'noona-sage', options: {remove: false}},
        {name: 'noona-vault', options: {remove: false}},
        {name: 'noona-redis', options: {remove: false}},
        {name: 'noona-mongo', options: {remove: false}},
    ]);
});

test('stopEcosystem also stops installed managed services outside the persisted selection', async () => {
    const dockerInstance = createStubDocker({
        listContainers: async () => [
            {Id: 'portal-container', Names: ['/stack_noona-portal_1'], State: 'running', Status: 'Up 1 minute'},
        ],
    });
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async (name) => name === 'noona-portal',
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerInstance,
        dockerUtils,
        services: {
            addon: {
                'noona-redis': {name: 'noona-redis'},
                'noona-mongo': {name: 'noona-mongo'},
            },
            core: {
                'noona-sage': {name: 'noona-sage'},
                'noona-moon': {name: 'noona-moon'},
                'noona-vault': {name: 'noona-vault'},
                'noona-portal': {name: 'noona-portal'},
            },
        },
        wizardState: {
            client: {
                async loadState() {
                    return {
                        completed: true,
                        verification: {
                            actor: {
                                metadata: {
                                    selectedServices: ['noona-moon', 'noona-sage', 'noona-vault'],
                                },
                            },
                        },
                    };
                },
            },
        },
        hostDockerSockets: [],
    });

    const stopped = [];
    warden.stopService = async (name, options = {}) => {
        stopped.push({name, options});
        return {service: name, stopped: true, removed: options.remove === true, reason: null};
    };

    await warden.stopEcosystem({trackedOnly: false});

    assert.ok(stopped.some((entry) => entry.name === 'noona-portal'));
    assert.ok(stopped.every((entry) => entry.options.remove === false));
});

test('updateServiceImage does not restart an installed service when the image digest is unchanged', async () => {
    const dockerInstance = createStubDocker({
        getImage: () => ({
            inspect: async () => ({
                Id: 'img-same',
                RepoDigests: [noonaDigest('noona-sage', 'sha256:aaa')],
            }),
        }),
        pull: (_image, callback) => callback(null, {stream: true}),
        modem: {
            socketPath: '/var/run/docker.sock',
            followProgress: (_stream, onFinished) => onFinished(),
        },
    });
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => true,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerInstance,
        dockerUtils,
        services: {
            addon: {},
            core: {
                'noona-sage': {name: 'noona-sage', image: noonaImage('noona-sage')},
            },
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            headers: {
                get: (name) => (String(name).toLowerCase() === 'docker-content-digest' ? 'sha256:aaa' : null),
            },
            json: async () => ({}),
        }),
        hostDockerSockets: [],
    });

    let restartCalls = 0;
    warden.restartService = async () => {
        restartCalls += 1;
    };
    warden.refreshServiceUpdates = async () => [];

    const result = await warden.updateServiceImage('noona-sage', {restart: true});

    assert.equal(result.updated, false);
    assert.equal(result.restarted, false);
    assert.equal(result.installed, true);
    assert.equal(restartCalls, 0);
});

test('updateServiceImage stores an up-to-date snapshot immediately after a successful update', async () => {
    let imageState = {
        id: 'img-old',
        digests: [noonaDigest('noona-sage', 'sha256:aaa')],
    };
    const dockerInstance = createStubDocker({
        getImage: () => ({
            inspect: async () => ({
                Id: imageState.id,
                RepoDigests: imageState.digests,
            }),
        }),
        pull: (_image, callback) => {
            imageState = {
                id: 'img-new',
                digests: [noonaDigest('noona-sage', 'sha256:bbb')],
            };
            callback(null, {stream: true});
        },
        modem: {
            socketPath: '/var/run/docker.sock',
            followProgress: (_stream, onFinished) => onFinished(),
        },
    });
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => true,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerInstance,
        dockerUtils,
        services: {
            addon: {},
            core: {
                'noona-sage': {name: 'noona-sage', image: noonaImage('noona-sage')},
            },
        },
        fetchImpl: async () => {
            return {
                ok: true,
                status: 200,
                headers: {
                    get: (name) => (String(name).toLowerCase() === 'docker-content-digest' ? 'sha256:bbb' : null),
                },
                json: async () => ({}),
            };
        },
        hostDockerSockets: [],
    });

    let restartCalls = 0;
    warden.restartService = async () => {
        restartCalls += 1;
    };
    warden.refreshServiceUpdates = async () => [];

    const result = await warden.updateServiceImage('noona-sage', {restart: true});
    const snapshot = warden.listServiceUpdates().find((entry) => entry.service === 'noona-sage');

    assert.equal(result.updated, true);
    assert.equal(result.restarted, true);
    assert.equal(restartCalls, 1);
    assert.equal(result.snapshot?.updateAvailable, false);
    assert.deepEqual(result.snapshot?.localDigests, ['sha256:bbb']);
    assert.equal(snapshot?.updateAvailable, false);
    assert.deepEqual(snapshot?.localDigests, ['sha256:bbb']);
});

test('updateServiceImage pulls images without starting services that are not installed', async () => {
    let imageAvailable = false;
    const dockerInstance = createStubDocker({
        getImage: () => ({
            inspect: async () => {
                if (!imageAvailable) {
                    const error = new Error('Not found');
                    error.statusCode = 404;
                    throw error;
                }

                return {
                    Id: 'img-new',
                    RepoDigests: [noonaDigest('noona-sage', 'sha256:bbb')],
                };
            },
        }),
        pull: (_image, callback) => {
            imageAvailable = true;
            callback(null, {stream: true});
        },
        modem: {
            socketPath: '/var/run/docker.sock',
            followProgress: (_stream, onFinished) => onFinished(),
        },
    });
    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async () => {
        },
        waitForHealthyStatus: async () => {
        },
    };
    const warden = buildWarden({
        dockerInstance,
        dockerUtils,
        services: {
            addon: {},
            core: {
                'noona-sage': {name: 'noona-sage', image: noonaImage('noona-sage')},
            },
        },
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            headers: {
                get: (name) => (String(name).toLowerCase() === 'docker-content-digest' ? 'sha256:bbb' : null),
            },
            json: async () => ({}),
        }),
        hostDockerSockets: [],
    });

    let restartCalls = 0;
    warden.restartService = async () => {
        restartCalls += 1;
    };
    warden.refreshServiceUpdates = async () => [];

    const result = await warden.updateServiceImage('noona-sage', {restart: true});

    assert.equal(result.updated, true);
    assert.equal(result.restarted, false);
    assert.equal(result.installed, false);
    assert.equal(restartCalls, 0);
});

test('init performs an immediate service update refresh before scheduling interval checks', async () => {
    let scheduledCallback = null;
    let unrefCalled = false;

    const dockerUtils = {
        ensureNetwork: async () => {
        },
        attachSelfToNetwork: async () => {
        },
        containerExists: async () => false,
        pullImageIfNeeded: async () => {
        },
        runContainerWithLogs: async (_service, _network, trackedContainers) => {
            trackedContainers.add('tracked');
        },
        waitForHealthyStatus: async () => {
        },
    };

    const warden = buildWarden({
        dockerUtils,
        services: {
            addon: {},
            core: {
                'noona-moon': {name: 'noona-moon'},
                'noona-sage': {name: 'noona-sage'},
            },
        },
        setIntervalImpl: (callback) => {
            scheduledCallback = callback;
            return {
                unref: () => {
                    unrefCalled = true;
                },
            };
        },
    });

    const refreshCalls = [];
    warden.refreshServiceUpdates = async () => {
        refreshCalls.push('refresh');
        return [];
    };

    warden.startService = async () => {
    };

    await warden.init();

    assert.equal(refreshCalls.length, 1);
    assert.equal(typeof scheduledCallback, 'function');
    assert.equal(unrefCalled, true);
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
    warden.refreshServiceUpdates = async () => [];

    await warden.init();

    assert.deepEqual(dockerFactoryCalls, ['/remote/docker.sock']);
    assert.deepEqual(ensureClients, [successfulDocker, successfulDocker]);
    assert.deepEqual(attachClients, [successfulDocker]);
    assert.deepEqual(containerExistsClients, [successfulDocker, successfulDocker, successfulDocker, successfulDocker]);
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

test('factoryResetEcosystem removes noona containers/images and restarts in clean mode', async () => {
    const removedContainers = [];
    const removedImages = [];

    const dockerInstance = createStubDocker({
        listContainers: async () => [
            {Id: 'c-sage', Names: ['/noona-sage']},
            {Id: 'c-raven', Names: ['/stack_noona-raven_1']},
            {Id: 'c-warden', Names: ['/noona-warden']},
        ],
        getContainer: (id) => ({
            remove: async () => {
                removedContainers.push(id);
            },
        }),
        listImages: async () => [
            {Id: 'img-sage', RepoTags: [noonaImage('noona-sage')], RepoDigests: []},
            {Id: 'img-warden', RepoTags: [noonaImage('noona-warden')], RepoDigests: []},
            {Id: 'img-raven', RepoTags: ['<none>:<none>'], RepoDigests: [noonaDigest('noona-raven', 'sha256:abc')]},
        ],
        getImage: (id) => ({
            remove: async () => {
                removedImages.push(id);
            },
        }),
    });

    const warden = buildWarden({
        dockerInstance,
        services: {
            addon: {},
            core: {
                'noona-sage': {name: 'noona-sage', image: noonaImage('noona-sage')},
            },
        },
        hostDockerSockets: [],
    });

    const stopCalls = [];
    const startCalls = [];
    warden.stopEcosystem = async (options = {}) => {
        stopCalls.push(options);
        return [{service: 'noona-sage', stopped: true, removed: true}];
    };
    warden.startEcosystem = async (options = {}) => {
        startCalls.push(options);
        return {mode: 'minimal', setupCompleted: false};
    };

    const result = await warden.factoryResetEcosystem({
        confirm: 'FACTORY_RESET',
        deleteDockers: true,
        deleteRavenDownloads: false,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(stopCalls, [{trackedOnly: false, remove: true}]);
    assert.deepEqual(startCalls, [{setupCompleted: false, forceFull: false}]);
    assert.deepEqual(removedContainers.sort(), ['c-raven', 'c-sage']);
    assert.deepEqual(removedImages.sort(), ['img-raven', 'img-sage']);
    assert.equal(result.dockerCleanup.requested, true);
    assert.equal(result.ravenDownloads.requested, false);
});

test('factoryResetEcosystem marks Raven cleanup successful when no Raven mounts are present', async () => {
    const dockerInstance = createStubDocker({
        getContainer: () => ({
            inspect: async () => {
                const error = new Error('Not found');
                error.statusCode = 404;
                throw error;
            },
        }),
    });

    const warden = buildWarden({
        dockerInstance,
        services: {
            addon: {},
            core: {
                'noona-sage': {name: 'noona-sage', image: noonaImage('noona-sage')},
            },
        },
        hostDockerSockets: [],
    });

    warden.stopEcosystem = async () => [];
    warden.startEcosystem = async () => ({mode: 'minimal', setupCompleted: false});

    const result = await warden.factoryResetEcosystem({
        confirm: 'FACTORY_RESET',
        deleteDockers: false,
        deleteRavenDownloads: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.ravenDownloads.requested, true);
    assert.equal(result.ravenDownloads.mountCount, 0);
    assert.equal(result.ravenDownloads.deleted, true);
    assert.deepEqual(result.ravenDownloads.entries, []);
});

test('factoryResetEcosystem clears persisted boot snapshots and runtime overrides before restart', async () => {
    const memoryFs = createMemoryFs();
    let wizardResetCalls = 0;

    const warden = buildWarden({
        fs: memoryFs,
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        services: {
            addon: {},
            core: {
                'noona-sage': {
                    name: 'noona-sage',
                    image: noonaImage('noona-sage'),
                    envConfig: [{key: 'DEBUG'}],
                },
            },
        },
        settings: {
            client: {
                mongo: {
                    update: async () => {
                    },
                    delete: async () => {
                    },
                },
            },
        },
        wizardState: {
            client: {
                async loadState() {
                    return {
                        completed: true,
                        verification: {
                            actor: {
                                metadata: {
                                    selected: ['noona-sage'],
                                },
                            },
                        },
                    };
                },
                async resetState() {
                    wizardResetCalls += 1;
                    return null;
                },
            },
        },
        hostDockerSockets: [],
    });

    await warden.saveSetupConfig({
        version: 2,
        selected: ['noona-sage'],
        storageRoot: '/srv/noona',
        values: {
            'noona-sage': {
                DEBUG: 'true',
            },
        },
    }, {apply: false});

    assert.equal(warden.getSetupConfig({refresh: true}).exists, true);
    assert.equal(warden.getServiceConfig('noona-sage').runtimeConfig.env.DEBUG, 'true');

    const startCalls = [];
    warden.stopEcosystem = async () => [];
    warden.startEcosystem = async (options = {}) => {
        startCalls.push(options);
        return {mode: 'minimal', setupCompleted: false};
    };

    const result = await warden.factoryResetEcosystem({
        confirm: 'FACTORY_RESET',
        deleteDockers: false,
        deleteRavenDownloads: false,
    });

    assert.equal(result.bootPersistence?.setupConfig?.deleted, true);
    assert.equal(result.bootPersistence?.runtimeConfig?.deleted, true);
    assert.equal(result.bootPersistence?.runtimeOverridesCleared, true);
    assert.equal(result.bootPersistence?.wizardStateCleared, true);
    assert.equal(wizardResetCalls, 1);
    assert.equal(warden.getSetupConfig({refresh: true}).exists, false);
    assert.deepEqual(warden.getServiceConfig('noona-sage').runtimeConfig, {env: {}, hostPort: null});
    assert.equal(memoryFs.files.has(path.join('/srv/noona', 'wardenm', 'noona-settings.json')), false);
    assert.equal(memoryFs.files.has(path.join('/srv/noona', 'noona-settings.json')), false);
    assert.equal(memoryFs.files.has(path.join('/srv/noona', 'warden', 'setup-wizard-state.json')), false);
    assert.equal(memoryFs.files.has(path.join('/srv/noona', 'warden', 'service-runtime-config.json')), false);
    assert.deepEqual(startCalls, [{setupCompleted: false, forceFull: false}]);
});

test('shutdownAll stops managed containers without removing them and exits with code 0', async () => {
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
        listContainers: async () => [
            {Id: 'svc-1', Names: ['/svc-1'], State: 'running', Status: 'Up 1 minute'},
            {Id: 'svc-2', Names: ['/svc-2'], State: 'running', Status: 'Up 1 minute'},
        ],
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
        'stop:svc-2',
        'Stopped svc-2',
        'stop:svc-1',
        'Stopped svc-1',
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
