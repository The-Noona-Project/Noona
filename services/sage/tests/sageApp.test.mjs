// services/sage/tests/sageApp.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'

import {
    SetupValidationError,
    createSageApp,
    normalizeServiceInstallPayload,
    startSage,
} from '../shared/sageApp.mjs'

const listen = (app) => new Promise((resolve) => {
    const server = app.listen(0, () => {
        const address = server.address()
        if (!address || typeof address !== 'object') {
            throw new Error('Expected numeric address info')
        }

        const port = address.port
        resolve({
            server,
            baseUrl: `http://127.0.0.1:${port}`,
        })
    })
})

const closeServer = (server) => new Promise((resolve, reject) => {
    server.close((error) => {
        if (error) {
            reject(error)
        } else {
            resolve()
        }
    })
})

test('normalizeServiceInstallPayload normalizes entries and trims values', () => {
    const payload = normalizeServiceInstallPayload([
        '  noona-sage  ',
        { name: 'noona-moon', env: { DEBUG: true, ' EXTRA ': 'value', EMPTY: null } },
    ])

    assert.deepEqual(payload, [
        { name: 'noona-sage' },
        { name: 'noona-moon', env: { DEBUG: 'true', EXTRA: 'value', EMPTY: '' } },
    ])
})

test('normalizeServiceInstallPayload rejects invalid payloads', () => {
    assert.throws(() => normalizeServiceInstallPayload([]), SetupValidationError)
    assert.throws(() => normalizeServiceInstallPayload(['   ']), SetupValidationError)
    assert.throws(
        () => normalizeServiceInstallPayload([{ name: 'noona-sage', env: 'boom' }]),
        SetupValidationError,
    )
    assert.throws(
        () => normalizeServiceInstallPayload([{ name: '', env: {} }]),
        SetupValidationError,
    )
})

test('GET /health responds with success message', async (t) => {
    const debugMessages = []
    const app = createSageApp({
        serviceName: 'test-sage',
        logger: {
            debug: (message) => debugMessages.push(message),
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/health`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'Sage is live!')
    assert.ok(debugMessages.some((line) => line.includes('Healthcheck OK')))
})

test('GET /api/pages returns static page definitions', async (t) => {
    const debugMessages = []
    const app = createSageApp({
        serviceName: 'test-sage',
        logger: {
            debug: (message) => debugMessages.push(message),
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/pages`)
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.deepEqual(payload, [
        { name: 'Setup', path: '/setup' },
        { name: 'Dashboard', path: '/dashboard' },
    ])
    assert.ok(debugMessages.some((line) => line.includes('Serving 2 static page entries')))
})

test('startSage starts server on provided port and logs startup message', async (t) => {
    const infoMessages = []
    const debugMessages = []

    const { server } = startSage({
        port: 0,
        serviceName: 'test-sage',
        logger: {
            debug: (message) => debugMessages.push(message),
            info: (message) => infoMessages.push(message),
        },
    })

    t.after(() => closeServer(server))
    await once(server, 'listening')

    const address = server.address()
    if (!address || typeof address !== 'object') {
        throw new Error('Expected numeric address info')
    }

    assert.ok(address.port > 0)
    assert.ok(infoMessages.some((line) => line.includes('test-sage')))
    assert.equal(debugMessages.length, 0)
})

test('GET /api/setup/services proxies to setup client', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                calls.push('list')
                return [{ name: 'noona-moon' }]
            },
            async installServices() {
                throw new Error('installServices should not be called')
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { services: [{ name: 'noona-moon' }] })
    assert.deepEqual(calls, ['list'])
})

test('GET /api/setup/services requests installable set from Warden by default', async (t) => {
    const fetchCalls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setup: {
            baseUrl: 'http://warden.local',
            fetchImpl: async (url) => {
                fetchCalls.push(url)
                return {
                    ok: true,
                    async json() {
                        return { services: [] }
                    },
                }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services`)
    assert.equal(response.status, 200)
    await response.json()

    assert.deepEqual(fetchCalls, ['http://warden.local/api/services?includeInstalled=false'])
})

test('GET /api/setup/services falls back across Warden base URLs', async (t) => {
    const fetchCalls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setup: {
            baseUrl: 'http://unreachable.local:4001',
            baseUrls: ['http://warden-ok.local:4001'],
            fetchImpl: async (url) => {
                fetchCalls.push(url)

                if (url.startsWith('http://unreachable.local:4001')) {
                    return { ok: false, status: 404, async json() { return {} } }
                }

                return {
                    ok: true,
                    async json() {
                        return { services: [{ name: 'noona-moon' }] }
                    },
                }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload.services, [{ name: 'noona-moon' }])

    assert.deepEqual(fetchCalls, [
        'http://unreachable.local:4001/api/services?includeInstalled=false',
        'http://warden-ok.local:4001/api/services?includeInstalled=false',
    ])
})

test('GET /api/setup/services surfaces aggregated failure errors', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setup: {
            baseUrls: ['http://unreachable.local:4001'],
            fetchImpl: async () => {
                throw new Error('boom')
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services`)
    assert.equal(response.status, 502)
    const payload = await response.json()
    assert.ok(payload.error.includes('Unable to retrieve installable services'))
})

test('POST /api/setup/install forwards request to setup client', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices(services) {
                calls.push(services)
                return { status: 207, results: [{ name: 'noona-sage', status: 'installed' }] }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: [{ name: 'noona-sage', env: { DEBUG: 'true' } }] }),
    })

    assert.equal(response.status, 207)
    assert.deepEqual(await response.json(), { results: [{ name: 'noona-sage', status: 'installed' }] })
    assert.deepEqual(calls, [[{ name: 'noona-sage', env: { DEBUG: 'true' } }]])
})

test('POST /api/setup/install validates payload', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices(services) {
                normalizeServiceInstallPayload(services)
                return { status: 200, results: [] }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: [] }),
    })

    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.ok(payload.error.includes('non-empty'))
})

test('setupClient.installServices normalizes payload before forwarding to Warden', async (t) => {
    const bodies = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setup: {
            baseUrl: 'http://warden.local',
            fetchImpl: async (url, options = {}) => {
                bodies.push({ url, body: options.body })
                return {
                    ok: true,
                    status: 200,
                    async json() {
                        return { results: [{ name: 'noona-sage', status: 'installed' }] }
                    },
                }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: ['noona-sage', { name: 'noona-moon', env: { DEBUG: false } }] }),
    })

    assert.equal(response.status, 200)
    await response.json()

    assert.equal(bodies.length, 1)
    assert.equal(bodies[0].url, 'http://warden.local/api/services/install')
    const parsedBody = JSON.parse(bodies[0].body)
    assert.deepEqual(parsedBody.services, [
        { name: 'noona-sage' },
        { name: 'noona-moon', env: { DEBUG: 'false' } },
    ])
})
