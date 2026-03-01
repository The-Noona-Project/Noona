import assert from 'node:assert/strict';
import {test} from 'node:test';

import {createPortalApp} from '../app/createPortalApp.mjs';

const startServer = async app => new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        resolve({
            server,
            baseUrl: `http://127.0.0.1:${address.port}`,
        });
    });
});

const stopServer = async server => new Promise((resolve, reject) => {
    server.close(error => {
        if (error) {
            reject(error);
            return;
        }

        resolve();
    });
});

test('GET /api/portal/join-options returns role descriptions and libraries for Moon settings', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            fetchRoles: async () => ['Pleb', 'Download', 'Read Only'],
            fetchLibraries: async () => [
                {id: 3, name: 'Manga'},
                {id: null, name: 'Skip me'},
            ],
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/join-options`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(payload.roles, ['Pleb', 'Download', 'Read Only']);
        assert.deepEqual(payload.roleDetails, [
            {
                name: 'Pleb',
                description: 'Baseline non-admin role. Pair this with other roles to grant day-to-day access.',
            },
            {
                name: 'Download',
                description: 'Allows the user to download supported files from Kavita.',
            },
            {
                name: 'Read Only',
                description: 'Keeps the account in read-only mode inside Kavita.',
            },
        ]);
        assert.deepEqual(payload.libraries, [
            {
                id: 3,
                name: 'Manga',
            },
        ]);
    } finally {
        await stopServer(server);
    }
});
