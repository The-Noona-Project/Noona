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

test('ensureServiceApiKey registers the first admin and creates a named auth key when apiKey is missing', async () => {
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

            if (requestUrl.pathname === '/api/Account/register') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 10, username: 'noona-system'}),
                }
            }

            if (requestUrl.pathname === '/api/Account/login') {
                return {
                    ok: true,
                    status: 200,
                    text: async () => JSON.stringify({id: 10, username: 'noona-system', token: 'jwt-token'}),
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
        randomBytes: () => Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
    })

    const result = await client.ensureServiceApiKey({allowRegister: true})

    assert.equal(result.apiKey, 'managed-api-key')
    assert.equal(result.account.username, 'noona-system')
    assert.deepEqual(calls.map((entry) => entry.pathname), [
        '/api/Account/register',
        '/api/Account/login',
        '/api/Account/create-auth-key',
    ])
    assert.equal(calls[2].authorization, 'Bearer jwt-token')
    assert.deepEqual(calls[2].body, {
        name: 'Noona Managed Services',
        keyLength: 32,
        expiresUtc: null,
    })
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
