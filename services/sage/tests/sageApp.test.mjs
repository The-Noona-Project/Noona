// services/sage/tests/sageApp.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import crypto from 'node:crypto'

import {ChannelType, GatewayIntentBits} from 'discord.js'

import {createSageApp, normalizeServiceInstallPayload, SetupValidationError, startSage,} from '../app/createSageApp.mjs'
import {
    appendWizardStepHistoryEntries,
    applyWizardStateUpdates,
    createDefaultWizardState,
    DEFAULT_WIZARD_STEP_METADATA,
} from '../wizard/wizardStateSchema.mjs'
import {createDiscordSetupClient} from '../clients/discordSetupClient.mjs'

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
    async checkLibraryForNewChapters() {
        throw new Error('checkLibraryForNewChapters should not be called')
    },
    async getTitle() {
        throw new Error('getTitle should not be called')
    },
    async checkTitleForNewChapters() {
        throw new Error('checkTitleForNewChapters should not be called')
    },
    async createTitle() {
        throw new Error('createTitle should not be called')
    },
    async updateTitle() {
        throw new Error('updateTitle should not be called')
    },
    async deleteTitle() {
        throw new Error('deleteTitle should not be called')
    },
    async listTitleFiles() {
        throw new Error('listTitleFiles should not be called')
    },
    async deleteTitleFiles() {
        throw new Error('deleteTitleFiles should not be called')
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

const matchesQuery = (doc, query = {}) => {
    if (!query || typeof query !== 'object') {
        return true
    }

    return Object.entries(query).every(([key, value]) => doc?.[key] === value)
}

const applyMongoUpdate = (doc, update = {}, {isInsert = false} = {}) => {
    if (isInsert && update?.$setOnInsert && typeof update.$setOnInsert === 'object') {
        Object.assign(doc, update.$setOnInsert)
    }
    if (update?.$set && typeof update.$set === 'object') {
        Object.assign(doc, update.$set)
    }
    return doc
}

const createVaultAuthStub = ({users = [], settings = []} = {}) => {
    const userDocs = users.map((entry) => ({...entry}))
    const settingDocs = settings.map((entry) => ({...entry}))
    const redisStore = new Map()
    const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '')
    const normalizeUsername = (value) => normalizeString(value)
    const normalizeUsernameKey = (value) => normalizeUsername(value).toLowerCase()
    const normalizeRole = (value, fallback = 'member') => {
        const normalized = normalizeString(value).toLowerCase()
        if (normalized === 'admin' || normalized === 'member') {
            return normalized
        }
        return fallback
    }
    const MOON_OP_PERMISSION_KEYS = [
        'moon_login',
        'lookup_new_title',
        'download_new_title',
        'check_download_missing_titles',
        'user_management',
        'admin',
    ]
    const DEFAULT_MEMBER_PERMISSION_KEYS = [
        'moon_login',
        'lookup_new_title',
        'download_new_title',
        'check_download_missing_titles',
    ]
    const sortPermissions = (permissions = []) => {
        const set = new Set(Array.isArray(permissions) ? permissions : [])
        return MOON_OP_PERMISSION_KEYS.filter((entry) => set.has(entry))
    }
    const normalizePermissionKey = (value) => normalizeString(value).toLowerCase()
    const normalizePermissions = (value) => {
        if (!Array.isArray(value)) {
            return []
        }

        const next = []
        for (const entry of value) {
            const key = normalizePermissionKey(entry)
            if (!key || !MOON_OP_PERMISSION_KEYS.includes(key)) {
                continue
            }
            next.push(key)
        }
        return sortPermissions(Array.from(new Set(next)))
    }
    const defaultPermissionsForRole = (role) =>
        normalizeRole(role, 'member') === 'admin'
            ? [...MOON_OP_PERMISSION_KEYS]
            : [...DEFAULT_MEMBER_PERMISSION_KEYS]

    const hashPassword = (password) => {
        const salt = crypto.randomBytes(16)
        const derived = crypto.scryptSync(password, salt, 64, {
            N: 16384,
            r: 8,
            p: 1,
        })
        return `scrypt$16384$8$1$${salt.toString('base64')}$${derived.toString('base64')}`
    }

    const verifyPassword = (password, stored) => {
        if (typeof password !== 'string' || !password || typeof stored !== 'string' || !stored) {
            return false
        }

        const parts = stored.split('$')
        if (parts.length !== 6 || parts[0] !== 'scrypt') {
            return false
        }

        const N = Number(parts[1])
        const r = Number(parts[2])
        const p = Number(parts[3])
        const salt = Buffer.from(parts[4], 'base64')
        const expected = Buffer.from(parts[5], 'base64')
        const derived = crypto.scryptSync(password, salt, expected.length, {N, r, p})
        return crypto.timingSafeEqual(derived, expected)
    }

    const lookupKeyForUser = (user) => {
        const normalized = normalizeUsernameKey(user?.usernameNormalized)
        if (normalized) return normalized
        return normalizeUsernameKey(user?.username)
    }

    const toPublicUser = (user) => ({
        username: normalizeUsername(user?.username),
        usernameNormalized: lookupKeyForUser(user),
        role: (() => {
            const normalizedRole = normalizeRole(user?.role, 'member')
            const permissions = normalizePermissions(user?.permissions)
            if (permissions.includes('admin')) return 'admin'
            if (normalizedRole === 'admin') return 'admin'
            return 'member'
        })(),
        permissions: (() => {
            const normalizedRole = normalizeRole(user?.role, 'member')
            const existing = normalizePermissions(user?.permissions)
            const hasExplicitPermissions = Array.isArray(user?.permissions)
            if (hasExplicitPermissions) {
                if (existing.includes('admin')) {
                    return existing
                }
                if (normalizedRole === 'admin') {
                    return sortPermissions([...existing, 'admin'])
                }
                return sortPermissions(existing.filter((entry) => entry !== 'admin'))
            }
            return defaultPermissionsForRole(normalizedRole)
        })(),
        isBootstrapUser: Boolean(user?.isBootstrapUser),
        createdAt: normalizeString(user?.createdAt) || null,
        updatedAt: normalizeString(user?.updatedAt) || null,
    })

    const findUserIndex = (lookup) => userDocs.findIndex((entry) => lookupKeyForUser(entry) === normalizeUsernameKey(lookup))

    const createVaultError = (message, status) => {
        const error = new Error(message)
        error.status = status
        error.payload = {error: message}
        return error
    }

    const updateCollection = (collectionName, query = {}, update = {}, {upsert = false} = {}) => {
        const target = collectionName === 'noona_users' ? userDocs : settingDocs
        const index = target.findIndex((doc) => matchesQuery(doc, query))

        if (index >= 0) {
            target[index] = applyMongoUpdate({...target[index]}, update, {isInsert: false})
            return {status: 'ok', matched: 1, modified: 1}
        }

        if (!upsert) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        const inserted = applyMongoUpdate({...query}, update, {isInsert: true})
        target.push(inserted)
        return {status: 'ok', matched: 0, modified: 0}
    }

    return {
        userDocs,
        settingDocs,
        redisStore,
        client: {
            mongo: {
                async findOne(collectionName, query = {}) {
                    if (collectionName === 'noona_users') {
                        return userDocs.find((doc) => matchesQuery(doc, query)) ?? null
                    }
                    if (collectionName === 'noona_settings') {
                        return settingDocs.find((doc) => matchesQuery(doc, query)) ?? null
                    }
                    return null
                },
                async insert(collectionName, data = {}) {
                    if (collectionName === 'noona_users') {
                        userDocs.push({...data})
                        return {status: 'ok', insertedId: `user-${userDocs.length}`}
                    }
                    if (collectionName === 'noona_settings') {
                        settingDocs.push({...data})
                        return {status: 'ok', insertedId: `setting-${settingDocs.length}`}
                    }
                    return {status: 'ok', insertedId: null}
                },
                async findMany(collectionName, query = {}) {
                    if (collectionName === 'noona_users') {
                        return userDocs.filter((doc) => matchesQuery(doc, query)).map((entry) => ({...entry}))
                    }
                    if (collectionName === 'noona_settings') {
                        return settingDocs.filter((doc) => matchesQuery(doc, query)).map((entry) => ({...entry}))
                    }
                    return []
                },
                async update(collectionName, query = {}, update = {}, options = {}) {
                    return updateCollection(collectionName, query, update, options)
                },
            },
            redis: {
                async set(key, value) {
                    redisStore.set(key, value)
                    return {status: 'ok'}
                },
                async get(key) {
                    return redisStore.get(key) ?? null
                },
                async del(key) {
                    return redisStore.delete(key) ? 1 : 0
                },
            },
            users: {
                async list() {
                    return userDocs.map((entry) => toPublicUser(entry))
                },
                async get(username) {
                    const idx = findUserIndex(username)
                    if (idx < 0) return null
                    return toPublicUser(userDocs[idx])
                },
                async create(payload = {}) {
                    const {username, password, role = 'member', permissions, isBootstrapUser = false} = payload
                    const hasPermissionsInput = Object.prototype.hasOwnProperty.call(payload ?? {}, 'permissions')
                    const usernameTrimmed = normalizeUsername(username)
                    const lookupKey = normalizeUsernameKey(usernameTrimmed)
                    if (!lookupKey) {
                        throw createVaultError('username is required.', 400)
                    }
                    if (findUserIndex(usernameTrimmed) >= 0) {
                        throw createVaultError('User already exists.', 409)
                    }

                    const now = new Date().toISOString()
                    let nextRole = normalizeRole(role, 'member')
                    let nextPermissions = hasPermissionsInput
                        ? normalizePermissions(permissions)
                        : defaultPermissionsForRole(nextRole)
                    if (nextRole === 'admin' && !nextPermissions.includes('admin')) {
                        nextPermissions = sortPermissions([...nextPermissions, 'admin'])
                    }
                    if (nextRole !== 'admin' && nextPermissions.includes('admin')) {
                        nextRole = 'admin'
                    }
                    if (nextRole !== 'admin') {
                        nextPermissions = sortPermissions(nextPermissions.filter((entry) => entry !== 'admin'))
                    }
                    const doc = {
                        username: usernameTrimmed,
                        usernameNormalized: lookupKey,
                        passwordHash: hashPassword(password),
                        role: nextRole,
                        permissions: nextPermissions,
                        isBootstrapUser: Boolean(isBootstrapUser),
                        createdAt: now,
                        updatedAt: now,
                    }
                    userDocs.push(doc)
                    return {ok: true, user: toPublicUser(doc)}
                },
                async update(lookupUsername, updates = {}) {
                    const idx = findUserIndex(lookupUsername)
                    if (idx < 0) {
                        throw createVaultError('User not found.', 404)
                    }

                    const target = {...userDocs[idx]}
                    if (Object.prototype.hasOwnProperty.call(updates, 'username')) {
                        const nextUsername = normalizeUsername(updates.username)
                        const nextLookup = normalizeUsernameKey(nextUsername)
                        const conflictIdx = findUserIndex(nextUsername)
                        if (conflictIdx >= 0 && conflictIdx !== idx) {
                            throw createVaultError('Username is already in use.', 409)
                        }
                        target.username = nextUsername
                        target.usernameNormalized = nextLookup
                    }

                    if (Object.prototype.hasOwnProperty.call(updates, 'password')) {
                        target.passwordHash = hashPassword(updates.password)
                    }

                    if (Object.prototype.hasOwnProperty.call(updates, 'role')) {
                        target.role = normalizeRole(updates.role, normalizeRole(target.role, 'member'))
                    }
                    if (Object.prototype.hasOwnProperty.call(updates, 'permissions')) {
                        target.permissions = normalizePermissions(updates.permissions)
                    }
                    if (Object.prototype.hasOwnProperty.call(updates, 'isBootstrapUser')) {
                        target.isBootstrapUser = Boolean(updates.isBootstrapUser)
                    }

                    if (Object.prototype.hasOwnProperty.call(updates, 'role') && !Object.prototype.hasOwnProperty.call(updates, 'permissions')) {
                        target.permissions = defaultPermissionsForRole(target.role)
                    }
                    if (Object.prototype.hasOwnProperty.call(updates, 'permissions') && !Object.prototype.hasOwnProperty.call(updates, 'role')) {
                        target.role = target.permissions.includes('admin') ? 'admin' : 'member'
                    }
                    if (normalizeRole(target.role, 'member') === 'admin' && !normalizePermissions(target.permissions).includes('admin')) {
                        target.permissions = sortPermissions([...normalizePermissions(target.permissions), 'admin'])
                    }
                    if (normalizeRole(target.role, 'member') !== 'admin') {
                        target.permissions = sortPermissions(normalizePermissions(target.permissions).filter((entry) => entry !== 'admin'))
                    }

                    target.updatedAt = new Date().toISOString()
                    userDocs[idx] = target
                    return {ok: true, user: toPublicUser(target)}
                },
                async delete(lookupUsername) {
                    const idx = findUserIndex(lookupUsername)
                    if (idx < 0) {
                        return {deleted: false}
                    }
                    userDocs.splice(idx, 1)
                    return {deleted: true}
                },
                async authenticate({username, password} = {}) {
                    const idx = findUserIndex(username)
                    if (idx < 0) {
                        return {authenticated: false, user: null}
                    }

                    const target = userDocs[idx]
                    const lookupKey = normalizeUsernameKey(username)
                    if (!normalizeUsernameKey(target.usernameNormalized) && lookupKey) {
                        target.usernameNormalized = lookupKey
                    }

                    if (!verifyPassword(password, target.passwordHash)) {
                        return {authenticated: false, user: null}
                    }

                    return {authenticated: true, user: toPublicUser(target)}
                },
            },
        },
    }
}

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

test('POST /api/setup/services/validate normalizes payload', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            listServices: async () => [],
            installServices: async () => ({ status: 200, results: [] }),
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: ['  noona-sage  ', { name: 'noona-raven', env: { DEBUG: true } }] }),
    })

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(payload.services, [
        { name: 'noona-sage' },
        { name: 'noona-raven', env: { DEBUG: 'true' } },
    ])
})

test('POST /api/setup/services/preview streams NDJSON when requested', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            listServices: async () => [
                { name: 'noona-sage' },
                { name: 'noona-raven' },
            ],
            installServices: async () => ({ status: 200, results: [] }),
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/preview`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ services: ['noona-sage', 'unknown-service'] }),
    })

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/x-ndjson')
    const text = await response.text()
    const [line] = text.trim().split('\n')
    const parsed = JSON.parse(line)

    assert.equal(parsed.type, 'preview')
    assert.deepEqual(parsed.data.summary, { total: 2, known: 1, unknown: 1 })
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

test('GET /api/wizard/steps returns metadata and defaults', async (t) => {
    const app = createSageApp({ serviceName: 'test-sage' })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/wizard/steps`)
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.deepEqual(payload.steps, DEFAULT_WIZARD_STEP_METADATA)
    assert.ok(payload.defaults)
})

test('GET /api/wizard/progress aggregates wizard and install state', async (t) => {
    const wizardState = createDefaultWizardState()
    const progress = { items: [{ name: 'noona-sage', status: 'installing' }], status: 'installing', percent: 25 }

    const app = createSageApp({
        serviceName: 'test-sage',
        wizardStateClient: {
            async loadState() {
                return wizardState
            },
        },
        setupClient: {
            async getInstallProgress() {
                return progress
            },
            listServices: async () => [],
            installServices: async () => ({ status: 200, results: [] }),
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/wizard/progress`)
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.deepEqual(payload.wizard, wizardState)
    assert.deepEqual(payload.progress, progress)
})

test('GET /api/setup/wizard/steps/:step/history returns timeline events', async (t) => {
    const { state: wizardState } = appendWizardStepHistoryEntries(createDefaultWizardState(), {
        step: 'foundation',
        entries: [
            { message: 'Queued install', detail: 'Starting services', status: 'info' },
            { message: 'Awaiting credentials', detail: 'Waiting for admin token', status: 'pending' },
        ],
    })

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

    const response = await fetch(`${baseUrl}/api/setup/wizard/steps/foundation/history?limit=1`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.step, 'foundation')
    assert.equal(payload.events.length, 1)
    assert.equal(payload.events[0].message, 'Awaiting credentials')
    assert.deepEqual(calls, ['load'])
})

test('GET /api/setup/wizard/metadata returns metadata and feature flags', async (t) => {
    const app = createSageApp({
        wizard: {
            metadata: {
                steps: [
                    {
                        id: 'raven',
                        title: 'Custom Raven deployment',
                        description: 'Custom description',
                        optional: true,
                        icon: 'download',
                        capabilities: ['raven', 'custom'],
                    },
                ],
                featureFlags: { 'wizard.beta': true },
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/wizard/metadata`)
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.deepEqual(payload.features, { 'wizard.beta': true })
    assert.equal(payload.steps.length, DEFAULT_WIZARD_STEP_METADATA.length)
    const ravenEntry = payload.steps.find((step) => step.id === 'raven')
    assert.ok(ravenEntry)
    assert.equal(ravenEntry.title, 'Custom Raven deployment')
    assert.equal(ravenEntry.optional, true)
    assert.equal(ravenEntry.icon, 'download')
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

test('POST /api/setup/wizard/steps/:step/reset clears state and appends history', async (t) => {
    const wizardState = createDefaultWizardState()
    const updates = []
    const historyCalls = []

    const app = createSageApp({
        wizardStateClient: {
            async applyUpdates(changeSet) {
                updates.push(...changeSet)
                return { state: wizardState, changed: true }
            },
            async appendHistory(options) {
                historyCalls.push(options)
                return { state: wizardState, changed: true }
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/wizard/steps/raven/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: { id: 'ops', label: 'Ops' }, detail: 'Operator requested reset' }),
    })

    assert.equal(response.status, 200)
    assert.equal(updates.length, 1)
    assert.equal(updates[0].step, 'raven')
    assert.deepEqual(updates[0].timeline, [])
    assert.equal(updates[0].status, 'pending')
    assert.equal(historyCalls.length, 1)
    assert.equal(historyCalls[0].step, 'raven')
    assert.equal(historyCalls[0].entries[0].message, 'Step reset')
    assert.equal(historyCalls[0].entries[0].detail, 'Operator requested reset')
})

test('POST /api/setup/wizard/steps/:step/broadcast appends derived summaries', async (t) => {
    let wizardState = createDefaultWizardState()
    const historyCalls = []
    const updates = []

    const app = createSageApp({
        wizardStateClient: {
            async appendHistory(options) {
                historyCalls.push(options)
                const result = appendWizardStepHistoryEntries(wizardState, options)
                if (result.changed) {
                    wizardState = result.state
                }
                return { state: wizardState, changed: result.changed }
            },
            async applyUpdates(changeSet) {
                updates.push(...changeSet)
                const result = applyWizardStateUpdates(wizardState, changeSet)
                wizardState = result.state
                return { state: wizardState, changed: result.changed }
            },
            async loadState() {
                return wizardState
            },
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/wizard/steps/portal/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: 'Awaiting credentials',
            detail: 'Waiting for admin confirmation',
            status: 'in-progress',
            eventStatus: 'info',
            actor: { id: 'moon', label: 'Moon UI' },
        }),
    })

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.step, 'portal')
    assert.equal(payload.event.message, 'Awaiting credentials')
    assert.equal(payload.wizard.portal.detail, 'Waiting for admin confirmation')
    assert.equal(payload.wizard.portal.status, 'in-progress')
    assert.ok(Array.isArray(payload.wizard.portal.timeline))
    const lastEvent = payload.wizard.portal.timeline[payload.wizard.portal.timeline.length - 1]
    assert.equal(lastEvent.message, 'Awaiting credentials')
    assert.equal(historyCalls.length, 1)
    assert.ok(updates.some((entry) => entry.step === 'portal' && entry.status === 'in-progress'))
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
                async fetchApplication() {
                    return {id: 'client-123', name: 'Noona Portal'}
                },
                async fetchGuilds() {
                    return [guildStub]
                },
                async fetchGuildById() {
                    return guildStub
                },
            }
        },
    })

    const payload = await setupClient.fetchResources({token: 'token'})

    assert.equal(createdOptions.length, 1)
    assert.equal(loginCalls.length, 1)
    assert.equal(destroyCalls.length, 1)
    assert.deepEqual(createdOptions[0].intents, [GatewayIntentBits.Guilds])
    assert.deepEqual(createdOptions[0].partials, [])
    assert.equal(payload.application?.id, 'client-123')
    assert.equal(payload.suggested?.guildId, 'guild-123')
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
        () => setupClient.fetchResources({token: 'bad-token'}),
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
                return {
                    status: 'installing',
                    percent: 25,
                    items: [
                        {
                            name: 'noona-sage',
                            status: 'installing',
                            layerId: 'layer-abc',
                            phase: 'Downloading',
                            detail: '10/100',
                        },
                    ],
                }
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
        items: [
            {
                name: 'noona-sage',
                status: 'installing',
                layerId: 'layer-abc',
                phase: 'Downloading',
                detail: '10/100',
            },
        ],
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
                    entries: [
                        {
                            message: 'Starting installation',
                            meta: {
                                layerId: 'layer-abc',
                                phase: 'Pulling',
                                progressDetail: { current: 5, total: 10 },
                            },
                        },
                    ],
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
        entries: [
            {
                message: 'Starting installation',
                meta: {
                    layerId: 'layer-abc',
                    phase: 'Pulling',
                    progressDetail: { current: 5, total: 10 },
                },
            },
        ],
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
                    entries: [
                        {
                            type: 'status',
                            status: 'ready',
                            message: 'Ready',
                            meta: { layerId: 'layer-xyz', phase: 'Extracting' },
                        },
                    ],
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
        entries: [
            {
                type: 'status',
                status: 'ready',
                message: 'Ready',
                meta: { layerId: 'layer-xyz', phase: 'Extracting' },
            },
        ],
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

test('POST /api/raven/library/checkForNew proxies Raven library sync', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async checkLibraryForNewChapters() {
                calls.push('sync')
                return {checkedTitles: 2, queuedChapters: 5}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/library/checkForNew`, {method: 'POST'})
    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), {checkedTitles: 2, queuedChapters: 5})
    assert.deepEqual(calls, ['sync'])
})

test('POST /api/raven/library/checkForNew surfaces Raven errors', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async checkLibraryForNewChapters() {
                throw new Error('boom')
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/library/checkForNew`, {method: 'POST'})
    assert.equal(response.status, 502)
    const payload = await response.json()
    assert.ok(payload.error.includes('Unable to check Raven library for updates'))
})

test('GET /api/raven/title/:uuid proxies Raven title lookups', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async getTitle(uuid) {
                calls.push(uuid)
                return {uuid, title: 'Absolute Duo'}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/title/title-123`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {uuid: 'title-123', title: 'Absolute Duo'})
    assert.deepEqual(calls, ['title-123'])
})

test('GET /api/raven/title/:uuid returns 404 for unknown titles', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async getTitle() {
                return null
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/title/missing`)
    assert.equal(response.status, 404)
    const payload = await response.json()
    assert.ok(payload.error.includes('not found'))
})

test('POST /api/raven/title/:uuid/checkForNew proxies title sync', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async checkTitleForNewChapters(uuid) {
                calls.push(uuid)
                return {uuid, status: 'updated', totalQueued: 3}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/title/title-123/checkForNew`, {method: 'POST'})
    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), {uuid: 'title-123', status: 'updated', totalQueued: 3})
    assert.deepEqual(calls, ['title-123'])
})

test('POST /api/raven/title/:uuid/checkForNew returns 404 for unknown titles', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async checkTitleForNewChapters() {
                return null
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/title/missing/checkForNew`, {method: 'POST'})
    assert.equal(response.status, 404)
    const payload = await response.json()
    assert.ok(payload.error.includes('not found'))
})

test('POST /api/raven/title proxies Raven title creation', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async createTitle(payload) {
                calls.push(payload)
                return {uuid: 'uuid-1', title: payload.title, sourceUrl: payload.sourceUrl ?? null}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/title`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title: '  One Piece  ', sourceUrl: '  https://example.test  '}),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {uuid: 'uuid-1', title: 'One Piece', sourceUrl: 'https://example.test'})
    assert.deepEqual(calls, [{title: 'One Piece', sourceUrl: 'https://example.test'}])
})

test('PATCH /api/raven/title/:uuid proxies Raven title updates', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async updateTitle(uuid, payload) {
                calls.push([uuid, payload])
                return {uuid, title: payload.title ?? null, sourceUrl: payload.sourceUrl ?? null}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/title/title-abc`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({title: '  Updated  '}),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {uuid: 'title-abc', title: 'Updated', sourceUrl: null})
    assert.deepEqual(calls, [['title-abc', {title: 'Updated', sourceUrl: null}]])
})

test('DELETE /api/raven/title/:uuid proxies Raven title deletes', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async deleteTitle(uuid) {
                calls.push(uuid)
                return {deleted: true}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/title/title-del`, {method: 'DELETE'})
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {deleted: true})
    assert.deepEqual(calls, ['title-del'])
})

test('GET /api/raven/title/:uuid/files proxies Raven file listings', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async listTitleFiles(uuid, options) {
                calls.push([uuid, options])
                return {uuid, title: 'Absolute Duo', files: []}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/title/title-files/files?limit=50`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {uuid: 'title-files', title: 'Absolute Duo', files: []})
    assert.deepEqual(calls, [['title-files', {limit: '50'}]])
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

const bootstrapAdminAndLogin = async ({baseUrl, username = 'CaptainPax', password = 'Password123'} = {}) => {
    const bootstrapResponse = await fetch(`${baseUrl}/api/auth/bootstrap`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password}),
    })
    assert.equal(bootstrapResponse.status, 200)
    const bootstrapPayload = await bootstrapResponse.json()
    assert.equal(bootstrapPayload.ok, true)

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    assert.equal(typeof loginPayload.token, 'string')
    assert.equal(loginPayload.user.username, username)
    assert.equal(loginPayload.user.role, 'admin')

    return {
        username,
        password,
        token: loginPayload.token,
        bootstrapPayload,
    }
}

const finalizeBootstrapAdmin = async ({baseUrl, token}) => {
    const response = await fetch(`${baseUrl}/api/auth/bootstrap/finalize`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
    const payload = await response.json()
    return {response, payload}
}

const jsonResponse = (body, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
        },
    })

const createDiscordOauthFetchStub = ({identitiesByCode = {}} = {}) => async (url, init = {}) => {
    const target = String(url)
    if (target.endsWith('/oauth2/token')) {
        const params = new URLSearchParams(String(init.body ?? ''))
        const code = params.get('code')
        if (!code || !identitiesByCode[code]) {
            return jsonResponse({error: 'invalid_grant', error_description: 'Unknown authorization code.'}, 400)
        }

        return jsonResponse({
            access_token: `token-for-${code}`,
            token_type: 'Bearer',
            scope: 'identify email',
        })
    }

    if (target.endsWith('/users/@me')) {
        const authHeader = new Headers(init.headers ?? {}).get('authorization') ?? ''
        const accessToken = authHeader.replace(/^Bearer\s+/i, '')
        const code = accessToken.replace(/^token-for-/, '')
        const identity = identitiesByCode[code]
        if (!identity) {
            return jsonResponse({message: 'Unknown access token.'}, 401)
        }

        return jsonResponse({
            id: identity.id,
            username: identity.username,
            global_name: identity.globalName,
            avatar: identity.avatar ?? 'avatarhash',
            email: identity.email ?? null,
        })
    }

    throw new Error(`Unexpected Discord OAuth fetch: ${target}`)
}

test('POST /api/auth/bootstrap stores admin in memory and login works before vault is configured', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const statusBefore = await fetch(`${baseUrl}/api/auth/bootstrap/status`)
    assert.equal(statusBefore.status, 200)
    assert.deepEqual(await statusBefore.json(), {
        setupCompleted: false,
        adminExists: false,
        username: null,
        persisted: false,
    })

    const {token} = await bootstrapAdminAndLogin({baseUrl})

    const statusAfter = await fetch(`${baseUrl}/api/auth/bootstrap/status`)
    assert.equal(statusAfter.status, 200)
    assert.deepEqual(await statusAfter.json(), {
        setupCompleted: false,
        adminExists: true,
        username: 'CaptainPax',
        persisted: false,
    })

    const authStatus = await fetch(`${baseUrl}/api/auth/status`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(authStatus.status, 200)
    const authPayload = await authStatus.json()
    assert.equal(authPayload.user.username, 'CaptainPax')
    assert.equal(authPayload.user.role, 'admin')
})

test('POST /api/auth/bootstrap/finalize persists pending admin into vault storage', async (t) => {
    const vault = createVaultAuthStub()
    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    assert.equal(vault.userDocs.length, 0)

    const {response, payload} = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(response.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.persisted, true)
    assert.equal(payload.created, true)
    assert.equal(payload.username, 'CaptainPax')

    const createdAdmin = vault.userDocs.find((entry) => entry.role === 'admin')
    assert.ok(createdAdmin)
    assert.equal(createdAdmin.username, 'CaptainPax')
    assert.equal(createdAdmin.usernameNormalized, 'captainpax')
    assert.ok(typeof createdAdmin.passwordHash === 'string' && createdAdmin.passwordHash.startsWith('scrypt$'))

    const secondFinalize = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(secondFinalize.response.status, 200)
    assert.equal(secondFinalize.payload.persisted, false)
})

test('POST /api/auth/bootstrap/finalize updates existing admin credentials when admin already exists', async (t) => {
    const oldPasswordHash =
        'scrypt$16384$8$1$R0Q4jRjN0Bhiw91o0q4LYQ==$XWwI3dI7X9gJQTLf5+3xHzrJQkEM6GShAb8ehIg4s0v8fu4vW7nKfknB/olqV+Y4x9D9iJ8qC6C0VJkpA8Y3jw=='

    const vault = createVaultAuthStub({
        users: [
            {
                username: 'admin',
                usernameNormalized: 'admin',
                role: 'admin',
                passwordHash: oldPasswordHash,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
            },
        ],
    })

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const {response, payload} = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(response.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.created, false)
    assert.equal(payload.persisted, true)

    const updatedAdmin = vault.userDocs.find((entry) => entry.role === 'admin')
    assert.ok(updatedAdmin)
    assert.equal(updatedAdmin.username, 'CaptainPax')
    assert.equal(updatedAdmin.usernameNormalized, 'captainpax')
    assert.equal(updatedAdmin.createdAt, '2026-01-01T00:00:00.000Z')
    assert.ok(typeof updatedAdmin.passwordHash === 'string' && updatedAdmin.passwordHash.startsWith('scrypt$'))
    assert.notEqual(updatedAdmin.passwordHash, oldPasswordHash)
})

test('POST /api/auth/bootstrap/finalize promotes existing username and demotes stale admin records', async (t) => {
    const vault = createVaultAuthStub({
        users: [
            {
                username: 'admin',
                usernameNormalized: 'admin',
                role: 'admin',
                passwordHash:
                    'scrypt$16384$8$1$R0Q4jRjN0Bhiw91o0q4LYQ==$XWwI3dI7X9gJQTLf5+3xHzrJQkEM6GShAb8ehIg4s0v8fu4vW7nKfknB/olqV+Y4x9D9iJ8qC6C0VJkpA8Y3jw==',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
                username: 'CaptainPax',
                usernameNormalized: 'captainpax',
                role: 'member',
                passwordHash:
                    'scrypt$16384$8$1$R0Q4jRjN0Bhiw91o0q4LYQ==$XWwI3dI7X9gJQTLf5+3xHzrJQkEM6GShAb8ehIg4s0v8fu4vW7nKfknB/olqV+Y4x9D9iJ8qC6C0VJkpA8Y3jw==',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
            },
        ],
    })

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const {response, payload} = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(response.status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.persisted, true)

    const currentAdmin = vault.userDocs.find((entry) => entry.usernameNormalized === 'captainpax')
    assert.ok(currentAdmin)
    assert.equal(currentAdmin.role, 'admin')
    assert.ok(typeof currentAdmin.passwordHash === 'string' && currentAdmin.passwordHash.startsWith('scrypt$'))

    const previousAdmin = vault.userDocs.find((entry) => entry.usernameNormalized === 'admin')
    assert.ok(previousAdmin)
    assert.equal(previousAdmin.role, 'member')
})

test('POST /api/auth/bootstrap returns conflict when setup is already completed', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/auth/bootstrap`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'CaptainPax', password: 'Password123'}),
    })

    assert.equal(response.status, 409)
    const payload = await response.json()
    assert.equal(payload.error, 'Setup already completed.')
})

test('POST /api/auth/login repairs legacy users missing usernameNormalized', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const storedUser = vault.userDocs.find((entry) => entry.usernameNormalized === 'captainpax')
    assert.ok(storedUser)
    delete storedUser.usernameNormalized

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'CaptainPax', password: 'Password123'}),
    })

    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    assert.equal(loginPayload.user.username, 'CaptainPax')
    assert.equal(loginPayload.user.role, 'admin')

    const refreshedStoredUser = vault.userDocs.find((entry) => entry.username === 'CaptainPax')
    assert.ok(refreshedStoredUser)
    assert.equal(refreshedStoredUser.usernameNormalized, 'captainpax')
})

test('Discord OAuth config, callback test, and bootstrap create the first admin session', async (t) => {
    const vault = createVaultAuthStub()
    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
        auth: {
            fetchImpl: createDiscordOauthFetchStub({
                identitiesByCode: {
                    'callback-test': {
                        id: '123456789012345678',
                        username: 'PaxKun',
                        globalName: 'Pax-kun',
                        email: 'pax@example.com',
                    },
                },
            }),
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const configResponse = await fetch(`${baseUrl}/api/auth/discord/config`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            clientId: 'discord-client-id',
            clientSecret: 'discord-client-secret',
        }),
    })
    assert.equal(configResponse.status, 200)

    const startTestResponse = await fetch(`${baseUrl}/api/auth/discord/start`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            mode: 'test',
            redirectUri: 'http://moon.local/discord/callback/',
            returnTo: '/setupwizard/summary?selected=noona-portal',
        }),
    })
    assert.equal(startTestResponse.status, 200)
    const startTestPayload = await startTestResponse.json()
    assert.ok(String(startTestPayload.authorizeUrl).includes('client_id=discord-client-id'))
    assert.ok(typeof startTestPayload.state === 'string' && startTestPayload.state.length > 10)

    const callbackTestResponse = await fetch(`${baseUrl}/api/auth/discord/callback`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            code: 'callback-test',
            state: startTestPayload.state,
        }),
    })
    assert.equal(callbackTestResponse.status, 200)
    const callbackTestPayload = await callbackTestResponse.json()
    assert.equal(callbackTestPayload.stage, 'tested')
    assert.equal(callbackTestPayload.user.username, 'PaxKun')

    const storedDiscordConfig = vault.settingDocs.find((entry) => entry.key === 'auth.discord')
    assert.ok(storedDiscordConfig)
    assert.equal(storedDiscordConfig.clientId, 'discord-client-id')
    assert.ok(typeof storedDiscordConfig.lastTestedAt === 'string' && storedDiscordConfig.lastTestedAt.length > 10)
    assert.equal(storedDiscordConfig.lastTestedUser.id, '123456789012345678')

    const startBootstrapResponse = await fetch(`${baseUrl}/api/auth/discord/start`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            mode: 'bootstrap',
            redirectUri: 'http://moon.local/discord/callback/',
            returnTo: '/setupwizard/summary?selected=noona-portal',
        }),
    })
    assert.equal(startBootstrapResponse.status, 200)
    const startBootstrapPayload = await startBootstrapResponse.json()

    const callbackBootstrapResponse = await fetch(`${baseUrl}/api/auth/discord/callback`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            code: 'callback-test',
            state: startBootstrapPayload.state,
        }),
    })
    assert.equal(callbackBootstrapResponse.status, 200)
    const callbackBootstrapPayload = await callbackBootstrapResponse.json()
    assert.equal(callbackBootstrapPayload.stage, 'bootstrapped')
    assert.ok(typeof callbackBootstrapPayload.token === 'string' && callbackBootstrapPayload.token.length > 10)
    assert.equal(callbackBootstrapPayload.user.authProvider, 'discord')
    assert.equal(callbackBootstrapPayload.user.discordUserId, '123456789012345678')

    const storedAdmin = vault.userDocs.find((entry) => entry.discordUserId === '123456789012345678')
    assert.ok(storedAdmin)
    assert.equal(storedAdmin.usernameNormalized, 'discord.123456789012345678')
    assert.equal(storedAdmin.role, 'admin')
    assert.equal(storedAdmin.isBootstrapUser, true)

    const statusResponse = await fetch(`${baseUrl}/api/auth/status`, {
        headers: {
            Authorization: `Bearer ${callbackBootstrapPayload.token}`,
        },
    })
    assert.equal(statusResponse.status, 200)
    const statusPayload = await statusResponse.json()
    assert.equal(statusPayload.user.discordUserId, '123456789012345678')
    assert.equal(statusPayload.user.role, 'admin')
})

test('auth user management creates Discord-linked users and Discord login uses OAuth callback', async (t) => {
    const vault = createVaultAuthStub()
    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
        auth: {
            fetchImpl: createDiscordOauthFetchStub({
                identitiesByCode: {
                    'reader-login': {
                        id: '999888777666555444',
                        username: 'ReaderDiscord',
                        globalName: 'Reader Prime',
                        email: 'reader@example.com',
                    },
                },
            }),
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const configResponse = await fetch(`${baseUrl}/api/auth/discord/config`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            clientId: 'discord-client-id',
            clientSecret: 'discord-client-secret',
        }),
    })
    assert.equal(configResponse.status, 200)

    const createResponse = await fetch(`${baseUrl}/api/auth/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            username: 'Reader One',
            discordUserId: '999888777666555444',
            permissions: ['moon_login', 'lookup_new_title'],
        }),
    })
    assert.equal(createResponse.status, 201)
    const createPayload = await createResponse.json()
    assert.equal(createPayload.user.authProvider, 'discord')
    assert.equal(createPayload.user.discordUserId, '999888777666555444')

    const resetPasswordResponse = await fetch(`${baseUrl}/api/auth/users/discord.999888777666555444/reset-password`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    })
    assert.equal(resetPasswordResponse.status, 400)

    const startLoginResponse = await fetch(`${baseUrl}/api/auth/discord/start`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            mode: 'login',
            redirectUri: 'http://moon.local/discord/callback/',
            returnTo: '/',
        }),
    })
    assert.equal(startLoginResponse.status, 200)
    const startLoginPayload = await startLoginResponse.json()

    const callbackLoginResponse = await fetch(`${baseUrl}/api/auth/discord/callback`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            code: 'reader-login',
            state: startLoginPayload.state,
        }),
    })
    assert.equal(callbackLoginResponse.status, 200)
    const callbackLoginPayload = await callbackLoginResponse.json()
    assert.equal(callbackLoginPayload.stage, 'authenticated')
    assert.ok(typeof callbackLoginPayload.token === 'string' && callbackLoginPayload.token.length > 10)
    assert.equal(callbackLoginPayload.user.authProvider, 'discord')
    assert.equal(callbackLoginPayload.user.discordUserId, '999888777666555444')
    assert.equal(callbackLoginPayload.user.username, 'Reader One')
})

test('auth user management routes create, update, list, and delete users through vault', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const createResponse = await fetch(`${baseUrl}/api/auth/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({username: 'ReaderOne', password: 'Password123', role: 'member'}),
    })
    assert.equal(createResponse.status, 201)

    const updateResponse = await fetch(`${baseUrl}/api/auth/users/ReaderOne`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({username: 'ReaderPrime', role: 'admin'}),
    })
    assert.equal(updateResponse.status, 200)
    const updatePayload = await updateResponse.json()
    assert.equal(updatePayload.user.username, 'ReaderPrime')
    assert.equal(updatePayload.user.role, 'admin')

    const listResponse = await fetch(`${baseUrl}/api/auth/users`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(listResponse.status, 200)
    const listPayload = await listResponse.json()
    assert.ok(Array.isArray(listPayload.users))
    assert.ok(listPayload.users.some((entry) => entry.username === 'ReaderPrime'))

    const deleteResponse = await fetch(`${baseUrl}/api/auth/users/ReaderPrime`, {
        method: 'DELETE',
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(deleteResponse.status, 200)
    assert.deepEqual(await deleteResponse.json(), {deleted: true})
})

test('auth user management keeps bootstrap protection on legacy setup user records', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const setupUserDoc = vault.userDocs.find((entry) => entry.usernameNormalized === 'captainpax')
    assert.ok(setupUserDoc)
    // Simulate legacy records created before bootstrap protection was persisted.
    setupUserDoc.isBootstrapUser = false

    const createResponse = await fetch(`${baseUrl}/api/auth/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            username: 'ReaderAdmin',
            password: 'Password123',
            permissions: ['moon_login', 'admin'],
        }),
    })
    assert.equal(createResponse.status, 201)
    const createPayload = await createResponse.json()
    assert.equal(createPayload.user.username, 'ReaderAdmin')
    assert.equal(createPayload.user.role, 'admin')
    assert.equal(createPayload.user.isBootstrapUser, false)

    const listResponse = await fetch(`${baseUrl}/api/auth/users`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(listResponse.status, 200)
    const listPayload = await listResponse.json()
    const setupUser = listPayload.users.find((entry) => entry.username === 'CaptainPax')
    const readerAdmin = listPayload.users.find((entry) => entry.username === 'ReaderAdmin')
    assert.ok(setupUser)
    assert.ok(readerAdmin)
    assert.equal(setupUser.isBootstrapUser, true)
    assert.equal(readerAdmin.isBootstrapUser, false)
})

test('auth user management protects setup account and can reset non-protected user passwords', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const createResponse = await fetch(`${baseUrl}/api/auth/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            username: 'ReaderOne',
            password: 'Password123',
            role: 'member',
            permissions: ['moon_login'],
        }),
    })
    assert.equal(createResponse.status, 201)

    const resetResponse = await fetch(`${baseUrl}/api/auth/users/ReaderOne/reset-password`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(resetResponse.status, 200)
    const resetPayload = await resetResponse.json()
    assert.equal(resetPayload.ok, true)
    assert.equal(resetPayload.user.username, 'ReaderOne')
    assert.ok(typeof resetPayload.password === 'string' && resetPayload.password.length >= 12)

    const readerLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'ReaderOne', password: resetPayload.password}),
    })
    assert.equal(readerLoginResponse.status, 200)

    const protectedUpdateResponse = await fetch(`${baseUrl}/api/auth/users/CaptainPax`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({username: 'CaptainPax2'}),
    })
    assert.equal(protectedUpdateResponse.status, 403)

    const protectedResetResponse = await fetch(`${baseUrl}/api/auth/users/CaptainPax/reset-password`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(protectedResetResponse.status, 403)

    const protectedDeleteResponse = await fetch(`${baseUrl}/api/auth/users/CaptainPax`, {
        method: 'DELETE',
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(protectedDeleteResponse.status, 403)
})

test('auth user management routes require user_management permission', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const createResponse = await fetch(`${baseUrl}/api/auth/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            username: 'ReaderOne',
            password: 'Password123',
            role: 'member',
            permissions: ['moon_login'],
        }),
    })
    assert.equal(createResponse.status, 201)

    const readerLoginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'ReaderOne', password: 'Password123'}),
    })
    assert.equal(readerLoginResponse.status, 200)
    const readerPayload = await readerLoginResponse.json()
    const readerToken = readerPayload.token
    assert.ok(typeof readerToken === 'string' && readerToken.length > 10)

    const forbiddenListResponse = await fetch(`${baseUrl}/api/auth/users`, {
        headers: {Authorization: `Bearer ${readerToken}`},
    })
    assert.equal(forbiddenListResponse.status, 403)
})

test('login requires moon_login permission', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: false}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const createResponse = await fetch(`${baseUrl}/api/auth/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            username: 'NoLoginUser',
            password: 'Password123',
            role: 'member',
            permissions: [],
        }),
    })
    assert.equal(createResponse.status, 201)

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'NoLoginUser', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 403)
    const payload = await loginResponse.json()
    assert.equal(payload.error, 'Moon login permission is required for this account.')
})

test('settings debug routes read and update live debug mode', async (t) => {
    const vault = createVaultAuthStub({
        settings: [{key: 'noona.debug', enabled: false, updatedAt: '2026-01-01T00:00:00.000Z'}],
    })
    const debugCalls = []
    const setupClient = {
        async setDebug(enabled) {
            debugCalls.push(enabled)
            return {enabled}
        },
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        setupClient,
        ravenClient: createRavenStub({
            async setDebug() {
                return {enabled: true}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})

    const getRes = await fetch(`${baseUrl}/api/settings/debug`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(getRes.status, 200)
    assert.deepEqual(await getRes.json(), {
        key: 'noona.debug',
        enabled: false,
        updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const putRes = await fetch(`${baseUrl}/api/settings/debug`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({enabled: true}),
    })
    assert.equal(putRes.status, 200)
    const putPayload = await putRes.json()
    assert.equal(putPayload.key, 'noona.debug')
    assert.equal(putPayload.enabled, true)
    assert.ok(typeof putPayload.updatedAt === 'string')
    assert.deepEqual(debugCalls, [true])

    const stored = vault.settingDocs.find((entry) => entry.key === 'noona.debug')
    assert.ok(stored)
    assert.equal(stored.enabled, true)
})

test('settings factory reset route requires valid password and wipes storage before restart', async (t) => {
    const vault = createVaultAuthStub()
    const wipeCalls = []
    vault.client.mongo.wipe = async () => {
        wipeCalls.push('mongo')
        return {status: 'ok'}
    }
    vault.client.redis.wipe = async () => {
        wipeCalls.push('redis')
        return {status: 'ok'}
    }

    const restartCalls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        setupClient: {
            async factoryResetEcosystem(options = {}) {
                restartCalls.push(options)
                return {
                    ok: true,
                    ravenDownloads: {
                        requested: true,
                        mountCount: 0,
                        entries: [],
                        deleted: true,
                    },
                    dockerCleanup: {
                        requested: true,
                        containersRemoved: ['c-sage'],
                        imagesRemoved: ['img-sage'],
                        containerErrors: [],
                        imageErrors: [],
                    },
                }
            },
        },
        settings: {
            baseUrl: 'https://noona.local',
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token, password} = await bootstrapAdminAndLogin({baseUrl})
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const badRes = await fetch(`${baseUrl}/api/settings/factory-reset`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({password: 'WrongPassword123'}),
    })
    assert.equal(badRes.status, 401)
    const badPayload = await badRes.json()
    assert.equal(badPayload.error, 'Invalid password.')

    const okRes = await fetch(`${baseUrl}/api/settings/factory-reset`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({password, deleteRavenDownloads: true, deleteDockers: true}),
    })
    assert.equal(okRes.status, 202)
    const okPayload = await okRes.json()
    assert.equal(okPayload.ok, true)
    assert.equal(okPayload.restartQueued, true)
    assert.equal(okPayload.deleteRavenDownloads, true)
    assert.equal(okPayload.deleteDockers, true)
    assert.equal(okPayload.redirectTo, 'https://noona.local')
    assert.equal(okPayload.result?.ok, true)
    assert.equal(okPayload.result?.ravenDownloads?.deleted, true)
    assert.equal(okPayload.result?.dockerCleanup?.requested, true)

    assert.deepEqual(wipeCalls, ['mongo', 'redis'])
    assert.deepEqual(restartCalls, [{
        deleteRavenDownloads: true,
        deleteDockers: true,
        setupCompleted: false,
        forceFull: false,
    }])
})

test('settings factory reset route fails when selected cleanup targets are not fully deleted', async (t) => {
    const vault = createVaultAuthStub()
    vault.client.mongo.wipe = async () => ({status: 'ok'})
    vault.client.redis.wipe = async () => ({status: 'ok'})
    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        setupClient: {
            async factoryResetEcosystem() {
                return {
                    ok: true,
                    ravenDownloads: {
                        requested: true,
                        mountCount: 1,
                        entries: [{
                            target: '/srv/noona/raven',
                            destination: '/kavita-data',
                            type: 'bind',
                            deleted: false,
                            reason: 'permission denied',
                        }],
                        deleted: false,
                    },
                    dockerCleanup: {
                        requested: true,
                        containersRemoved: [],
                        imagesRemoved: [],
                        containerErrors: [],
                        imageErrors: [],
                    },
                }
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token, password} = await bootstrapAdminAndLogin({baseUrl})
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const response = await fetch(`${baseUrl}/api/settings/factory-reset`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            password,
            deleteRavenDownloads: true,
            deleteDockers: true,
        }),
    })
    assert.equal(response.status, 502)
    const payload = await response.json()
    assert.match(payload.error, /cleanup errors/i)
    assert.match(payload.error, /permission denied/i)
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
