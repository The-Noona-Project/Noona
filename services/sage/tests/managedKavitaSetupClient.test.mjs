import assert from 'node:assert/strict'
import test from 'node:test'

import {
    createManagedKavitaServiceAccount,
    createManagedKavitaSetupClient,
} from '../clients/managedKavitaSetupClient.mjs'

test('createManagedKavitaServiceAccount generates a deterministic password when randomBytes is stubbed', () => {
    const account = createManagedKavitaServiceAccount({
        randomBytes: () => Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
    })

    assert.equal(account.username, 'noona-system')
    assert.equal(account.email, 'noona-system@noona.local')
    assert.equal(account.password, Buffer.from('0123456789abcdef0123456789abcdef', 'hex').toString('base64url'))
})

test('ensureServiceApiKey registers the first admin and reuses the seeded OPDS auth key when apiKey is missing', async () => {
    const calls = []
    let loginAttempts = 0
    const client = createManagedKavitaSetupClient({
        baseUrl: 'https://kavita.example',
        fetchImpl: async (url, options) => {
            const requestUrl = new URL(url)
            calls.push({
                pathname: requestUrl.pathname,
                method: options.method,
                body: options.body ? JSON.parse(options.body) : null,
                authorization: options.headers?.Authorization ?? null,
            })

            if (requestUrl.pathname === '/api/Account/register') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 10, username: 'noona-system'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/login') {
                loginAttempts += 1
                if (loginAttempts === 1) {
                    return {
                        ok: false,
                        status: 401,
                        text: async () => JSON.stringify({error: 'Invalid credentials'}),
                    }
                }

                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 10, username: 'noona-system', token: 'jwt-token'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/auth-keys') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify([
                        {id: 7, key: 'seeded-opds-key', name: 'opds'},
                        {id: 8, key: 'image-key', name: 'image-only'},
                    ]),
                }
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`)
        },
        randomBytes: () => Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
    })

    const result = await client.ensureServiceApiKey({allowRegister: true})

    assert.equal(result.apiKey, 'seeded-opds-key')
    assert.equal(result.account.username, 'noona-system')
    assert.deepEqual(calls.map((entry) => entry.pathname), [
        '/api/Account/login',
        '/api/Account/register',
        '/api/Account/login',
        '/api/Account/auth-keys',
    ])
    assert.equal(calls[3].authorization, 'Bearer jwt-token')
    assert.equal(calls[3].body, null)
})

test('ensureServiceApiKey reuses a stored account and returned apiKey without rotating another auth key', async () => {
    const calls = []
    const client = createManagedKavitaSetupClient({
        baseUrl: 'https://kavita.example',
        fetchImpl: async (url, options) => {
            const requestUrl = new URL(url)
            calls.push({
                pathname: requestUrl.pathname,
                method: options.method,
                body: options.body ? JSON.parse(options.body) : null,
            })

            if (requestUrl.pathname === '/api/Account/login') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({
                        id: 11,
                        username: 'noona-system',
                        apiKey: 'existing-api-key',
                    }),
                }
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`)
        },
    })

    const result = await client.ensureServiceApiKey({
        account: {
            username: 'noona-system',
            password: 'super-secret',
            email: 'noona-system@noona.local',
        },
    })

    assert.equal(result.apiKey, 'existing-api-key')
    assert.deepEqual(calls.map((entry) => entry.pathname), ['/api/Account/login'])
})

test('ensureServiceApiKey creates a named auth key when no reusable key exists after login', async () => {
    const calls = []
    const client = createManagedKavitaSetupClient({
        baseUrl: 'https://kavita.example',
        fetchImpl: async (url, options) => {
            const requestUrl = new URL(url)
            calls.push({
                pathname: requestUrl.pathname,
                method: options.method,
                body: options.body ? JSON.parse(options.body) : null,
                authorization: options.headers?.Authorization ?? null,
            })

            if (requestUrl.pathname === '/api/Account/login') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 15, username: 'reader-admin', token: 'jwt-token'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/auth-keys') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify([]),
                }
            }

            if (requestUrl.pathname === '/api/Account/create-auth-key') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 7, key: 'managed-api-key', name: 'Noona Managed Services'}),
                }
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`)
        },
    })

    const result = await client.ensureServiceApiKey({
        account: {
            username: 'reader-admin',
            email: 'reader-admin@example.com',
            password: 'Password123!',
        },
        allowRegister: true,
    })

    assert.equal(result.apiKey, 'managed-api-key')
    assert.equal(result.mode, 'login')
    assert.deepEqual(calls.map((entry) => entry.pathname), [
        '/api/Account/login',
        '/api/Account/auth-keys',
        '/api/Account/create-auth-key',
    ])
    assert.equal(calls[2].authorization, 'Bearer jwt-token')
})

test('ensureServiceApiKey retries login when container bootstrap wins the register race', async () => {
    const calls = []
    const client = createManagedKavitaSetupClient({
        baseUrl: 'https://kavita.example',
        fetchImpl: async (url, options) => {
            const requestUrl = new URL(url)
            calls.push({
                pathname: requestUrl.pathname,
                method: options.method,
                body: options.body ? JSON.parse(options.body) : null,
                authorization: options.headers?.Authorization ?? null,
            })

            if (requestUrl.pathname === '/api/Account/login' && calls.filter((entry) => entry.pathname === '/api/Account/login').length === 1) {
                return {
                    ok: false,
                    status: 401,
                    text: async () => JSON.stringify({error: 'Invalid credentials'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/register') {
                return {
                    ok: false,
                    status: 400,
                    text: async () => JSON.stringify({error: 'Denied'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/login') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 15, username: 'reader-admin', token: 'jwt-token'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/auth-keys') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify([
                        {id: 7, key: 'managed-api-key', name: 'Noona Managed Services'},
                    ]),
                }
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`)
        },
    })

    const result = await client.ensureServiceApiKey({
        account: {
            username: 'reader-admin',
            email: 'reader-admin@example.com',
            password: 'Password123!',
        },
        allowRegister: true,
    })

    assert.equal(result.apiKey, 'managed-api-key')
    assert.equal(result.mode, 'login')
    assert.deepEqual(calls.map((entry) => entry.pathname), [
        '/api/Account/login',
        '/api/Account/register',
        '/api/Account/login',
        '/api/Account/auth-keys',
    ])
    assert.equal(calls[3].authorization, 'Bearer jwt-token')
})

test('ensureServiceApiKey retries the full first-user flow when registration fails before the account exists', async () => {
    const calls = []
    let loginAttempts = 0
    let registerAttempts = 0
    const client = createManagedKavitaSetupClient({
        baseUrl: 'https://kavita.example',
        fetchImpl: async (url, options) => {
            const requestUrl = new URL(url)
            calls.push({
                pathname: requestUrl.pathname,
                method: options.method,
                body: options.body ? JSON.parse(options.body) : null,
                authorization: options.headers?.Authorization ?? null,
            })

            if (requestUrl.pathname === '/api/Account/login') {
                loginAttempts += 1
                if (loginAttempts <= 2) {
                    return {
                        ok: false,
                        status: 401,
                        text: async () => JSON.stringify({error: 'Invalid credentials'}),
                    }
                }

                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 15, username: 'reader-admin', token: 'jwt-token'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/register') {
                registerAttempts += 1
                if (registerAttempts === 1) {
                    return {
                        ok: false,
                        status: 400,
                        text: async () => JSON.stringify({error: 'An error occurred while saving the entity changes.'}),
                    }
                }

                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 15, username: 'reader-admin'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/auth-keys') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify([
                        {id: 7, key: 'managed-api-key', name: 'Noona Managed Services'},
                    ]),
                }
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`)
        },
    })

    const result = await client.ensureServiceApiKey({
        account: {
            username: 'reader-admin',
            email: 'reader-admin@example.com',
            password: 'Password123!',
        },
        allowRegister: true,
    })

    assert.equal(result.apiKey, 'managed-api-key')
    assert.deepEqual(calls.map((entry) => entry.pathname), [
        '/api/Account/login',
        '/api/Account/register',
        '/api/Account/login',
        '/api/Account/register',
        '/api/Account/login',
        '/api/Account/auth-keys',
    ])
    assert.equal(calls.at(-1).authorization, 'Bearer jwt-token')
})

test('ensureServiceApiKey retries transient 5xx registration failures before the first account exists', async () => {
    const calls = []
    let loginAttempts = 0
    let registerAttempts = 0
    const client = createManagedKavitaSetupClient({
        baseUrl: 'https://kavita.example',
        fetchImpl: async (url, options) => {
            const requestUrl = new URL(url)
            calls.push({
                pathname: requestUrl.pathname,
                method: options.method,
                body: options.body ? JSON.parse(options.body) : null,
                authorization: options.headers?.Authorization ?? null,
            })

            if (requestUrl.pathname === '/api/Account/login') {
                loginAttempts += 1
                if (loginAttempts <= 2) {
                    return {
                        ok: false,
                        status: 401,
                        text: async () => JSON.stringify({error: 'Invalid credentials'}),
                    }
                }

                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 15, username: 'reader-admin', token: 'jwt-token'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/register') {
                registerAttempts += 1
                if (registerAttempts === 1) {
                    return {
                        ok: false,
                        status: 500,
                        text: async () => JSON.stringify({error: 'An error occurred while saving the entity changes.'}),
                    }
                }

                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 15, username: 'reader-admin'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/auth-keys') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify([
                        {id: 7, key: 'managed-api-key', name: 'Noona Managed Services'},
                    ]),
                }
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`)
        },
    })

    const result = await client.ensureServiceApiKey({
        account: {
            username: 'reader-admin',
            email: 'reader-admin@example.com',
            password: 'Password123!',
        },
        allowRegister: true,
    })

    assert.equal(result.apiKey, 'managed-api-key')
    assert.deepEqual(calls.map((entry) => entry.pathname), [
        '/api/Account/login',
        '/api/Account/register',
        '/api/Account/login',
        '/api/Account/register',
        '/api/Account/login',
        '/api/Account/auth-keys',
    ])
    assert.equal(calls.at(-1).authorization, 'Bearer jwt-token')
})
