import assert from 'node:assert/strict';
import test from 'node:test';

import {createWarden} from '../core/createWarden.mjs';

const createDockerInstance = () => ({
    listContainers: async () => [],
});

test('managed Vault and data services use isolated network attachments at runtime', async () => {
    const startedServices = [];
    const warden = createWarden({
        env: {NOONA_DATA_ROOT: '/srv/noona'},
        dockerInstance: createDockerInstance(),
        storageLayoutBootstrap: false,
        logger: {
            log() {
            }, warn() {
            }
        },
        dockerUtils: {
            attachSelfToNetwork: async () => {
            },
            containerExists: async () => false,
            ensureNetwork: async () => {
            },
            pullImageIfNeeded: async () => {
            },
            removeContainers: async () => [],
            runContainerWithLogs: async (service) => {
                startedServices.push(service);
            },
            waitForContainerHealthy: async () => {
            },
            waitForHealthyStatus: async () => {
            },
        },
    });

    await warden.restartService('noona-vault');
    await warden.restartService('noona-mongo');
    await warden.restartService('noona-redis');

    const vault = startedServices.find((service) => service.name === 'noona-vault');
    const mongo = startedServices.find((service) => service.name === 'noona-mongo');
    const redis = startedServices.find((service) => service.name === 'noona-redis');

    assert.deepEqual(vault.networks, ['noona-network', 'noona-data-network']);
    assert.deepEqual(mongo.networks, ['noona-data-network']);
    assert.deepEqual(redis.networks, ['noona-data-network']);
});
