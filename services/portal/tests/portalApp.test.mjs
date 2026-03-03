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

const buildUpstreamError = (message, {status = 500, details = null} = {}) => {
    const error = new Error(message);
    error.status = status;
    error.details = details;
    return error;
};

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

test('GET /api/portal/kavita/info returns the configured Kavita base URL for Moon', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            kavita: {
                baseUrl: 'http://noona-kavita:5000/',
            },
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            getBaseUrl: () => 'http://noona-kavita:5000/',
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/info`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.baseUrl, 'http://noona-kavita:5000/');
        assert.equal(payload.managedService, 'noona-kavita');
    } finally {
        await stopServer(server);
    }
});

test('GET /api/portal/kavita/title-search returns Kavita series links for Moon title pages', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            kavita: {
                baseUrl: 'http://noona-kavita:5000/',
            },
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            getBaseUrl: () => 'http://noona-kavita:5000/',
            searchTitles: async () => ({
                series: [
                    {
                        seriesId: 17,
                        libraryId: 4,
                        name: 'Solo Leveling',
                        originalName: 'Na Honjaman Level Up',
                        localizedName: 'Only I Level Up',
                        libraryName: 'Manhwa',
                    },
                ],
            }),
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/title-search?query=Solo%20Leveling`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.series.length, 1);
        assert.equal(payload.series[0].seriesId, 17);
        assert.equal(payload.series[0].libraryId, 4);
        assert.equal(payload.series[0].url, 'http://noona-kavita:5000/library/4/series/17');
        assert.deepEqual(payload.series[0].aliases, ['Na Honjaman Level Up', 'Only I Level Up']);
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/title-match and apply proxy Kavita metadata matching', async () => {
    const calls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            fetchSeriesMetadataMatches: async (seriesId) => {
                calls.push({type: 'search', seriesId});
                return [
                    {
                        provider: 'AniList',
                        title: 'Solo Leveling',
                        aniListId: 151807,
                        score: 98,
                    },
                ];
            },
            applySeriesMetadataMatch: async (payload) => {
                calls.push({type: 'apply', payload});
                return {ok: true};
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const searchResponse = await fetch(`${baseUrl}/api/portal/kavita/title-match`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({seriesId: 17}),
        });
        const searchPayload = await searchResponse.json();
        assert.equal(searchResponse.status, 200);
        assert.equal(searchPayload.matches.length, 1);
        assert.equal(searchPayload.matches[0].aniListId, 151807);

        const applyResponse = await fetch(`${baseUrl}/api/portal/kavita/title-match/apply`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({seriesId: 17, aniListId: 151807}),
        });
        const applyPayload = await applyResponse.json();
        assert.equal(applyResponse.status, 200);
        assert.equal(applyPayload.success, true);
        assert.deepEqual(calls, [
            {type: 'search', seriesId: 17},
            {type: 'apply', payload: {seriesId: 17, aniListId: 151807, malId: undefined, cbrId: undefined}},
        ]);
    } finally {
        await stopServer(server);
    }
});

test('metadata match routes return compact operator guidance when Kavita fails server-side', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            fetchSeriesMetadataMatches: async () => {
                throw buildUpstreamError('Kavita request failed with status 500', {
                    details: {message: 'System.NullReferenceException', stack: 'very large upstream payload'},
                });
            },
            applySeriesMetadataMatch: async () => {
                throw buildUpstreamError('Kavita request failed with status 500', {
                    details: {message: 'System.NullReferenceException', stack: 'very large upstream payload'},
                });
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const lookupResponse = await fetch(`${baseUrl}/api/portal/kavita/title-match`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({seriesId: 17}),
        });
        const lookupPayload = await lookupResponse.json();
        assert.equal(lookupResponse.status, 500);
        assert.match(lookupPayload.error, /Check Komf \/config\/application\.yml metadataProviders/);
        assert.equal(lookupPayload.details, null);

        const applyResponse = await fetch(`${baseUrl}/api/portal/kavita/title-match/apply`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({seriesId: 17, aniListId: 151807}),
        });
        const applyPayload = await applyResponse.json();
        assert.equal(applyResponse.status, 500);
        assert.match(applyPayload.error, /restart noona-komf plus noona-kavita/);
        assert.equal(applyPayload.details, null);
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/libraries/ensure proxies Kavita library creation requests', async () => {
    const calls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            ensureLibrary: async ({name, payload}) => {
                calls.push({name, payload});
                return {
                    created: true,
                    library: {name, id: 12},
                };
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/libraries/ensure`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                name: 'Manhwa',
                payload: {
                    folders: ['/manga/manhwa'],
                },
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 201);
        assert.deepEqual(calls, [{
            name: 'Manhwa',
            payload: {
                folders: ['/manga/manhwa'],
            },
        }]);
        assert.equal(payload.success, true);
        assert.equal(payload.created, true);
        assert.equal(payload.library.name, 'Manhwa');
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/libraries/scan resolves a library by name and scans it', async () => {
    const calls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            fetchLibraries: async () => [
                {id: 7, name: 'Manhwa'},
                {id: 8, name: 'Manga'},
            ],
            scanLibrary: async (libraryId, {force} = {}) => {
                calls.push({libraryId, force});
                return {queued: true};
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/libraries/scan`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                name: 'Manhwa',
                force: true,
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(calls, [{
            libraryId: 7,
            force: true,
        }]);
        assert.equal(payload.success, true);
        assert.equal(payload.library.name, 'Manhwa');
        assert.equal(payload.force, true);
    } finally {
        await stopServer(server);
    }
});
