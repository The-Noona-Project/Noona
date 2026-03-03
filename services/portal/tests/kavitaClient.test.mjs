import assert from 'node:assert/strict';
import test from 'node:test';

import createKavitaClient from '../clients/kavitaClient.mjs';

test('createUser composes Kavita invite, update, and reset-password calls', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const requestUrl = new URL(url);
        calls.push({
            pathname: requestUrl.pathname,
            search: requestUrl.search,
            method: options.method,
            body: options.body ? JSON.parse(options.body) : null,
        });

        if (requestUrl.pathname === '/api/Users') {
            const payload = calls.filter(call => call.pathname === '/api/Users').length === 1
                ? []
                : [{id: 44, email: 'reader@example.com', isPending: true}];
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(payload),
            };
        }

        if (requestUrl.pathname === '/api/Account/roles') {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(['Pleb', 'Admin']),
            };
        }

        if (requestUrl.pathname === '/api/Library/libraries') {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify([
                    {id: 1, name: 'Manga'},
                    {id: 2, name: 'Light Novels'},
                ]),
            };
        }

        return {
            ok: true,
            status: 200,
            text: async () => '',
        };
    };

    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl,
    });

    const created = await kavita.createUser({
        username: 'reader',
        email: 'reader@example.com',
        password: 'hunter2',
        roles: ['pleb'],
        libraries: ['Light Novels'],
    });

    assert.equal(created.id, 44);
    assert.deepEqual(created.roles, ['Pleb']);
    assert.deepEqual(created.libraries, [2]);
    assert.deepEqual(calls.map(call => call.pathname), [
        '/api/Users',
        '/api/Account/roles',
        '/api/Library/libraries',
        '/api/Account/invite',
        '/api/Users',
        '/api/Account/update',
        '/api/Account/reset-password',
    ]);
    assert.deepEqual(calls[3].body, {
        email: 'reader@example.com',
        roles: ['Pleb'],
        libraries: [2],
    });
    assert.deepEqual(calls[5].body, {
        userId: 44,
        username: 'reader',
        email: 'reader@example.com',
        roles: ['Pleb'],
        libraries: [2],
    });
    assert.deepEqual(calls[6].body, {
        userName: 'reader',
        password: 'hunter2',
    });
});

test('createUser expands wildcard role and library defaults before calling Kavita', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const requestUrl = new URL(url);
        calls.push({
            pathname: requestUrl.pathname,
            search: requestUrl.search,
            method: options.method,
            body: options.body ? JSON.parse(options.body) : null,
        });

        if (requestUrl.pathname === '/api/Users') {
            const payload = calls.filter(call => call.pathname === '/api/Users').length === 1
                ? []
                : [{id: 51, email: 'reader@example.com', isPending: true}];
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(payload),
            };
        }

        if (requestUrl.pathname === '/api/Account/roles') {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify(['Pleb', 'Download', 'Admin']),
            };
        }

        if (requestUrl.pathname === '/api/Library/libraries') {
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify([
                    {id: 1, name: 'Manga'},
                    {id: 2, name: 'Light Novels'},
                    {id: 3, name: 'Comics'},
                ]),
            };
        }

        return {
            ok: true,
            status: 200,
            text: async () => '',
        };
    };

    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl,
    });

    const created = await kavita.createUser({
        username: 'reader',
        email: 'reader@example.com',
        password: 'hunter2',
        roles: ['*', '-admin'],
        libraries: ['*', '-2'],
    });

    assert.deepEqual(created.roles, ['Pleb', 'Download']);
    assert.deepEqual(created.libraries, [1, 3]);
    assert.deepEqual(calls[3].body, {
        email: 'reader@example.com',
        roles: ['Pleb', 'Download'],
        libraries: [1, 3],
    });
    assert.deepEqual(calls[5].body, {
        userId: 51,
        username: 'reader',
        email: 'reader@example.com',
        roles: ['Pleb', 'Download'],
        libraries: [1, 3],
    });
});

test('createUser rejects duplicate usernames or emails before inviting', async () => {
    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify([{id: 7, username: 'reader', email: 'reader@example.com'}]),
        }),
    });

    await assert.rejects(
        () => kavita.createUser({
            username: 'reader',
            email: 'reader@example.com',
            password: 'hunter2',
        }),
        /already exists/i,
    );
});

test('fetchLibraries uses Kavita libraries endpoint', async () => {
    const calls = [];
    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl: async (url, options) => {
            calls.push({url, options});

            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify([
                    {id: 1, name: 'Manga'},
                ]),
            };
        },
    });

    const libraries = await kavita.fetchLibraries();

    assert.equal(libraries.length, 1);
    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.pathname, '/api/Library/libraries');
    assert.equal(calls[0].options.method, 'GET');
});

test('ensureLibrary updates existing Kavita library folders when new Raven roots are missing', async () => {
    const calls = [];
    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl: async (url, options) => {
            const requestUrl = new URL(url);
            calls.push({
                pathname: requestUrl.pathname,
                method: options.method,
                body: options.body ? JSON.parse(options.body) : null,
            });

            if (requestUrl.pathname === '/api/Library/libraries') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify([
                        {id: 7, name: 'Manhwa', folders: ['/manga/manhwa']},
                    ]),
                };
            }

            if (requestUrl.pathname === '/api/Library/update') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: 7,
                        name: 'Manhwa',
                        folders: [
                            '/manga/downloaded/manhwa',
                            '/manga/manhwa',
                            '/manga/Noona/raven/downloads/downloaded/manhwa',
                            '/manga/Noona/raven/downloads/manhwa',
                        ],
                    }),
                };
            }

            throw new Error(`Unexpected request to ${requestUrl.pathname}`);
        },
    });

    const result = await kavita.ensureLibrary({
        name: 'Manhwa',
        payload: {
            folders: [
                '/manga/downloaded/manhwa',
                '/manga/manhwa',
                '/manga/Noona/raven/downloads/downloaded/manhwa',
                '/manga/Noona/raven/downloads/manhwa',
            ],
        },
    });

    assert.equal(result.created, false);
    assert.deepEqual(result.library?.folders, [
        '/manga/downloaded/manhwa',
        '/manga/manhwa',
        '/manga/Noona/raven/downloads/downloaded/manhwa',
        '/manga/Noona/raven/downloads/manhwa',
    ]);
    assert.deepEqual(calls.map(call => call.pathname), [
        '/api/Library/libraries',
        '/api/Library/update',
    ]);
    assert.deepEqual(calls[1].body, {
        id: 7,
        name: 'Manhwa',
        folders: [
            '/manga/downloaded/manhwa',
            '/manga/manhwa',
            '/manga/Noona/raven/downloads/downloaded/manhwa',
            '/manga/Noona/raven/downloads/manhwa',
        ],
    });
});

test('searchTitles queries Kavita search endpoint with a trimmed title', async () => {
    const calls = [];
    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl: async (url, options) => {
            calls.push({url, options});

            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    series: [{seriesId: 1, name: 'One Piece'}],
                }),
            };
        },
    });

    const response = await kavita.searchTitles('  One Piece  ');

    assert.equal(response.series.length, 1);
    assert.equal(calls.length, 1);

    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.origin, 'https://kavita.example');
    assert.equal(requestUrl.pathname, '/api/Search/search');
    assert.equal(requestUrl.searchParams.get('queryString'), 'One Piece');
    assert.equal(requestUrl.searchParams.get('includeChapterAndFiles'), 'false');
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(calls[0].options.headers['X-Api-Key'], 'portal-api-key');
});

test('searchTitles retries alternate Kavita search payloads after a 400 response', async () => {
    const calls = [];
    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl: async (url, options) => {
            const requestUrl = new URL(url);
            calls.push({
                pathname: requestUrl.pathname,
                method: options.method,
                queryString: requestUrl.searchParams.get('queryString'),
                includeChapterAndFiles: requestUrl.searchParams.get('includeChapterAndFiles'),
                body: options.body ? JSON.parse(options.body) : null,
            });

            if (calls.length === 1) {
                return {
                    ok: false,
                    status: 400,
                    text: async () => JSON.stringify({error: 'Bad request'}),
                };
            }

            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    results: [{seriesId: 9, name: 'Absolute Duo'}],
                }),
            };
        },
    });

    const response = await kavita.searchTitles('Absolute Duo');

    assert.equal(response.series.length, 1);
    assert.equal(response.series[0].seriesId, 9);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], {
        pathname: '/api/Search/search',
        method: 'GET',
        queryString: 'Absolute Duo',
        includeChapterAndFiles: 'false',
        body: null,
    });
    assert.deepEqual(calls[1], {
        pathname: '/api/Search/search',
        method: 'GET',
        queryString: 'Absolute Duo',
        includeChapterAndFiles: null,
        body: null,
    });
});

test('searchTitles rejects empty title queries', async () => {
    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl: async () => {
            throw new Error('fetchImpl should not be called for empty queries');
        },
    });

    await assert.rejects(() => kavita.searchTitles('   '), /Title query is required/i);
});

test('scanLibrary triggers Kavita library scan endpoint', async () => {
    const calls = [];
    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl: async (url, options) => {
            calls.push({url, options});

            return {
                ok: true,
                status: 200,
                text: async () => '',
            };
        },
    });

    await kavita.scanLibrary(12, {force: true});

    assert.equal(calls.length, 1);
    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.pathname, '/api/Library/scan');
    assert.equal(requestUrl.searchParams.get('libraryId'), '12');
    assert.equal(requestUrl.searchParams.get('force'), 'true');
    assert.equal(calls[0].options.method, 'POST');
});

test('scanLibrary rejects invalid library ids', async () => {
    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl: async () => {
            throw new Error('fetchImpl should not be called for invalid library ids');
        },
    });

    await assert.rejects(() => kavita.scanLibrary('abc'), /valid Kavita library id/i);
});

test('fetchSeriesMetadataMatches calls Kavita series match endpoint', async () => {
    const calls = [];
    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl: async (url, options) => {
            calls.push({url, options});

            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify([{provider: 'AniList', aniListId: 123}]),
            };
        },
    });

    const matches = await kavita.fetchSeriesMetadataMatches(42);

    assert.equal(matches.length, 1);
    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.pathname, '/api/Series/match');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), {seriesId: 42});
});

test('applySeriesMetadataMatch sends provider ids to Kavita update-match endpoint', async () => {
    const calls = [];
    const kavita = createKavitaClient({
        baseUrl: 'https://kavita.example',
        apiKey: 'portal-api-key',
        fetchImpl: async (url, options) => {
            calls.push({url, options});

            return {
                ok: true,
                status: 200,
                text: async () => '',
            };
        },
    });

    await kavita.applySeriesMetadataMatch({seriesId: 42, aniListId: 151807});

    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.pathname, '/api/Series/update-match');
    assert.equal(requestUrl.searchParams.get('seriesId'), '42');
    assert.equal(requestUrl.searchParams.get('aniListId'), '151807');
    assert.equal(calls[0].options.method, 'POST');
});
