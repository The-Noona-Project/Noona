import assert from 'node:assert/strict';
import test from 'node:test';

import { containerExists } from '../docker/dockerUtilties.mjs';

test('containerExists detects exact container name matches', async () => {
    const dockerInstance = {
        listContainers: async () => [
            { Names: ['/noona-portal'] },
            { Names: ['/noona-vault'] },
        ],
    };

    assert.equal(await containerExists('noona-portal', { dockerInstance }), true);
    assert.equal(await containerExists('noona-raven', { dockerInstance }), false);
});

test('containerExists recognizes docker-compose naming patterns', async () => {
    const dockerInstance = {
        listContainers: async () => [
            { Names: ['/stack_noona-portal_1'] },
            { Names: ['/stack-noona-raven-1'] },
            { Names: ['/unrelated-service'] },
        ],
    };

    assert.equal(await containerExists('noona-portal', { dockerInstance }), true);
    assert.equal(await containerExists('noona-raven', { dockerInstance }), true);
    assert.equal(await containerExists('noona-vault', { dockerInstance }), false);
});

test('containerExists handles containers without name metadata', async () => {
    const dockerInstance = {
        listContainers: async () => [
            { Names: null },
            {},
        ],
    };

    assert.equal(await containerExists('noona-portal', { dockerInstance }), false);
});
