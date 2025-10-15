// services/sage/tests/sageApp.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'

import { ChannelType, GatewayIntentBits } from 'discord.js'

import {
    SetupValidationError,
    createSageApp,
    normalizeServiceInstallPayload,
    startSage,
} from '../shared/sageApp.mjs'
import { createDefaultWizardState } from '../shared/wizardStateSchema.mjs'
import { createDiscordSetupClient } from '../shared/discordSetupClient.mjs'

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

const createRavenStub = (overrides = {}) => ({
    async getLibrary() {
        throw new Error('getLibrary should not be called')
    },
    async searchTitle() {
        throw new Error('searchTitle should not be called')
    },
    async queueDownload() {
        throw new Error('queueDownload should not be called')
    },
    async getDownloadStatus() {
        throw new Error('getDownloadStatus should not be called')
    },
    ...overrides,
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

test('GET /api/setup/wizard/state returns state from client', async (t) => {
    const wizardState = createDefaultWizardState()
    const calls = []
    const app = createSageApp({
        wizardStateClient: {
            async loadState() {
                calls.push('load')
                return wizardState
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/wizard/state`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), wizardState)
    assert.deepEqual(calls, ['load'])
})

test('PUT /api/setup/wizard/state applies updates through client', async (t) => {
    const nextState = createDefaultWizardState()
    nextState.foundation = { ...nextState.foundation, status: 'complete' }
    const updates = []
    const app = createSageApp({
        wizardStateClient: {
            async applyUpdates(changeSet) {
                updates.push(changeSet)
                return { state: nextState, changed: true }
            },
            async writeState() {
                throw new Error('writeState should not be called')
            },
            async loadState() {
                return createDefaultWizardState()
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/wizard/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ step: 'foundation', status: 'complete' }] }),
    })

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.foundation.status, 'complete')
    assert.equal(updates.length, 1)
    assert.deepEqual(updates[0], [{ step: 'foundation', status: 'complete' }])
})

test('PUT /api/setup/wizard/state validates payload', async (t) => {
    const app = createSageApp({
        wizardStateClient: {
            async loadState() {
                return createDefaultWizardState()
            },
            async applyUpdates() {
                throw new Error('applyUpdates should not be called')
            },
            async writeState() {
                throw new Error('writeState should not be called')
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/wizard/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [] }),
    })

    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.ok(typeof payload?.error === 'string' && payload.error.length > 0)
})

test('GET /api/setup/verification/status returns wizard summary and health', async (t) => {
    const wizardState = createDefaultWizardState()
    wizardState.verification.detail = JSON.stringify({
        lastRunAt: '2024-01-01T00:00:00.000Z',
        checks: [{ service: 'noona-vault', success: true, supported: true }],
    })

    const healthCalls = []
    const app = createSageApp({
        setupClient: {
            async getServiceHealth(name) {
                healthCalls.push(name)
                return { status: 'healthy', detail: `${name} ok` }
            },
            async listServices() {
                return []
            },
            async installServices() {
                return []
            },
        },
        wizardStateClient: {
            async loadState() {
                return wizardState
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/verification/status`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload.wizard, wizardState)
    assert.equal(payload.summary.checks.length, 1)
    assert.equal(payload.summary.checks[0].service, 'noona-vault')
    assert.deepEqual(healthCalls.sort(), ['noona-sage', 'noona-warden'])
})

test('POST /api/setup/verification/checks runs service tests and updates wizard state', async (t) => {
    const wizardState = createDefaultWizardState()
    const updatesApplied = []
    const testCalls = []

    const app = createSageApp({
        setupClient: {
            async testService(name) {
                testCalls.push(name)
                return { status: 200, result: { success: true, supported: true } }
            },
            async getServiceHealth() {
                return { status: 'healthy', detail: 'ok' }
            },
            async listServices() {
                return []
            },
            async installServices() {
                return []
            },
        },
        wizardStateClient: {
            async applyUpdates(updates = []) {
                updatesApplied.push(updates)
                for (const update of updates) {
                    if (update.step === 'verification') {
                        if (update.status) {
                            wizardState.verification.status = update.status
                        }
                        if (Object.prototype.hasOwnProperty.call(update, 'detail')) {
                            wizardState.verification.detail = update.detail
                        }
                        if (Object.prototype.hasOwnProperty.call(update, 'error')) {
                            wizardState.verification.error = update.error
                        }
                        if (Object.prototype.hasOwnProperty.call(update, 'updatedAt')) {
                            wizardState.verification.updatedAt = update.updatedAt
                        }
                        if (Object.prototype.hasOwnProperty.call(update, 'completedAt')) {
                            wizardState.verification.completedAt = update.completedAt
                        }
                    }
                }
                return { state: wizardState }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/verification/checks`, { method: 'POST' })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.ok(Array.isArray(payload.summary.checks))
    assert.equal(payload.summary.checks.length, 5)
    assert.equal(new Set(testCalls).size, 5)
    assert.equal(wizardState.verification.status, 'complete')
    assert.ok(updatesApplied.length >= 2)
})

test('POST /api/setup/wizard/complete persists completion flag', async (t) => {
    const wizardState = createDefaultWizardState()
    wizardState.verification.status = 'complete'
    wizardState.verification.detail = JSON.stringify({
        lastRunAt: '2024-01-01T00:00:00.000Z',
        checks: [
            { service: 'noona-vault', success: true, supported: true },
            { service: 'noona-portal', success: true, supported: true },
        ],
    })

    const writes = []
    const app = createSageApp({
        setupClient: {
            async getServiceHealth() {
                return { status: 'healthy', detail: 'ok' }
            },
            async listServices() {
                return []
            },
            async installServices() {
                return []
            },
        },
        wizardStateClient: {
            async loadState() {
                return wizardState
            },
            async writeState(next) {
                writes.push(next)
                return next
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/wizard/complete`, { method: 'POST' })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.wizard.completed, true)
    assert.ok(writes.length >= 1)
})

test('createDiscordSetupClient uses limited intents during validation', async () => {
    const createdOptions = []
    const loginCalls = []
    const destroyCalls = []

    const guildStub = {
        id: 'guild-123',
        name: 'Guild Name',
        description: null,
        icon: null,
        roles: { async fetch() { return [] } },
        channels: { async fetch() { return [] } },
    }

    const setupClient = createDiscordSetupClient({
        serviceName: 'test-sage',
        logger: {
            error: () => {},
            info: () => {},
        },
        createClient(options) {
            createdOptions.push(options)
            return {
                async login() {
                    loginCalls.push(true)
                },
                destroy() {
                    destroyCalls.push(true)
                },
                async fetchGuild() {
                    return guildStub
                },
            }
        },
    })

    await setupClient.fetchResources({ token: 'token', guildId: 'guild-123' })

    assert.equal(createdOptions.length, 1)
    assert.equal(loginCalls.length, 1)
    assert.equal(destroyCalls.length, 1)
    assert.deepEqual(createdOptions[0].intents, [GatewayIntentBits.Guilds])
    assert.deepEqual(createdOptions[0].partials, [])
})

test('createDiscordSetupClient maps invalid Discord tokens to validation errors', async () => {
    const destroyCalls = []

    const setupClient = createDiscordSetupClient({
        serviceName: 'test-sage',
        logger: { error: () => {}, info: () => {} },
        createClient() {
            return {
                async login() {
                    const error = new Error('An invalid token was provided.')
                    error.code = 'TokenInvalid'
                    throw error
                },
                destroy() {
                    destroyCalls.push(true)
                },
            }
        },
    })

    await assert.rejects(
        () => setupClient.fetchResources({ token: 'bad-token', guildId: 'guild-123' }),
        (error) => {
            assert.ok(error instanceof SetupValidationError)
            assert.match(error.message, /Discord rejected the provided bot token/i)
            return true
        },
    )

    assert.equal(destroyCalls.length, 1)
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

test('GET /api/setup/services/install/progress proxies progress summary', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return { status: 200, results: [] }
            },
            async getInstallProgress() {
                return { status: 'installing', percent: 25, items: [{ name: 'noona-sage', status: 'installing' }] }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/install/progress`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
        status: 'installing',
        percent: 25,
        items: [{ name: 'noona-sage', status: 'installing' }],
    })
})

test('GET /api/setup/services/installation/logs proxies installation history', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return { status: 200, results: [] }
            },
            async getInstallProgress() {
                return { items: [], status: 'idle', percent: null }
            },
            async getInstallationLogs(options) {
                calls.push(options)
                return {
                    service: 'installation',
                    entries: [{ message: 'Starting installation' }],
                    summary: { status: 'installing', percent: 10, detail: null, updatedAt: 'now' },
                }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/installation/logs?limit=5`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
        service: 'installation',
        entries: [{ message: 'Starting installation' }],
        summary: { status: 'installing', percent: 10, detail: null, updatedAt: 'now' },
    })
    assert.deepEqual(calls, [{ limit: '5' }])
})

test('GET /api/setup/services/installation/logs surfaces setup errors', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return { status: 200, results: [] }
            },
            async getInstallProgress() {
                return { items: [], status: 'idle', percent: null }
            },
            async getInstallationLogs() {
                throw new Error('boom')
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/installation/logs`)
    assert.equal(response.status, 502)
    const payload = await response.json()
    assert.ok(payload.error.includes('installation logs'))
})

test('GET /api/setup/services/:name/logs proxies history and honours limit', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return { status: 200, results: [] }
            },
            async getServiceLogs(name, options) {
                calls.push([name, options])
                return {
                    service: name,
                    entries: [{ type: 'status', status: 'ready', message: 'Ready' }],
                    summary: { status: 'ready', percent: null, detail: null, updatedAt: 'now' },
                }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/noona-sage/logs?limit=5`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
        service: 'noona-sage',
        entries: [{ type: 'status', status: 'ready', message: 'Ready' }],
        summary: { status: 'ready', percent: null, detail: null, updatedAt: 'now' },
    })
    assert.deepEqual(calls, [['noona-sage', { limit: '5' }]])
})

test('GET /api/raven/library proxies Raven library listings', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async getLibrary() {
                calls.push('library')
                return [{ title: 'One Piece' }]
            },
        }),
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/library`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), [{ title: 'One Piece' }])
    assert.deepEqual(calls, ['library'])
})

test('GET /api/raven/library surfaces Raven errors', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async getLibrary() {
                throw new Error('boom')
            },
        }),
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/library`)
    assert.equal(response.status, 502)
    const payload = await response.json()
    assert.ok(payload.error.includes('Raven library'))
})

test('POST /api/raven/search forwards trimmed query to Raven client', async (t) => {
    const queries = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async searchTitle(query) {
                queries.push(query)
                return { results: [{ title: 'Naruto' }] }
            },
        }),
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '  naruto  ' }),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { results: [{ title: 'Naruto' }] })
    assert.deepEqual(queries, ['naruto'])
})

test('POST /api/raven/search validates missing query payloads', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async searchTitle() {
                throw new Error('searchTitle should not be invoked')
            },
        }),
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '   ' }),
    })

    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.ok(payload.error.includes('Search query is required'))
})

test('POST /api/raven/search surfaces Raven failures', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async searchTitle() {
                throw new Error('boom')
            },
        }),
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'naruto' }),
    })

    assert.equal(response.status, 502)
    const payload = await response.json()
    assert.ok(payload.error.includes('Unable to search Raven library'))
})

test('POST /api/raven/download queues downloads via Raven client', async (t) => {
    const payloads = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async queueDownload(payload) {
                payloads.push(payload)
                return { status: 'queued' }
            },
        }),
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchId: 'search-123', optionIndex: 2 }),
    })

    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), { result: { status: 'queued' } })
    assert.deepEqual(payloads, [{ searchId: 'search-123', optionIndex: 2 }])
})

test('POST /api/raven/download rejects invalid payloads', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async queueDownload() {
                throw new Error('queueDownload should not run')
            },
        }),
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const missingId = await fetch(`${baseUrl}/api/raven/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionIndex: 1 }),
    })
    assert.equal(missingId.status, 400)
    const missingIdPayload = await missingId.json()
    assert.ok(missingIdPayload.error.includes('searchId'))

    const missingIndex = await fetch(`${baseUrl}/api/raven/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchId: 'search-123' }),
    })
    assert.equal(missingIndex.status, 400)
    const missingIndexPayload = await missingIndex.json()
    assert.ok(missingIndexPayload.error.includes('optionIndex'))
})

test('POST /api/raven/download surfaces Raven failures', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async queueDownload() {
                throw new Error('boom')
            },
        }),
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchId: 'abc', optionIndex: 1 }),
    })

    assert.equal(response.status, 502)
    const payload = await response.json()
    assert.ok(payload.error.includes('Unable to queue Raven download'))
})

test('GET /api/raven/downloads/status proxies Raven status feed', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async getDownloadStatus() {
                return { downloads: [{ id: 'one-piece', state: 'completed' }] }
            },
        }),
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/downloads/status`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { downloads: [{ id: 'one-piece', state: 'completed' }] })
})

test('GET /api/raven/downloads/status surfaces Raven failures', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async getDownloadStatus() {
                throw new Error('boom')
            },
        }),
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/downloads/status`)
    assert.equal(response.status, 502)
    const payload = await response.json()
    assert.ok(payload.error.includes('Unable to retrieve Raven download status'))
})

test('POST /api/setup/services/:name/test proxies to setup client', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return { status: 200, results: [] }
            },
            async testService(name, body) {
                calls.push([name, body])
                return { status: 200, result: { service: name, success: true } }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/noona-portal/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GET' }),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { service: 'noona-portal', success: true })
    assert.deepEqual(calls, [['noona-portal', { method: 'GET' }]])
})

test('POST /api/setup/services/:name/test surfaces validation errors', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return { status: 200, results: [] }
            },
            async testService() {
                throw new SetupValidationError('Unsupported service')
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/noona-sage/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    })

    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.equal(payload.error, 'Unsupported service')
})

test('POST /api/setup/services/noona-raven/detect proxies detection result', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return { status: 200, results: [] }
            },
            async detectRavenMount() {
                return { status: 200, detection: { mountPath: '/data' } }
            },
            async getServiceHealth() {
                return { status: 'healthy', detail: 'ok' }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/noona-raven/detect`, { method: 'POST' })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { detection: { mountPath: '/data' } })
})

test('GET /api/setup/services/:name/health proxies health payloads', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return { status: 200, results: [] }
            },
            async getServiceHealth(name) {
                return { status: 'healthy', detail: `ok:${name}` }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/noona-raven/health`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'healthy', detail: 'ok:noona-raven' })
})

test('GET /api/setup/services/:name/health surfaces validation errors', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return { status: 200, results: [] }
            },
            async getServiceHealth() {
                throw new SetupValidationError('Unsupported service for health check')
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/unknown/health`)
    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.equal(payload.error, 'Unsupported service for health check')
})

test('createChannel normalizes channel type when provided as string', async () => {
    const createCalls = []
    const clientStub = {
        async login() {},
        destroy() {},
        async fetchGuild() {
            return {
                id: 'guild-id',
                name: 'Test Guild',
                channels: {
                    create: async (options) => {
                        createCalls.push(options)
                        return {
                            id: 'channel-id',
                            name: options.name,
                            type: ChannelType.GuildText,
                        }
                    },
                },
            }
        },
    }

    const setupClient = createDiscordSetupClient({
        createClient: () => clientStub,
        logger: {
            info() {},
            error() {},
        },
        serviceName: 'test-sage',
    })

    const channel = await setupClient.createChannel({
        token: 'token',
        guildId: 'guild-id',
        name: 'general',
        type: 'GUILD_TEXT',
    })

    assert.equal(createCalls.length, 1)
    assert.equal(createCalls[0].type, ChannelType.GuildText)
    assert.equal(channel.type, ChannelType.GuildText)
})
