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

test('GET /api/portal/kavita/users returns Kavita users and role metadata for Moon user management', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            fetchRoles: async () => ['Pleb', 'Login', 'Download'],
            fetchUsers: async () => [
                {
                    id: 9,
                    username: 'reader.one',
                    email: 'reader.one@example.com',
                    roles: ['Pleb', 'Login'],
                    libraries: [1, 2],
                    isPending: false,
                },
                {
                    id: null,
                    username: 'skip.me',
                    email: 'skip.me@example.com',
                    roles: ['Pleb'],
                },
            ],
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/users`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(payload.roles, ['Pleb', 'Login', 'Download']);
        assert.equal(Array.isArray(payload.roleDetails), true);
        assert.deepEqual(payload.users, [
            {
                id: 9,
                username: 'reader.one',
                email: 'reader.one@example.com',
                roles: ['Pleb', 'Login'],
                libraries: [1, 2],
                pending: false,
            },
        ]);
    } finally {
        await stopServer(server);
    }
});

test('PUT /api/portal/kavita/users/:username/roles updates a Kavita user role set', async () => {
    const updateCalls = [];
    const users = [
        {
            id: 12,
            username: 'reader.one',
            email: 'reader.one@example.com',
            roles: ['Pleb'],
            libraries: [5],
            ageRestriction: {
                ageRating: 3,
                includeUnknowns: false,
            },
            isPending: false,
        },
    ];

    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            fetchRoles: async () => ['Pleb', 'Login', 'Download'],
            fetchUser: async (username) =>
                users.find((entry) => entry.username.toLowerCase() === String(username).toLowerCase()) ?? null,
            updateUser: async (payload) => {
                updateCalls.push(payload);
                const index = users.findIndex((entry) => String(entry.id) === String(payload.userId));
                if (index >= 0) {
                    users[index] = {
                        ...users[index],
                        username: payload.username,
                        email: payload.email,
                        roles: payload.roles,
                        libraries: payload.libraries,
                    };
                }
                return {
                    ok: true,
                };
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/users/reader.one/roles`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                roles: ['login', 'Download'],
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(updateCalls, [
            {
                userId: 12,
                username: 'reader.one',
                email: 'reader.one@example.com',
                roles: ['Login', 'Download'],
                libraries: [5],
                ageRestriction: {
                    ageRating: 3,
                    includeUnknowns: false,
                },
            },
        ]);
        assert.deepEqual(payload.roles, ['Login', 'Download']);
        assert.equal(payload.user.username, 'reader.one');
        assert.deepEqual(payload.user.roles, ['Login', 'Download']);
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

test('GET /api/portal/kavita/info prefers configured external Kavita URL for Moon links', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            kavita: {
                baseUrl: 'http://noona-kavita:5000/',
                externalUrl: 'https://kavita.example.com',
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
        assert.equal(payload.baseUrl, 'https://kavita.example.com/');
        assert.equal(payload.externalBaseUrl, 'https://kavita.example.com/');
        assert.equal(payload.internalBaseUrl, 'http://noona-kavita:5000/');
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/noona-login provisions a Kavita account and returns a one-time login token', async () => {
    const kavitaCalls = [];
    const storedCredentials = [];
    const tokens = new Map();
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            kavita: {
                baseUrl: 'http://noona-kavita:5000/',
                externalUrl: 'https://kavita.example.com',
            },
            join: {
                defaultRoles: ['Pleb', 'Login'],
                defaultLibraries: ['Manga'],
            },
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            createOrUpdateUser: async (payload) => {
                kavitaCalls.push(payload);
                return {
                    id: 42,
                    username: payload.username,
                    email: payload.email,
                    roles: ['Pleb', 'Login'],
                    libraries: ['Manga'],
                    created: true,
                };
            },
        },
        vault: {
            readSecret: async () => null,
            storePortalCredential: async (discordId, credential) => {
                storedCredentials.push({discordId, credential});
            },
        },
        onboardingStore: {
            setToken: async (discordId, payload) => {
                const record = {token: 'login-token-1', discordId, ...payload};
                tokens.set(record.token, record);
                return record;
            },
            getToken: async (token) => tokens.get(token) ?? null,
            consumeToken: async (token) => {
                const record = tokens.get(token) ?? null;
                tokens.delete(token);
                return record;
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/noona-login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                discordId: '123456789012345678',
                email: 'reader@example.com',
                username: 'Reader Display',
                discordUsername: 'reader.discord',
                displayName: 'Reader Display',
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 201);
        assert.equal(payload.token, 'login-token-1');
        assert.equal(payload.baseUrl, 'https://kavita.example.com/');
        assert.equal(payload.username, 'reader.discord');
        assert.equal(kavitaCalls.length, 1);
        assert.equal(kavitaCalls[0].username, 'reader.discord');
        assert.equal(kavitaCalls[0].email, 'reader@example.com');
        assert.deepEqual(kavitaCalls[0].roles, ['Pleb', 'Login']);
        assert.deepEqual(kavitaCalls[0].libraries, ['Manga']);
        assert.match(kavitaCalls[0].password, /^Noona-/);
        assert.deepEqual(storedCredentials, [{
            discordId: '123456789012345678',
            credential: {
                username: 'reader.discord',
                email: 'reader@example.com',
                password: kavitaCalls[0].password,
                roles: ['Pleb', 'Login'],
                libraries: ['Manga'],
                issuedAt: storedCredentials[0].credential.issuedAt,
            },
        }]);
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/noona-login continues when Vault credential reads or writes fail', async () => {
    const kavitaCalls = [];
    const tokens = new Map();
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            kavita: {
                baseUrl: 'http://noona-kavita:5000/',
                externalUrl: 'https://kavita.example.com',
            },
            join: {
                defaultRoles: ['Pleb', 'Login'],
                defaultLibraries: ['Manga'],
            },
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            createOrUpdateUser: async (payload) => {
                kavitaCalls.push(payload);
                return {
                    id: 142,
                    username: payload.username,
                    email: payload.email,
                    roles: ['Pleb', 'Login'],
                    libraries: ['Manga'],
                    created: true,
                };
            },
        },
        vault: {
            readSecret: async () => {
                const error = new Error('Vault read unavailable');
                error.status = 503;
                throw error;
            },
            storePortalCredential: async () => {
                const error = new Error('Vault write unavailable');
                error.status = 503;
                throw error;
            },
        },
        onboardingStore: {
            setToken: async (discordId, payload) => {
                const record = {token: 'login-token-vault-soft-fail', discordId, ...payload};
                tokens.set(record.token, record);
                return record;
            },
            getToken: async (token) => tokens.get(token) ?? null,
            consumeToken: async (token) => {
                const record = tokens.get(token) ?? null;
                tokens.delete(token);
                return record;
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/noona-login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                discordId: '333333333333333333',
                email: 'reader@example.com',
                username: 'Reader Display',
                discordUsername: 'reader.discord',
                displayName: 'Reader Display',
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 201);
        assert.equal(payload.token, 'login-token-vault-soft-fail');
        assert.equal(payload.username, 'reader.discord');
        assert.equal(kavitaCalls.length, 1);
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/noona-login retries with safe fallback roles after Kavita returns 400', async () => {
    const kavitaCalls = [];
    const tokens = new Map();
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            kavita: {
                baseUrl: 'http://noona-kavita:5000/',
                externalUrl: 'https://kavita.example.com',
            },
            join: {
                defaultRoles: ['Pleb', 'Login'],
                defaultLibraries: ['Manga'],
            },
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            createOrUpdateUser: async (payload) => {
                kavitaCalls.push(payload);
                if (kavitaCalls.length === 1) {
                    const error = new Error('Kavita request failed with status 400');
                    error.status = 400;
                    throw error;
                }

                return {
                    id: 52,
                    username: payload.username,
                    email: payload.email,
                    roles: payload.roles,
                    libraries: payload.libraries,
                    created: false,
                };
            },
        },
        vault: {
            readSecret: async () => null,
            storePortalCredential: async () => {
            },
        },
        onboardingStore: {
            setToken: async (discordId, payload) => {
                const record = {token: 'login-token-retry', discordId, ...payload};
                tokens.set(record.token, record);
                return record;
            },
            getToken: async (token) => tokens.get(token) ?? null,
            consumeToken: async (token) => {
                const record = tokens.get(token) ?? null;
                tokens.delete(token);
                return record;
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/noona-login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                discordId: '999999999999999999',
                email: 'reader@example.com',
                username: 'Reader Display',
                discordUsername: 'reader.discord',
                displayName: 'Reader Display',
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.token, 'login-token-retry');
        assert.equal(kavitaCalls.length, 2);
        assert.deepEqual(kavitaCalls[0].roles, ['Pleb', 'Login']);
        assert.deepEqual(kavitaCalls[0].libraries, ['Manga']);
        assert.deepEqual(kavitaCalls[1].roles, ['Pleb', 'Login']);
        assert.deepEqual(kavitaCalls[1].libraries, []);
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/noona-login fails clearly when token storage does not return a token', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            kavita: {
                baseUrl: 'http://noona-kavita:5000/',
                externalUrl: 'https://kavita.example.com',
            },
            join: {
                defaultRoles: ['Pleb', 'Login'],
                defaultLibraries: ['Manga'],
            },
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            createOrUpdateUser: async (payload) => ({
                id: 77,
                username: payload.username,
                email: payload.email,
                roles: ['Pleb', 'Login'],
                libraries: ['Manga'],
                created: true,
            }),
        },
        vault: {
            readSecret: async () => null,
            storePortalCredential: async () => {
            },
        },
        onboardingStore: {
            setToken: async (discordId, payload) => ({discordId, ...payload}),
            getToken: async () => null,
            consumeToken: async () => null,
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/noona-login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                discordId: '444444444444444444',
                email: 'reader@example.com',
                username: 'Reader Display',
                discordUsername: 'reader.discord',
                displayName: 'Reader Display',
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 502);
        assert.equal(payload.error, 'Portal login token storage did not return a token.');
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/noona-login remaps to an existing user when Kavita reports username already taken', async () => {
    const kavitaCalls = [];
    const fetchUsersCalls = [];
    const tokens = new Map();
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            kavita: {
                baseUrl: 'http://noona-kavita:5000/',
                externalUrl: 'https://kavita.example.com',
            },
            join: {
                defaultRoles: ['Pleb', 'Login'],
                defaultLibraries: ['Manga'],
            },
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            createOrUpdateUser: async (payload) => {
                kavitaCalls.push(payload);
                if (kavitaCalls.length === 1) {
                    const error = new Error('Kavita request failed with status 400: Username already taken');
                    error.status = 400;
                    throw error;
                }

                return {
                    id: 1,
                    username: payload.username,
                    email: payload.email,
                    roles: payload.roles,
                    libraries: payload.libraries,
                    created: false,
                };
            },
            fetchUsers: async (options = {}) => {
                fetchUsersCalls.push(options);
                return [
                    {
                        id: 1,
                        username: 'server-admin',
                        email: 'reader@example.com',
                        roles: ['Admin'],
                        libraries: [{id: 1, name: 'Manga'}],
                        ageRestriction: {
                            ageRating: -1,
                            includeUnknowns: true,
                        },
                    },
                ];
            },
        },
        vault: {
            readSecret: async () => null,
            storePortalCredential: async () => {
            },
        },
        onboardingStore: {
            setToken: async (discordId, payload) => {
                const record = {token: 'login-token-remap', discordId, ...payload};
                tokens.set(record.token, record);
                return record;
            },
            getToken: async (token) => tokens.get(token) ?? null,
            consumeToken: async (token) => {
                const record = tokens.get(token) ?? null;
                tokens.delete(token);
                return record;
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/noona-login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                discordId: '222222222222222222',
                email: 'reader@example.com',
                username: 'Reader Display',
                discordUsername: 'reader.discord',
                displayName: 'Reader Display',
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.token, 'login-token-remap');
        assert.equal(kavitaCalls.length, 2);
        assert.deepEqual(fetchUsersCalls, [{includePending: true}]);
        assert.equal(kavitaCalls[0].username, 'reader.discord');
        assert.equal(kavitaCalls[1].username, 'server-admin');
        assert.equal(kavitaCalls[1].email, 'reader@example.com');
        assert.deepEqual(kavitaCalls[1].roles, ['Admin']);
        assert.deepEqual(kavitaCalls[1].libraries, [1]);
        assert.deepEqual(kavitaCalls[1].ageRestriction, {
            ageRating: -1,
            includeUnknowns: true,
        });
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/login-tokens/consume redeems one-time Noona Kavita login tokens', async () => {
    const tokens = new Map([
        ['login-token-2', {
            token: 'login-token-2',
            type: 'noona-kavita-login',
            username: 'reader.discord',
            email: 'reader@example.com',
            password: 'Noona-secret-password',
        }],
    ]);
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        onboardingStore: {
            setToken: async () => {
                throw new Error('setToken should not be called');
            },
            getToken: async (token) => tokens.get(token) ?? null,
            consumeToken: async (token) => {
                const record = tokens.get(token) ?? null;
                tokens.delete(token);
                return record;
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/login-tokens/consume`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({token: 'login-token-2'}),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(payload, {
            success: true,
            record: {
                username: 'reader.discord',
                email: 'reader@example.com',
                password: 'Noona-secret-password',
            },
        });
        assert.equal(tokens.size, 0);
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

test('GET /api/portal/kavita/title-search rebuilds series links with external Kavita URL when configured', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            kavita: {
                baseUrl: 'http://noona-kavita:5000/',
                externalUrl: 'https://kavita.example.com',
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
        assert.equal(payload.baseUrl, 'https://kavita.example.com/');
        assert.equal(payload.series.length, 1);
        assert.equal(payload.series[0].url, 'https://kavita.example.com/library/4/series/17');
    } finally {
        await stopServer(server);
    }
});

test('GET /api/portal/kavita/series-metadata returns unmatched Kavita series for Moon batch metadata flows', async () => {
    const calls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            getBaseUrl: () => 'http://noona-kavita:5000/',
            fetchSeriesMetadataStatus: async (options = {}) => {
                calls.push(options);
                return [
                    {
                        isMatched: false,
                        validUntilUtc: '0001-01-01T00:00:00Z',
                        series: {
                            seriesId: 17,
                            libraryId: 4,
                            name: 'Solo Leveling',
                            originalName: 'Na Honjaman Level Up',
                            localizedName: 'Only I Level Up',
                            libraryName: 'Manhwa',
                        },
                    },
                ];
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/series-metadata?state=notMatched&pageSize=0`);
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(calls, [
            {
                matchStateOption: 2,
                libraryType: -1,
                searchTerm: '',
                pageNumber: 1,
                pageSize: 0,
            },
        ]);
        assert.deepEqual(payload, {
            state: 'notMatched',
            pageNumber: 1,
            pageSize: 0,
            items: [
                {
                    seriesId: 17,
                    libraryId: 4,
                    name: 'Solo Leveling',
                    originalName: 'Na Honjaman Level Up',
                    localizedName: 'Only I Level Up',
                    libraryName: 'Manhwa',
                    aliases: ['Na Honjaman Level Up', 'Only I Level Up'],
                    url: 'http://noona-kavita:5000/library/4/series/17',
                    isMatched: false,
                    validUntilUtc: '0001-01-01T00:00:00Z',
                },
            ],
        });
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
            fetchSeriesMetadataMatches: async (seriesId, {query} = {}) => {
                calls.push({type: 'search', seriesId, query});
                return [
                    {
                        series: {
                            provider: 'AniList',
                            name: 'Solo Leveling',
                            summary: 'Hunters climb the tower.',
                            aniListId: 151807,
                            malId: 3000,
                            coverUrl: 'https://covers.example/solo-leveling.jpg',
                        },
                        matchRating: 98,
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
            body: JSON.stringify({seriesId: 17, query: 'Solo Leveling'}),
        });
        const searchPayload = await searchResponse.json();
        assert.equal(searchResponse.status, 200);
        assert.equal(searchPayload.matches.length, 1);
        assert.equal(searchPayload.matches[0].provider, 'AniList');
        assert.equal(searchPayload.matches[0].title, 'Solo Leveling');
        assert.equal(searchPayload.matches[0].summary, 'Hunters climb the tower.');
        assert.equal(searchPayload.matches[0].aniListId, 151807);
        assert.equal(searchPayload.matches[0].malId, 3000);
        assert.equal(searchPayload.matches[0].coverImageUrl, 'https://covers.example/solo-leveling.jpg');
        assert.equal(searchPayload.matches[0].score, 98);

        const applyResponse = await fetch(`${baseUrl}/api/portal/kavita/title-match/apply`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({seriesId: 17, aniListId: 151807}),
        });
        const applyPayload = await applyResponse.json();
        assert.equal(applyResponse.status, 200);
        assert.equal(applyPayload.success, true);
        assert.deepEqual(calls, [
            {type: 'search', seriesId: 17, query: 'Solo Leveling'},
            {type: 'apply', payload: {seriesId: 17, aniListId: 151807, malId: undefined, cbrId: undefined}},
        ]);
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/title-match/apply syncs the Noona cover art to Kavita', async () => {
    const calls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            port: 3003,
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            applySeriesMetadataMatch: async (payload) => {
                calls.push({type: 'apply', payload});
                return {ok: true};
            },
            setSeriesCover: async (payload) => {
                calls.push({type: 'cover', payload});
                return {ok: true};
            },
        },
        raven: {
            getTitle: async (uuid) => {
                calls.push({type: 'title', uuid});
                return {
                    uuid,
                    coverUrl: 'https://covers.example/solo-leveling.jpg',
                };
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/title-match/apply`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({seriesId: 17, aniListId: 151807, titleUuid: 'title-1'}),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.coverSync.status, 'applied');
        assert.equal(payload.coverSync.url, 'http://noona-portal:3003/api/portal/kavita/title-cover/title-1');
        assert.deepEqual(calls, [
            {type: 'apply', payload: {seriesId: 17, aniListId: 151807, malId: undefined, cbrId: undefined}},
            {type: 'title', uuid: 'title-1'},
            {
                type: 'cover',
                payload: {
                    seriesId: 17,
                    url: 'http://noona-portal:3003/api/portal/kavita/title-cover/title-1',
                    lockCover: true,
                },
            },
        ]);
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/title-match/apply backfills a missing Raven cover from the selected metadata match', async () => {
    const calls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            port: 3003,
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            applySeriesMetadataMatch: async (payload) => {
                calls.push({type: 'apply', payload});
                return {ok: true};
            },
            setSeriesCover: async (payload) => {
                calls.push({type: 'cover', payload});
                return {ok: true};
            },
        },
        raven: {
            getTitle: async (uuid) => {
                calls.push({type: 'title', uuid});
                return {
                    uuid,
                    coverUrl: null,
                };
            },
            updateTitle: async (uuid, payload) => {
                calls.push({type: 'update-title', uuid, payload});
                return {
                    uuid,
                    coverUrl: payload.coverUrl,
                };
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/title-match/apply`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                seriesId: 17,
                aniListId: 151807,
                titleUuid: 'title-1',
                coverImageUrl: 'https://covers.example/solo-leveling.jpg',
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.coverSync.status, 'applied');
        assert.equal(payload.coverSync.backfilledNoonaCover, true);
        assert.equal(payload.coverSync.usedDirectFallback, false);
        assert.equal(payload.coverSync.url, 'http://noona-portal:3003/api/portal/kavita/title-cover/title-1');
        assert.deepEqual(calls, [
            {type: 'apply', payload: {seriesId: 17, aniListId: 151807, malId: undefined, cbrId: undefined}},
            {type: 'title', uuid: 'title-1'},
            {
                type: 'update-title',
                uuid: 'title-1',
                payload: {
                    coverUrl: 'https://covers.example/solo-leveling.jpg',
                },
            },
            {
                type: 'cover',
                payload: {
                    seriesId: 17,
                    url: 'http://noona-portal:3003/api/portal/kavita/title-cover/title-1',
                    lockCover: true,
                },
            },
        ]);
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/title-match/apply stores a Raven volume map when provider metadata is confirmed', async () => {
    const calls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            port: 3003,
            discord: {
                guildId: 'guild-1',
            },
        },
        kavita: {
            setSeriesCover: async (payload) => {
                calls.push({type: 'cover', payload});
                return {ok: true};
            },
        },
        komf: {
            identifySeriesMetadata: async (payload) => {
                calls.push({type: 'identify', payload});
                return {ok: true};
            },
            getSeriesMetadataDetails: async (payload) => {
                calls.push({type: 'series-details', payload});
                return {
                    provider: 'MANGA_UPDATES',
                    providerSeriesId: '15180124327',
                    books: [
                        {
                            providerBookId: 'book-1',
                            volumeNumber: 1,
                            startChapter: 1,
                            endChapter: 2,
                        },
                        {
                            providerBookId: 'book-2',
                            volumeNumber: 2,
                            chapters: [3, 4],
                        },
                    ],
                };
            },
        },
        raven: {
            getTitle: async (uuid) => {
                calls.push({type: 'title', uuid});
                return {
                    uuid,
                    coverUrl: 'https://covers.example/solo-leveling.jpg',
                };
            },
            applyTitleVolumeMap: async (uuid, payload) => {
                calls.push({type: 'volume-map', uuid, payload});
                return {
                    title: {uuid},
                    renameSummary: {
                        attempted: true,
                        renamed: 1,
                        skippedCollisions: 0,
                        alreadyMatched: 0,
                    },
                };
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/title-match/apply`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                seriesId: 17,
                libraryId: 4,
                titleUuid: 'title-1',
                provider: 'MANGA_UPDATES',
                providerSeriesId: '15180124327',
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.volumeMap?.status, 'applied');
        assert.equal(payload.volumeMap?.mappedChapterCount, 4);
        assert.equal(payload.volumeMap?.renameSummary?.renamed, 1);
        assert.match(payload.message, /Stored the Raven volume map/i);
        assert.deepEqual(calls, [
            {
                type: 'identify',
                payload: {
                    seriesId: 17,
                    libraryId: 4,
                    provider: 'MANGA_UPDATES',
                    providerSeriesId: '15180124327',
                },
            },
            {type: 'title', uuid: 'title-1'},
            {
                type: 'cover',
                payload: {
                    seriesId: 17,
                    url: 'http://noona-portal:3003/api/portal/kavita/title-cover/title-1',
                    lockCover: true,
                },
            },
            {
                type: 'series-details',
                payload: {
                    provider: 'MANGA_UPDATES',
                    providerSeriesId: '15180124327',
                    libraryId: 4,
                },
            },
            {
                type: 'volume-map',
                uuid: 'title-1',
                payload: {
                    provider: 'MANGA_UPDATES',
                    providerSeriesId: '15180124327',
                    chapterVolumeMap: {'1': 1, '2': 1, '3': 2, '4': 2},
                    autoRename: true,
                },
            },
        ]);
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/raven/title-volume-map derives chapter-to-volume coverage and forwards it to Raven', async () => {
    const calls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        komf: {
            getSeriesMetadataDetails: async (payload) => {
                calls.push({type: 'series-details', payload});
                return {
                    provider: 'MANGA_UPDATES',
                    providerSeriesId: '15180124327',
                    books: [
                        {
                            providerBookId: 'book-1',
                            volumeNumber: 1,
                            startChapter: 1,
                            endChapter: 2,
                        },
                        {
                            providerBookId: 'book-2',
                            volumeNumber: 2,
                            chapters: [3, 4],
                        },
                        {
                            providerBookId: 'book-ambiguous-a',
                            volumeNumber: 3,
                            chapters: [5],
                        },
                        {
                            providerBookId: 'book-ambiguous-b',
                            volumeNumber: 4,
                            chapters: [5],
                        },
                    ],
                };
            },
        },
        raven: {
            applyTitleVolumeMap: async (uuid, payload) => {
                calls.push({type: 'volume-map', uuid, payload});
                return {
                    title: {uuid},
                    renameSummary: {
                        attempted: true,
                        renamed: 2,
                        skippedCollisions: 0,
                        alreadyMatched: 0,
                    },
                };
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/raven/title-volume-map`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                titleUuid: 'title-1',
                provider: 'MANGA_UPDATES',
                providerSeriesId: '15180124327',
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.ok, true);
        assert.equal(payload.status, 'applied');
        assert.equal(payload.mappedChapterCount, 4);
        assert.equal(payload.renameSummary?.renamed, 2);
        assert.match(payload.message, /renamed 2 existing files/i);
        assert.deepEqual(calls, [
            {
                type: 'series-details',
                payload: {
                    provider: 'MANGA_UPDATES',
                    providerSeriesId: '15180124327',
                    libraryId: null,
                },
            },
            {
                type: 'volume-map',
                uuid: 'title-1',
                payload: {
                    provider: 'MANGA_UPDATES',
                    providerSeriesId: '15180124327',
                    chapterVolumeMap: {'1': 1, '2': 1, '3': 2, '4': 2},
                    autoRename: true,
                },
            },
        ]);
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/raven/title-volume-map returns no-op when Komf has no usable chapter coverage', async () => {
    const calls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        komf: {
            getSeriesMetadataDetails: async (payload) => {
                calls.push({type: 'series-details', payload});
                return {
                    provider: 'MANGA_UPDATES',
                    providerSeriesId: '15180124327',
                    books: [
                        {
                            providerBookId: 'book-range-only',
                            volumeRangeStart: 1,
                            volumeRangeEnd: 2,
                        },
                        {
                            providerBookId: 'book-no-coverage',
                            volumeNumber: 3,
                        },
                    ],
                };
            },
        },
        raven: {
            applyTitleVolumeMap: async (uuid, payload) => {
                calls.push({type: 'volume-map', uuid, payload});
                return {
                    title: {uuid},
                    renameSummary: {
                        attempted: true,
                        renamed: 0,
                        skippedCollisions: 0,
                        alreadyMatched: 0,
                    },
                };
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/raven/title-volume-map`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                titleUuid: 'title-1',
                provider: 'MANGA_UPDATES',
                providerSeriesId: '15180124327',
                autoRename: false,
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.ok, true);
        assert.equal(payload.status, 'no-op');
        assert.equal(payload.mappedChapterCount, 0);
        assert.equal(payload.renameSummary, null);
        assert.match(payload.message, /kept fallback v01/i);
        assert.deepEqual(calls, [
            {
                type: 'series-details',
                payload: {
                    provider: 'MANGA_UPDATES',
                    providerSeriesId: '15180124327',
                    libraryId: null,
                },
            },
            {
                type: 'volume-map',
                uuid: 'title-1',
                payload: {
                    provider: 'MANGA_UPDATES',
                    providerSeriesId: '15180124327',
                    chapterVolumeMap: {},
                    autoRename: false,
                },
            },
        ]);
    } finally {
        await stopServer(server);
    }
});

test('GET /api/portal/kavita/title-cover proxies the stored Noona cover art', async () => {
    const upstreamCalls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        raven: {
            getTitle: async (uuid) => ({
                uuid,
                coverUrl: 'https://covers.example/solo-leveling.jpg',
            }),
        },
        fetchImpl: async (url, options) => {
            upstreamCalls.push({url, options});
            return new Response('image-bytes', {
                status: 200,
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'public, max-age=123',
                },
            });
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/title-cover/title-1`);
        const payload = Buffer.from(await response.arrayBuffer()).toString();

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/jpeg');
        assert.equal(response.headers.get('cache-control'), 'public, max-age=123');
        assert.equal(payload, 'image-bytes');
        assert.equal(upstreamCalls.length, 1);
        assert.equal(upstreamCalls[0].url, 'https://covers.example/solo-leveling.jpg');
        assert.equal(upstreamCalls[0].options.method, 'GET');
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/title-match uses Komf metadata search and normalizes provider ids', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        komf: {
            searchSeriesMetadata: async (query, options) => {
                assert.equal(query, 'Solo Leveling');
                assert.deepEqual(options, {seriesId: 17});
                return [
                    {
                        title: 'Solo Leveling',
                        provider: 'MANGA_UPDATES',
                        resultId: '15180124327',
                        alternateTitles: ['Only I Level Up', 'Na Honjaman Level Up'],
                        imageUrl: 'https://covers.example/solo-leveling.jpg',
                        url: 'https://www.mangaupdates.com/series/6z1uqw7/solo-leveling',
                        'Adult Content': 'yes',
                    },
                ];
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/title-match`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({seriesId: 17, query: 'Solo Leveling'}),
        });
        const payload = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(payload, {
            seriesId: 17,
            matches: [
                {
                    provider: 'MANGA_UPDATES',
                    title: 'Solo Leveling',
                    aliases: ['Only I Level Up', 'Na Honjaman Level Up'],
                    summary: null,
                    score: null,
                    coverImageUrl: 'https://covers.example/solo-leveling.jpg',
                    sourceUrl: 'https://www.mangaupdates.com/series/6z1uqw7/solo-leveling',
                    providerSeriesId: '15180124327',
                    aniListId: null,
                    malId: null,
                    cbrId: null,
                    adultContent: true,
                },
            ],
        });
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/title-match/search exposes adult-content flags from Komf metadata tags', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        komf: {
            searchSeriesMetadata: async (query) => {
                assert.equal(query, 'Ore no Level Up ga Okashii!');
                return [
                    {
                        title: 'Ore no Level Up ga Okashii!',
                        provider: 'MANGA_UPDATES',
                        resultId: 'mu-777',
                        aliases: ['Only I Level Up'],
                        tags: {
                            'Adult Content': 'yes',
                        },
                    },
                ];
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/title-match/search`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({query: 'Ore no Level Up ga Okashii!'}),
        });
        const payload = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(payload, {
            query: 'Ore no Level Up ga Okashii!',
            matches: [
                {
                    provider: 'MANGA_UPDATES',
                    title: 'Ore no Level Up ga Okashii!',
                    aliases: ['Only I Level Up'],
                    summary: null,
                    score: null,
                    coverImageUrl: null,
                    sourceUrl: null,
                    providerSeriesId: 'mu-777',
                    aniListId: null,
                    malId: null,
                    cbrId: null,
                    adultContent: true,
                },
            ],
        });
    } finally {
        await stopServer(server);
    }
});

test('POST /api/portal/kavita/title-match/apply uses Komf identify before syncing Kavita cover art', async () => {
    const identifyCalls = [];
    const coverCalls = [];
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            port: 3003,
            discord: {
                guildId: 'guild-1',
            },
        },
        komf: {
            identifySeriesMetadata: async (payload) => {
                identifyCalls.push(payload);
                return {jobId: 'job-123'};
            },
        },
        raven: {
            getTitle: async (uuid) => ({
                uuid,
                coverUrl: 'https://covers.example/solo-leveling.jpg',
            }),
        },
        kavita: {
            setSeriesCover: async (payload) => {
                coverCalls.push(payload);
                return {ok: true};
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/portal/kavita/title-match/apply`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                seriesId: 17,
                libraryId: 9,
                provider: 'MANGADEX',
                providerSeriesId: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0',
                titleUuid: 'title-1',
            }),
        });
        const payload = await response.json();

        assert.equal(response.status, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.seriesId, 17);
        assert.equal(payload.result.jobId, 'job-123');
        assert.equal(payload.coverSync.status, 'applied');
        assert.deepEqual(identifyCalls, [{
            seriesId: 17,
            libraryId: 9,
            provider: 'MANGADEX',
            providerSeriesId: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0',
        }]);
        assert.deepEqual(coverCalls, [{
            seriesId: 17,
            url: 'http://noona-portal:3003/api/portal/kavita/title-cover/title-1',
            lockCover: true,
        }]);
    } finally {
        await stopServer(server);
    }
});

test('metadata match routes return compact operator guidance when Komf fails server-side', async () => {
    const app = createPortalApp({
        config: {
            serviceName: 'noona-portal',
            discord: {
                guildId: 'guild-1',
            },
        },
        komf: {
            searchSeriesMetadata: async () => {
                throw buildUpstreamError('Komf request failed with status 500', {
                    details: {message: 'IllegalStateException', stack: 'very large upstream payload'},
                });
            },
            identifySeriesMetadata: async () => {
                throw buildUpstreamError('Komf request failed with status 500', {
                    details: {message: 'IllegalStateException', stack: 'very large upstream payload'},
                });
            },
        },
    });
    const {server, baseUrl} = await startServer(app);

    try {
        const lookupResponse = await fetch(`${baseUrl}/api/portal/kavita/title-match`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({seriesId: 17, query: 'Solo Leveling'}),
        });
        const lookupPayload = await lookupResponse.json();
        assert.equal(lookupResponse.status, 500);
        assert.match(lookupPayload.error, /Check Komf \/config\/application\.yml metadataProviders/);
        assert.match(lookupPayload.error, /restart noona-komf/);
        assert.equal(lookupPayload.details, null);

        const applyResponse = await fetch(`${baseUrl}/api/portal/kavita/title-match/apply`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                seriesId: 17,
                provider: 'MANGADEX',
                providerSeriesId: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0',
            }),
        });
        const applyPayload = await applyResponse.json();
        assert.equal(applyResponse.status, 500);
        assert.match(applyPayload.error, /restart noona-komf/);
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
