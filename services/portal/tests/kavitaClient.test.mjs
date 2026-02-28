import assert from 'node:assert/strict';
import test from 'node:test';

import createKavitaClient from '../shared/kavitaClient.mjs';

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
