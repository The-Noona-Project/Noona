// services/sage/tests/sageApp.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import crypto from 'node:crypto'

import {ChannelType, GatewayIntentBits} from 'discord.js'

import {createSageApp, normalizeServiceInstallPayload, SetupValidationError, startSage,} from '../app/createSageApp.mjs'
import {WardenUpstreamHttpError} from '../app/createSetupClient.mjs'
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
    async checkAvailableLibraryImports() {
        throw new Error('checkAvailableLibraryImports should not be called')
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
    async getTitleDetails() {
        throw new Error('getTitleDetails should not be called')
    },
    async queueDownload() {
        throw new Error('queueDownload should not be called')
    },
    async queueDownloadDetailed() {
        throw new Error('queueDownloadDetailed should not be called')
    },
    async getDownloadStatus() {
        throw new Error('getDownloadStatus should not be called')
    },
    async pauseDownloads() {
        throw new Error('pauseDownloads should not be called')
    },
    async getVpnStatus() {
        throw new Error('getVpnStatus should not be called')
    },
    async getVpnRegions() {
        throw new Error('getVpnRegions should not be called')
    },
    async rotateVpnNow() {
        throw new Error('rotateVpnNow should not be called')
    },
    async testVpnLogin() {
        throw new Error('testVpnLogin should not be called')
    },
    ...overrides,
})

const createPortalMetadataStub = (overrides = {}) => ({
    async searchKavitaTitles() {
        throw new Error('searchKavitaTitles should not be called')
    },
    async fetchTitleMetadataMatches() {
        throw new Error('fetchTitleMetadataMatches should not be called')
    },
    async applyTitleMetadataMatch() {
        throw new Error('applyTitleMetadataMatch should not be called')
    },
    async applyRavenTitleVolumeMap() {
        throw new Error('applyRavenTitleVolumeMap should not be called')
    },
    ...overrides,
})

const matchesQuery = (doc, query = {}) => {
    if (!query || typeof query !== 'object') {
        return true
    }

    return Object.entries(query).every(([key, value]) => doc?.[key] === value)
}

const getPathValue = (doc, path) => {
    if (!path || typeof path !== 'string') {
        return undefined
    }

    return path.split('.').reduce((current, key) => {
        if (!current || typeof current !== 'object') {
            return undefined
        }
        return current[key]
    }, doc)
}

const matchesMongoQuery = (doc, query = {}) => {
    if (!query || typeof query !== 'object') {
        return true
    }

    return Object.entries(query).every(([key, value]) => getPathValue(doc, key) === value)
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
    const LEGACY_MOON_PERMISSION_ALIASES = {
        lookup_new_title: 'library_management',
        download_new_title: 'download_management',
        check_download_missing_titles: 'download_management',
        mysubscriptions: 'mySubscriptions',
        myrecommendations: 'myRecommendations',
        managerecommendations: 'manageRecommendations',
        my_subscriptions: 'mySubscriptions',
        my_recommendations: 'myRecommendations',
        manage_recommendations: 'manageRecommendations',
    }
    const SUPPORTED_MOON_PERMISSION_KEYS = [
        'moon_login',
        'library_management',
        'download_management',
        'mySubscriptions',
        'myRecommendations',
        'manageRecommendations',
        'user_management',
        'admin',
        ...Object.keys(LEGACY_MOON_PERMISSION_ALIASES),
    ]
    const MOON_OP_PERMISSION_KEYS = [
        'moon_login',
        'library_management',
        'download_management',
        'mySubscriptions',
        'myRecommendations',
        'manageRecommendations',
        'user_management',
        'admin',
    ]
    const DEFAULT_MEMBER_PERMISSION_KEYS = [
        'moon_login',
        'library_management',
        'download_management',
        'mySubscriptions',
        'myRecommendations',
    ]
    const sortPermissions = (permissions = []) => {
        const set = new Set(Array.isArray(permissions) ? permissions : [])
        return MOON_OP_PERMISSION_KEYS.filter((entry) => set.has(entry))
    }
    const normalizePermissionKey = (value) => normalizeString(value).toLowerCase()
    const applyPermissionDependencies = (permissions = []) => {
        const next = new Set(Array.isArray(permissions) ? permissions : [])
        if (next.has('manageRecommendations')) {
            next.add('myRecommendations')
        }
        return Array.from(next)
    }
    const normalizePermissions = (value) => {
        if (!Array.isArray(value)) {
            return []
        }

        const next = []
        for (const entry of value) {
            const rawKey = normalizePermissionKey(entry)
            if (!rawKey || !SUPPORTED_MOON_PERMISSION_KEYS.includes(rawKey)) {
                continue
            }
            next.push(LEGACY_MOON_PERMISSION_ALIASES[rawKey] ?? rawKey)
        }
        return sortPermissions(applyPermissionDependencies(Array.from(new Set(next))))
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
                async delete(collectionName, query = {}) {
                    const target = collectionName === 'noona_users' ? userDocs : collectionName === 'noona_settings' ? settingDocs : []
                    const index = target.findIndex((doc) => matchesQuery(doc, query))
                    if (index < 0) {
                        return {status: 'ok', deleted: 0}
                    }
                    target.splice(index, 1)
                    return {status: 'ok', deleted: 1}
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

test('createDiscordSetupClient falls back to Discord REST resources when guild role fetch returns empty', async () => {
    const fetchCalls = []
    const setupClient = createDiscordSetupClient({
        serviceName: 'test-sage',
        logger: {
            error: () => {
            },
            info: () => {
            },
        },
        fetchImpl: async (url) => {
            fetchCalls.push(String(url))

            if (String(url).endsWith('/roles')) {
                return {
                    ok: true,
                    async json() {
                        return [
                            {id: 'role-1', name: 'Members', managed: false, position: 3, color: 0},
                            {id: 'role-2', name: 'Bot Managed', managed: true, position: 4, color: 0},
                        ]
                    },
                }
            }

            if (String(url).endsWith('/channels')) {
                return {
                    ok: true,
                    async json() {
                        return [
                            {id: 'channel-1', name: 'general', type: 0},
                        ]
                    },
                }
            }

            throw new Error(`Unexpected URL: ${url}`)
        },
        createClient() {
            return {
                async login() {
                },
                destroy() {
                },
                async fetchApplication() {
                    return {id: 'client-123', name: 'Noona Portal'}
                },
                async fetchGuilds() {
                    return [{id: 'guild-123', name: 'Guild Name', description: null, icon: null}]
                },
                async fetchGuildById() {
                    return {
                        id: 'guild-123',
                        name: 'Guild Name',
                        description: null,
                        icon: null,
                        roles: {
                            async fetch() {
                                return []
                            }
                        },
                        channels: {
                            async fetch() {
                                return []
                            }
                        },
                    }
                },
            }
        },
    })

    const payload = await setupClient.fetchResources({token: 'token', guildId: 'guild-123'})

    assert.deepEqual(payload.roles, [
        {
            id: 'role-1',
            name: 'Members',
            color: 0,
            position: 3,
            managed: false,
        },
    ])
    assert.deepEqual(payload.channels, [
        {
            id: 'channel-1',
            name: 'general',
            type: 0,
        },
    ])
    assert.ok(fetchCalls.some((entry) => entry.endsWith('/guilds/guild-123/roles')))
    assert.ok(fetchCalls.some((entry) => entry.endsWith('/guilds/guild-123/channels')))
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

test('GET /api/setup/services requests the full catalog from Warden by default', async (t) => {
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

    assert.deepEqual(fetchCalls, ['http://warden.local/api/services?includeInstalled=true'])
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
        'http://unreachable.local:4001/api/services?includeInstalled=true',
        'http://warden-ok.local:4001/api/services?includeInstalled=true',
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
    assert.deepEqual(await response.json(), {
        results: [{name: 'noona-sage', status: 'installed'}],
        accepted: false,
        started: false,
        alreadyRunning: false,
        progress: null,
    })
    assert.deepEqual(calls, [[{ name: 'noona-sage', env: { DEBUG: 'true' } }]])
})

test('POST /api/setup/install forwards async install mode to setup client', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices(services, options) {
                calls.push({services, options})
                return {
                    status: 202,
                    results: [],
                    accepted: true,
                    started: true,
                    alreadyRunning: false,
                    progress: {status: 'installing', percent: 0, items: [{name: 'noona-kavita', status: 'pending'}]},
                }
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/install?async=true`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({services: [{name: 'noona-kavita'}]}),
    })

    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), {
        results: [],
        accepted: true,
        started: true,
        alreadyRunning: false,
        progress: {status: 'installing', percent: 0, items: [{name: 'noona-kavita', status: 'pending'}]},
    })
    assert.deepEqual(calls, [{
        services: [{name: 'noona-kavita'}],
        options: {async: true},
    }])
})

test('POST /api/setup/install allows persisted setup installs with no explicit services', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices(services) {
                calls.push(services)
                return {status: 202, results: [], accepted: true, started: true, alreadyRunning: false, progress: null}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/install`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({services: []}),
    })

    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), {
        results: [],
        accepted: true,
        started: true,
        alreadyRunning: false,
        progress: null,
    })
    assert.deepEqual(calls, [[]])
})

test('POST /api/setup/install validates explicit service payloads', async (t) => {
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
        body: JSON.stringify({services: ['   ']}),
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

test('setupClient.installServices can request async forwarding to Warden', async (t) => {
    const bodies = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setup: {
            baseUrl: 'http://warden.local',
            fetchImpl: async (url, options = {}) => {
                bodies.push({url, body: options.body})
                return {
                    ok: true,
                    status: 202,
                    async json() {
                        return {accepted: true, started: true, alreadyRunning: false}
                    },
                }
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/install?async=true`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({services: ['noona-sage']}),
    })

    assert.equal(response.status, 202)
    await response.json()

    assert.equal(bodies.length, 1)
    assert.equal(bodies[0].url, 'http://warden.local/api/services/install?async=true')
    const parsedBody = JSON.parse(bodies[0].body)
    assert.deepEqual(parsedBody.services, [{name: 'noona-sage'}])
})

test('setupClient.installServices can forward the persisted setup profile without an explicit services array', async (t) => {
    const bodies = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setup: {
            baseUrl: 'http://warden.local',
            fetchImpl: async (url, options = {}) => {
                bodies.push({url, body: options.body})
                return {
                    ok: true,
                    status: 202,
                    async json() {
                        return {accepted: true, started: true, alreadyRunning: false, progress: null}
                    },
                }
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/install?async=true`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({}),
    })

    assert.equal(response.status, 202)
    await response.json()

    assert.equal(bodies.length, 1)
    assert.equal(bodies[0].url, 'http://warden.local/api/services/install?async=true')
    assert.deepEqual(JSON.parse(bodies[0].body), {})
})

test('setupClient forwards Warden bearer auth when a WARDEN_API_TOKEN is configured', async (t) => {
    const requests = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setup: {
            baseUrl: 'http://warden.local',
            env: {
                WARDEN_API_TOKEN: 'warden-secret',
            },
            fetchImpl: async (url, options = {}) => {
                requests.push({url, headers: options.headers})
                return {
                    ok: true,
                    status: 200,
                    async json() {
                        return {services: []}
                    },
                }
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services`)
    assert.equal(response.status, 200)
    await response.json()

    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'http://warden.local/api/services?includeInstalled=true')
    assert.equal(requests[0].headers.Authorization, 'Bearer warden-secret')
})

test('setup routes proxy setup config and storage layout through the setup client', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            listServices: async () => [],
            installServices: async () => ({status: 200, results: []}),
            getStorageLayout: async () => {
                calls.push('layout')
                return {root: '/srv/noona', services: []}
            },
            getSetupConfig: async () => {
                calls.push('get-config')
                return {
                    exists: true,
                    path: '/srv/noona/wardenm/noona-settings.json',
                    snapshot: {version: 2},
                    error: null
                }
            },
            saveSetupConfig: async (payload) => {
                calls.push({save: payload})
                return {exists: true, snapshot: payload}
            },
            normalizeSetupConfig: async (payload) => {
                calls.push({normalize: payload})
                return {snapshot: {version: 3, discord: {botToken: 'bot-token'}}}
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const layoutResponse = await fetch(`${baseUrl}/api/setup/layout`)
    assert.equal(layoutResponse.status, 200)
    assert.deepEqual(await layoutResponse.json(), {root: '/srv/noona', services: []})

    const configResponse = await fetch(`${baseUrl}/api/setup/config`)
    assert.equal(configResponse.status, 200)
    assert.deepEqual(await configResponse.json(), {
        exists: true,
        path: '/srv/noona/wardenm/noona-settings.json',
        snapshot: {version: 2},
        error: null,
    })

    const payload = {version: 2, selected: ['noona-portal']}
    const saveResponse = await fetch(`${baseUrl}/api/setup/config`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    })
    assert.equal(saveResponse.status, 200)
    assert.deepEqual(await saveResponse.json(), {
        exists: true,
        snapshot: payload,
    })

    const normalizeResponse = await fetch(`${baseUrl}/api/setup/config/normalize`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
    })
    assert.equal(normalizeResponse.status, 200)
    assert.deepEqual(await normalizeResponse.json(), {
        snapshot: {version: 3, discord: {botToken: 'bot-token'}},
    })
    assert.deepEqual(calls, ['layout', 'get-config', {save: payload}, {normalize: payload}])
})

test('setup config routes preserve upstream Warden validation errors', async (t) => {
    const invalidStorageError = new WardenUpstreamHttpError({
        status: 400,
        payload: {
            error: "storageRoot must stay within Warden's managed Noona data root (/srv/noona).",
        },
    })
    const normalizeError = new WardenUpstreamHttpError({
        status: 400,
        payload: {
            error: 'Older setup profiles must be reviewed before they can be saved.',
        },
    })

    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            listServices: async () => [],
            installServices: async () => ({status: 200, results: []}),
            getSetupConfig: async () => ({
                exists: false,
                path: null,
                snapshot: null,
                error: null,
            }),
            saveSetupConfig: async () => {
                throw invalidStorageError
            },
            normalizeSetupConfig: async () => {
                throw normalizeError
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const saveResponse = await fetch(`${baseUrl}/api/setup/config`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({version: 2, selected: ['noona-portal']}),
    })
    assert.equal(saveResponse.status, 400)
    assert.deepEqual(await saveResponse.json(), {
        error: "storageRoot must stay within Warden's managed Noona data root (/srv/noona).",
    })

    const normalizeResponse = await fetch(`${baseUrl}/api/setup/config/normalize`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({version: 2, selected: ['noona-portal']}),
    })
    assert.equal(normalizeResponse.status, 400)
    assert.deepEqual(await normalizeResponse.json(), {
        error: 'Older setup profiles must be reviewed before they can be saved.',
    })
})

test('GET /api/setup/status returns completion, config, progress, and debug state', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            listServices: async () => [],
            installServices: async () => ({status: 200, results: []}),
            getSetupConfig: async () => ({
                exists: true,
                path: '/srv/noona/wardenm/noona-settings.json',
                snapshot: {version: 3},
                error: null,
            }),
            getInstallProgress: async () => ({
                items: [{name: 'noona-kavita', status: 'installing'}],
                status: 'installing',
                percent: 30,
            }),
        },
        vaultClient: {
            mongo: {
                findOne: async (_collection, query = {}) => query?.key === 'noona.debug'
                    ? {enabled: true}
                    : null,
            },
        },
        wizardStateClient: {
            loadState: async () => ({completed: true}),
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/status`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
        completed: true,
        configured: true,
        installing: true,
        debugEnabled: true,
    })
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

test('GET /api/recommendations returns Vault recommendation records sorted by requestedAt', async (t) => {
    const calls = []
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            calls.push([collection, query])
            return [
                {
                    _id: 'rec-old',
                    source: 'discord',
                    status: 'pending',
                    requestedAt: '2025-01-01T00:00:00.000Z',
                    query: 'Solo Leveling',
                    title: 'Solo Leveling',
                    href: 'https://example.test/solo',
                    requestedBy: {
                        discordId: '111',
                        tag: 'old-user',
                    },
                    discordContext: {
                        guildId: 'guild-1',
                        channelId: 'channel-1',
                    },
                },
                {
                    _id: {toHexString: () => 'rec-new'},
                    source: 'discord',
                    status: 'pending',
                    requestedAt: '2025-02-01T00:00:00.000Z',
                    query: 'One Piece',
                    title: 'One Piece',
                    href: 'https://example.test/one-piece',
                    requestedBy: {
                        discordId: '222',
                        tag: 'new-user',
                    },
                    discordContext: {
                        guildId: 'guild-1',
                        channelId: 'channel-1',
                    },
                },
            ]
        }

        return originalFindMany(collection, query)
    }
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

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations?limit=1`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.equal(payload.collection, 'portal_recommendations')
    assert.equal(payload.canManage, true)
    assert.equal(payload.limit, 1)
    assert.equal(payload.total, 2)
    assert.equal(payload.recommendations.length, 1)
    assert.equal(payload.recommendations[0].id, 'rec-new')
    assert.equal(payload.recommendations[0].title, 'One Piece')
    assert.deepEqual(calls, [['portal_recommendations', {}]])
})

test('GET /api/recommendations preserves Raven download timeline event types', async (t) => {
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return [
                {
                    _id: 'rec-raven-timeline-1',
                    source: 'discord',
                    status: 'approved',
                    requestedAt: '2025-02-01T00:00:00.000Z',
                    approvedAt: '2025-02-01T00:05:00.000Z',
                    query: 'Solo Leveling',
                    title: 'Solo Leveling',
                    requestedBy: {
                        discordId: '111',
                        tag: 'requester',
                    },
                    timeline: [
                        {
                            id: 'event-created',
                            type: 'created',
                            createdAt: '2025-02-01T00:00:00.000Z',
                            actor: {
                                role: 'user',
                                discordId: '111',
                                tag: 'requester',
                            },
                        },
                        {
                            id: 'event-download-started',
                            type: 'download-started',
                            createdAt: '2025-02-01T00:06:00.000Z',
                            actor: {
                                role: 'system',
                                username: 'Raven',
                            },
                            body: 'Raven started downloading 12 chapters.',
                        },
                        {
                            id: 'event-download-progress',
                            type: 'download-progress',
                            createdAt: '2025-02-01T00:07:00.000Z',
                            actor: {
                                role: 'system',
                                username: 'Raven',
                            },
                            body: 'Raven downloaded 6 of 12 chapters so far.',
                        },
                        {
                            id: 'event-download-completed',
                            type: 'download-completed',
                            createdAt: '2025-02-01T00:09:00.000Z',
                            actor: {
                                role: 'system',
                                username: 'Raven',
                            },
                            body: 'Raven finished downloading 12 chapters.',
                        },
                    ],
                },
            ]
        }

        return originalFindMany(collection, query)
    }
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

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.equal(payload.recommendations.length, 1)
    assert.deepEqual(
        payload.recommendations[0]?.timeline?.map((event) => event?.type),
        ['created', 'approved', 'download-started', 'download-progress', 'download-completed'],
    )
    assert.equal(payload.recommendations[0]?.timeline?.[2]?.actor?.username, 'Raven')
    assert.equal(payload.recommendations[0]?.timeline?.[4]?.body, 'Raven finished downloading 12 chapters.')
})

test('GET /api/myrecommendations allows myRecommendations users and marks non-managers', async (t) => {
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationReader',
        password: 'Password123',
        permissions: ['moon_login', 'myRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return [
                {
                    _id: 'rec-1',
                    title: 'One Piece',
                    requestedAt: '2025-01-01T00:00:00.000Z',
                    requestedBy: {discordId: '111'},
                },
            ]
        }
        return originalFindMany(collection, query)
    }

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

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationReader', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const forbiddenAdminResponse = await fetch(`${baseUrl}/api/recommendations`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(forbiddenAdminResponse.status, 403)

    const response = await fetch(`${baseUrl}/api/myrecommendations`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.canManage, false)
    assert.ok(Array.isArray(payload.recommendations))
    assert.equal(payload.recommendations.length, 0)
})

test('GET /api/mysubscriptions returns only subscriptions owned by the signed-in Discord user', async (t) => {
    const ownerDiscordId = '111111111111111111'
    const otherDiscordId = '222222222222222222'
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'SubscriptionReader',
        password: 'Password123',
        permissions: ['moon_login', 'mySubscriptions'],
    })
    const readerUser = vault.userDocs.find((entry) => entry.usernameNormalized === 'subscriptionreader')
    assert.ok(readerUser)
    readerUser.authProvider = 'local'
    readerUser.discordUserId = ownerDiscordId

    const subscriptions = [
        {
            _id: 'sub-1',
            source: 'discord',
            status: 'active',
            subscribedAt: '2026-03-08T00:00:00.000Z',
            title: 'Solo Leveling',
            titleQuery: 'solo leveling',
            subscriber: {
                discordId: ownerDiscordId,
                tag: 'Member#1111',
            },
            notifications: {
                chapterDmCount: 2,
                lastChapterDmAt: '2026-03-08T01:00:00.000Z',
            },
        },
        {
            _id: 'sub-2',
            source: 'discord',
            status: 'active',
            subscribedAt: '2026-03-08T00:10:00.000Z',
            title: 'Omniscient Reader',
            subscriber: {
                discordId: otherDiscordId,
                tag: 'Member#2222',
            },
        },
    ]

    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_subscriptions') {
            return subscriptions.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }

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

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'SubscriptionReader', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/mysubscriptions`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.equal(payload.total, 1)
    assert.ok(Array.isArray(payload.subscriptions))
    assert.equal(payload.subscriptions.length, 1)
    assert.equal(payload.subscriptions[0]?.id, 'sub-1')
    assert.equal(payload.subscriptions[0]?.title, 'Solo Leveling')
    assert.equal(payload.subscriptions[0]?.status, 'active')
    assert.equal(payload.subscriptions[0]?.subscriber?.discordId, ownerDiscordId)
})

test('DELETE /api/mysubscriptions/:id marks owned active subscriptions as inactive', async (t) => {
    const ownerDiscordId = '111111111111111111'
    const otherDiscordId = '222222222222222222'
    const updateCalls = []
    const subscriptions = [
        {
            _id: 'sub-active-1',
            source: 'discord',
            status: 'active',
            subscribedAt: '2026-03-08T00:00:00.000Z',
            title: 'Solo Leveling',
            titleQuery: 'solo leveling',
            titleUuid: 'title-uuid-1',
            subscriber: {
                discordId: ownerDiscordId,
                tag: 'Member#1111',
            },
            notifications: {
                chapterDmCount: 3,
                lastChapterDmAt: '2026-03-08T01:00:00.000Z',
            },
        },
        {
            _id: 'sub-other-1',
            source: 'discord',
            status: 'active',
            subscribedAt: '2026-03-08T00:05:00.000Z',
            title: 'Omniscient Reader',
            subscriber: {
                discordId: otherDiscordId,
            },
        },
    ]

    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'SubscriptionReader',
        password: 'Password123',
        permissions: ['moon_login', 'mySubscriptions'],
    })
    const readerUser = vault.userDocs.find((entry) => entry.usernameNormalized === 'subscriptionreader')
    assert.ok(readerUser)
    readerUser.authProvider = 'local'
    readerUser.discordUserId = ownerDiscordId

    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_subscriptions') {
            return subscriptions.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.update = async (collection, query = {}, update = {}, options = {}) => {
        if (collection !== 'portal_subscriptions') {
            return {status: 'ok', matched: 0, modified: 0}
        }

        updateCalls.push([collection, query, update, options])
        const index = subscriptions.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        subscriptions[index] = applyMongoUpdate({...subscriptions[index]}, update, {isInsert: false})
        return {status: 'ok', matched: 1, modified: 1}
    }

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

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'SubscriptionReader', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/mysubscriptions/sub-active-1`, {
        method: 'DELETE',
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.id, 'sub-active-1')
    assert.equal(payload.subscription?.id, 'sub-active-1')
    assert.equal(payload.subscription?.status, 'inactive')
    assert.ok(typeof payload.subscription?.unsubscribedAt === 'string')

    assert.equal(updateCalls.length, 1)
    assert.deepEqual(updateCalls[0][0], 'portal_subscriptions')
    assert.deepEqual(updateCalls[0][1], {_id: 'sub-active-1'})
    assert.equal(updateCalls[0][2]?.$set?.status, 'inactive')
    assert.ok(typeof updateCalls[0][2]?.$set?.unsubscribedAt === 'string')
})

test('DELETE /api/recommendations/:id allows manageRecommendations users to close entries', async (t) => {
    const deleteCalls = []
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return [
                {
                    _id: 'rec-delete-1',
                    title: 'One Piece',
                    requestedAt: '2025-01-01T00:00:00.000Z',
                    requestedBy: {discordId: '111'},
                },
            ]
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.delete = async (collection, query = {}) => {
        deleteCalls.push([collection, query])
        return {status: 'ok', deleted: 1}
    }

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

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-delete-1`, {
        method: 'DELETE',
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
        ok: true,
        deleted: 1,
        id: 'rec-delete-1',
    })
    assert.deepEqual(deleteCalls, [['portal_recommendations', {_id: 'rec-delete-1'}]])
})

test('GET /api/recommendations/:id includes sourceAdultContent from the stored recommendation', async (t) => {
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })

    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return [
                {
                    _id: 'rec-source-adult-1',
                    source: 'discord',
                    status: 'pending',
                    requestedAt: '2026-03-10T00:00:00.000Z',
                    query: 'Ore no Level Up ga Okashii!',
                    searchId: 'search-source-adult-1',
                    selectedOptionIndex: 1,
                    title: 'Ore no Level Up ga Okashii!',
                    href: 'https://weebcentral.com/series/017J6XGG6KRM1YDSXY4JENCO9B/ore-no-level-up-ga-okashi-dekiru-otoko-no-isekai-tensei',
                    sourceAdultContent: true,
                    requestedBy: {
                        discordId: '111',
                        tag: 'requester',
                    },
                },
            ]
        }
        return originalFindMany(collection, query)
    }

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

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-source-adult-1`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)

    const payload = await response.json()
    assert.equal(payload.recommendation?.id, 'rec-source-adult-1')
    assert.equal(payload.recommendation?.sourceAdultContent, true)
})

test('DELETE /api/recommendations/:id retries fallback query for serialized recommendation ids', async (t) => {
    const deleteCalls = []
    const recommendations = [
        {
            _id: '507f1f77bcf86cd799439011',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'One Piece',
            searchId: 'search-serialized-delete',
            selectedOptionIndex: 2,
            title: 'One Piece',
            href: 'https://example.test/one-piece',
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
            discordContext: {
                guildId: 'guild-1',
                channelId: 'channel-1',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.delete = async (collection, query = {}) => {
        deleteCalls.push([collection, query])
        if (collection !== 'portal_recommendations') {
            return {status: 'ok', deleted: 0}
        }

        if (Object.prototype.hasOwnProperty.call(query, '_id')) {
            return {status: 'ok', deleted: 0}
        }

        const index = recommendations.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', deleted: 0}
        }

        recommendations.splice(index, 1)
        return {status: 'ok', deleted: 1}
    }

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

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/507f1f77bcf86cd799439011`, {
        method: 'DELETE',
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
        ok: true,
        deleted: 1,
        id: '507f1f77bcf86cd799439011',
    })
    assert.equal(deleteCalls.length, 2)
    assert.deepEqual(deleteCalls[0][1], {_id: '507f1f77bcf86cd799439011'})
    assert.ok(!Object.prototype.hasOwnProperty.call(deleteCalls[1][1], '_id'))
    assert.equal(recommendations.length, 0)
})

test('POST /api/recommendations/:id/approve queues Raven downloads for manageRecommendations users', async (t) => {
    const queueCalls = []
    const updateCalls = []
    const recommendations = [
        {
            _id: 'rec-approve-1',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'One Piece',
            searchId: 'search-123',
            selectedOptionIndex: 2,
            title: 'One Piece',
            href: 'https://example.test/one-piece',
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.update = async (collection, query = {}, update = {}, options = {}) => {
        updateCalls.push([collection, query, update, options])
        if (collection !== 'portal_recommendations') {
            return {status: 'ok', matched: 0, modified: 0}
        }

        const index = recommendations.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        recommendations[index] = applyMongoUpdate({...recommendations[index]}, update, {isInsert: false})
        return {status: 'ok', matched: 1, modified: 1}
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
        portalClient: createPortalMetadataStub({
            async searchKavitaTitles() {
                return {series: []}
            },
        }),
        ravenClient: createRavenStub({
            async queueDownload(payload) {
                queueCalls.push(payload)
                return {taskId: 'raven-task-1'}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-approve-1/approve`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.id, 'rec-approve-1')
    assert.equal(payload.recommendation?.status, 'approved')
    assert.equal(payload.recommendation?.searchId, 'search-123')
    assert.deepEqual(queueCalls, [{searchId: 'search-123', optionIndex: 2}])
    assert.equal(updateCalls.length, 1)
    assert.equal(updateCalls[0][0], 'portal_recommendations')
    assert.deepEqual(updateCalls[0][1], {_id: 'rec-approve-1'})
    assert.equal(updateCalls[0][2]?.$set?.status, 'approved')
    assert.ok(typeof updateCalls[0][2]?.$set?.approvedAt === 'string')
    assert.equal(updateCalls[0][2]?.$set?.approvedBy?.username, 'RecommendationManager')
    assert.equal(recommendations[0].status, 'approved')
})

test('POST /api/recommendations/:id/approve stores selected metadata for deferred apply', async (t) => {
    const queueCalls = []
    const recommendations = [
        {
            _id: 'rec-approve-metadata-1',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'Solo Leveling',
            searchId: 'search-metadata-123',
            selectedOptionIndex: 1,
            title: 'Solo Leveling',
            href: 'https://source.example/solo-leveling',
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.update = async (collection, query = {}, update = {}) => {
        if (collection !== 'portal_recommendations') {
            return {status: 'ok', matched: 0, modified: 0}
        }

        const index = recommendations.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        recommendations[index] = applyMongoUpdate({...recommendations[index]}, update, {isInsert: false})
        return {status: 'ok', matched: 1, modified: 1}
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
        ravenClient: createRavenStub({
            async queueDownload(payload) {
                queueCalls.push(payload)
                return {
                    taskId: 'raven-task-metadata-1',
                    titleUuid: 'title-uuid-7',
                }
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-approve-metadata-1/approve`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            metadataQuery: 'Solo Leveling',
            metadataSelection: {
                query: 'Solo Leveling',
                title: 'Solo Leveling',
                aliases: ['Only I Level Up'],
                provider: 'mal',
                providerSeriesId: '15180124327',
                summary: 'The strongest hunter returns.',
                sourceUrl: 'https://metadata.example/solo-leveling',
                coverImageUrl: 'https://covers.example/solo-leveling.jpg',
                adultContent: true,
            },
        }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.deepEqual(queueCalls, [{searchId: 'search-metadata-123', optionIndex: 1}])
    assert.equal(payload.metadataSelection?.status, 'pending')
    assert.equal(payload.metadataSelection?.provider, 'mal')
    assert.equal(payload.metadataSelection?.providerSeriesId, '15180124327')
    assert.equal(payload.metadataSelection?.adultContent, true)
    assert.deepEqual(payload.metadataSelection?.aliases, ['Only I Level Up'])
    assert.equal(payload.metadataSelection?.titleUuid, 'title-uuid-7')
    assert.ok(Array.isArray(payload.recommendation?.timeline))
    const metadataComment = payload.recommendation.timeline.find((event) =>
        event?.type === 'comment' && /Queued metadata plan/i.test(event?.body ?? ''))
    assert.ok(metadataComment)
    assert.equal(metadataComment?.actor?.username, 'Moon')
    assert.equal(recommendations[0]?.metadataSelection?.status, 'pending')
    assert.equal(recommendations[0]?.metadataSelection?.adultContent, true)
    assert.deepEqual(recommendations[0]?.metadataSelection?.aliases, ['Only I Level Up'])
    assert.equal(recommendations[0]?.metadataSelection?.titleUuid, 'title-uuid-7')
})

test('POST /api/recommendations/:id/approve pre-seeds Raven volume metadata before queueing confirmed matches', async (t) => {
    const callOrder = []
    const recommendations = [
        {
            _id: 'rec-approve-preseed-1',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'Solo Leveling',
            searchId: 'search-preseed-123',
            selectedOptionIndex: 1,
            title: 'Solo Leveling',
            href: 'https://source.example/solo-leveling',
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.update = async (collection, query = {}, update = {}) => {
        if (collection !== 'portal_recommendations') {
            return {status: 'ok', matched: 0, modified: 0}
        }

        const index = recommendations.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        recommendations[index] = applyMongoUpdate({...recommendations[index]}, update, {isInsert: false})
        return {status: 'ok', matched: 1, modified: 1}
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
        portalClient: createPortalMetadataStub({
            async applyRavenTitleVolumeMap(payload) {
                callOrder.push({type: 'volume-map', payload})
                return {status: 'applied', mappedChapterCount: 12}
            },
        }),
        ravenClient: createRavenStub({
            async createTitle(payload) {
                callOrder.push({type: 'create-title', payload})
                return {uuid: 'title-uuid-preseed-1'}
            },
            async queueDownload(payload) {
                callOrder.push({type: 'queue-download', payload})
                return {taskId: 'raven-task-preseed-1'}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-approve-preseed-1/approve`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            metadataQuery: 'Solo Leveling',
            metadataSelection: {
                query: 'Solo Leveling',
                title: 'Solo Leveling',
                provider: 'mal',
                providerSeriesId: '15180124327',
            },
        }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.deepEqual(callOrder, [
        {
            type: 'create-title',
            payload: {
                title: 'Solo Leveling',
                sourceUrl: 'https://source.example/solo-leveling',
            },
        },
        {
            type: 'volume-map',
            payload: {
                titleUuid: 'title-uuid-preseed-1',
                provider: 'mal',
                providerSeriesId: '15180124327',
                autoRename: false,
            },
        },
        {
            type: 'queue-download',
            payload: {
                searchId: 'search-preseed-123',
                optionIndex: 1,
            },
        },
    ])
    assert.equal(payload.recommendation?.status, 'approved')
    assert.equal(payload.metadataSelection?.titleUuid, 'title-uuid-preseed-1')
    assert.equal(recommendations[0]?.metadataSelection?.titleUuid, 'title-uuid-preseed-1')
})

test('POST /api/recommendations/:id/approve keeps queueing when Raven volume pre-seeding fails', async (t) => {
    const callOrder = []
    const recommendations = [
        {
            _id: 'rec-approve-preseed-fail-1',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'Solo Leveling',
            searchId: 'search-preseed-fail-123',
            selectedOptionIndex: 1,
            title: 'Solo Leveling',
            href: 'https://source.example/solo-leveling',
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.update = async (collection, query = {}, update = {}) => {
        if (collection !== 'portal_recommendations') {
            return {status: 'ok', matched: 0, modified: 0}
        }

        const index = recommendations.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        recommendations[index] = applyMongoUpdate({...recommendations[index]}, update, {isInsert: false})
        return {status: 'ok', matched: 1, modified: 1}
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
        portalClient: createPortalMetadataStub({
            async applyRavenTitleVolumeMap(payload) {
                callOrder.push({type: 'volume-map', payload})
                throw new Error('Komf unavailable')
            },
        }),
        ravenClient: createRavenStub({
            async createTitle(payload) {
                callOrder.push({type: 'create-title', payload})
                return {uuid: 'title-uuid-preseed-fail-1'}
            },
            async queueDownload(payload) {
                callOrder.push({type: 'queue-download', payload})
                return {
                    taskId: 'raven-task-preseed-fail-1',
                    titleUuid: 'title-uuid-from-queue-1',
                }
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-approve-preseed-fail-1/approve`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            metadataQuery: 'Solo Leveling',
            metadataSelection: {
                query: 'Solo Leveling',
                title: 'Solo Leveling',
                provider: 'mal',
                providerSeriesId: '15180124327',
            },
        }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.deepEqual(callOrder, [
        {
            type: 'create-title',
            payload: {
                title: 'Solo Leveling',
                sourceUrl: 'https://source.example/solo-leveling',
            },
        },
        {
            type: 'volume-map',
            payload: {
                titleUuid: 'title-uuid-preseed-fail-1',
                provider: 'mal',
                providerSeriesId: '15180124327',
                autoRename: false,
            },
        },
        {
            type: 'queue-download',
            payload: {
                searchId: 'search-preseed-fail-123',
                optionIndex: 1,
            },
        },
    ])
    assert.equal(payload.recommendation?.status, 'approved')
    assert.equal(payload.metadataSelection?.titleUuid, 'title-uuid-from-queue-1')
    assert.equal(recommendations[0]?.metadataSelection?.titleUuid, 'title-uuid-from-queue-1')
})

test('POST /api/recommendations/:id/approve recovers a Raven queue target from metadata aliases', async (t) => {
    const queueCalls = []
    const searchCalls = []
    const recommendations = [
        {
            _id: 'rec-approve-recover-1',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'Only I Level Up',
            searchId: null,
            selectedOptionIndex: null,
            title: 'Only I Level Up',
            href: null,
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.update = async (collection, query = {}, update = {}) => {
        if (collection !== 'portal_recommendations') {
            return {status: 'ok', matched: 0, modified: 0}
        }

        const index = recommendations.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        recommendations[index] = applyMongoUpdate({...recommendations[index]}, update, {isInsert: false})
        return {status: 'ok', matched: 1, modified: 1}
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
        ravenClient: createRavenStub({
            async searchTitle(query) {
                searchCalls.push(query)
                if (query === 'Ore no Level Up ga Okashii!') {
                    return {searchId: 'search-recover-empty', options: []}
                }
                if (query === 'Only I Level Up') {
                    return {
                        searchId: 'search-recover-hit',
                        options: [
                            {
                                index: '1',
                                title: 'Solo Leveling',
                                href: 'https://source.example/solo-leveling',
                            },
                        ],
                    }
                }
                return {searchId: 'search-recover-other', options: []}
            },
            async getTitleDetails(sourceUrl) {
                assert.equal(sourceUrl, 'https://source.example/solo-leveling')
                return {
                    sourceUrl,
                    adultContent: false,
                    associatedNames: ['Only I Level Up'],
                }
            },
            async queueDownload(payload) {
                queueCalls.push(payload)
                return {
                    taskId: 'raven-task-recovered-1',
                    titleUuid: 'title-uuid-recovered-1',
                }
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-approve-recover-1/approve`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            metadataQuery: 'Ore no Level Up ga Okashii!',
            metadataSelection: {
                query: 'Ore no Level Up ga Okashii!',
                title: 'Ore no Level Up ga Okashii!',
                aliases: ['Only I Level Up'],
                provider: 'mal',
                providerSeriesId: 'recover-1518',
            },
        }),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.deepEqual(searchCalls, ['Ore no Level Up ga Okashii!', 'Only I Level Up'])
    assert.deepEqual(queueCalls, [{searchId: 'search-recover-hit', optionIndex: 1}])
    assert.equal(payload.recommendation?.status, 'approved')
    assert.equal(payload.recommendation?.searchId, 'search-recover-hit')
    assert.equal(payload.recommendation?.selectedOptionIndex, 1)
    assert.equal(payload.recommendation?.title, 'Solo Leveling')
    assert.equal(payload.recommendation?.href, 'https://source.example/solo-leveling')
    assert.equal(payload.recommendation?.sourceAdultContent, false)
    assert.equal(recommendations[0]?.status, 'approved')
    assert.equal(recommendations[0]?.searchId, 'search-recover-hit')
    assert.equal(recommendations[0]?.selectedOptionIndex, 1)
})

test('POST /api/recommendations/:id/approve saves unmatched metadata plans for later when Raven recovery fails', async (t) => {
    const queueCalls = []
    const searchCalls = []
    const recommendations = [
        {
            _id: 'rec-approve-save-1',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'Unknown Hunter Story',
            searchId: null,
            selectedOptionIndex: null,
            title: 'Unknown Hunter Story',
            href: null,
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.update = async (collection, query = {}, update = {}) => {
        if (collection !== 'portal_recommendations') {
            return {status: 'ok', matched: 0, modified: 0}
        }

        const index = recommendations.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        recommendations[index] = applyMongoUpdate({...recommendations[index]}, update, {isInsert: false})
        return {status: 'ok', matched: 1, modified: 1}
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
        ravenClient: createRavenStub({
            async searchTitle(query) {
                searchCalls.push(query)
                return {searchId: `search-miss-${searchCalls.length}`, options: []}
            },
            async queueDownload(payload) {
                queueCalls.push(payload)
                return {taskId: 'should-not-queue'}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-approve-save-1/approve`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            metadataQuery: 'Unknown Hunter Story',
            metadataSelection: {
                query: 'Unknown Hunter Story',
                title: 'Ore no Hunter Story',
                aliases: ['Unknown Hunter Story', 'Mystery Hunter'],
                provider: 'mal',
                providerSeriesId: 'save-1518',
            },
        }),
    })
    assert.equal(response.status, 202)
    const payload = await response.json()

    assert.equal(payload.savedForLater, true)
    assert.match(payload.message, /expand our content reach/i)
    assert.equal(payload.recommendation?.status, 'pending')
    assert.equal(payload.metadataSelection?.status, 'pending')
    assert.equal(payload.metadataSelection?.lastError, payload.message)
    assert.deepEqual(queueCalls, [])
    assert.deepEqual(searchCalls, ['Ore no Hunter Story', 'Unknown Hunter Story', 'Mystery Hunter'])
    const savedComment = payload.recommendation?.timeline?.find((event) =>
        event?.type === 'comment' && /expand our content reach/i.test(event?.body ?? ''))
    assert.ok(savedComment)
    assert.equal(recommendations[0]?.status, 'pending')
    assert.equal(recommendations[0]?.metadataSelection?.lastError, payload.message)
})

test('POST /api/recommendations/:id/approve rejects invalid metadata selections before queueing Raven', async (t) => {
    const queueCalls = []
    const recommendations = [
        {
            _id: 'rec-approve-invalid-metadata-1',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'Wind Breaker',
            searchId: 'search-invalid-metadata-123',
            selectedOptionIndex: 1,
            title: 'Wind Breaker',
            href: 'https://source.example/wind-breaker',
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
        ravenClient: createRavenStub({
            async queueDownload(payload) {
                queueCalls.push(payload)
                return {taskId: 'should-not-queue'}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-approve-invalid-metadata-1/approve`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            metadataQuery: 'Wind Breaker',
            metadataSelection: {
                title: 'Wind Breaker',
            },
        }),
    })
    assert.equal(response.status, 400)
    const payload = await response.json()
    assert.match(payload.error, /valid metadata selection/i)
    assert.deepEqual(queueCalls, [])
})

test('POST /api/recommendations/:id/approve retries fallback query for serialized recommendation ids', async (t) => {
    const queueCalls = []
    const updateCalls = []
    const recommendations = [
        {
            _id: '507f1f77bcf86cd799439012',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'One Piece',
            searchId: 'search-serialized-approve',
            selectedOptionIndex: 3,
            title: 'One Piece',
            href: 'https://example.test/one-piece',
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
            discordContext: {
                guildId: 'guild-1',
                channelId: 'channel-1',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.update = async (collection, query = {}, update = {}, options = {}) => {
        updateCalls.push([collection, query, update, options])
        if (collection !== 'portal_recommendations') {
            return {status: 'ok', matched: 0, modified: 0}
        }

        if (Object.prototype.hasOwnProperty.call(query, '_id')) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        const index = recommendations.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        recommendations[index] = applyMongoUpdate({...recommendations[index]}, update, {isInsert: false})
        return {status: 'ok', matched: 1, modified: 1}
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
        portalClient: createPortalMetadataStub({
            async searchKavitaTitles() {
                return {series: []}
            },
        }),
        ravenClient: createRavenStub({
            async queueDownload(payload) {
                queueCalls.push(payload)
                return {taskId: 'raven-task-serialized'}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/507f1f77bcf86cd799439012/approve`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.id, '507f1f77bcf86cd799439012')
    assert.equal(payload.recommendation?.status, 'approved')
    assert.deepEqual(queueCalls, [{searchId: 'search-serialized-approve', optionIndex: 3}])
    assert.equal(updateCalls.length, 2)
    assert.deepEqual(updateCalls[0][1], {_id: '507f1f77bcf86cd799439012'})
    assert.ok(!Object.prototype.hasOwnProperty.call(updateCalls[1][1], '_id'))
    assert.equal(recommendations[0].status, 'approved')
})

test('POST /api/recommendations/:id/approve validates recommendation queue metadata', async (t) => {
    const queueCalls = []
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return [
                {
                    _id: 'rec-approve-2',
                    source: 'discord',
                    status: 'pending',
                    requestedAt: '2025-01-01T00:00:00.000Z',
                    query: 'One Piece',
                    selectedOptionIndex: null,
                    title: 'One Piece',
                },
            ]
        }
        return originalFindMany(collection, query)
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
        portalClient: createPortalMetadataStub({
            async searchKavitaTitles() {
                return {series: []}
            },
        }),
        ravenClient: createRavenStub({
            async queueDownload(payload) {
                queueCalls.push(payload)
                return {taskId: 'raven-task-2'}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-approve-2/approve`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 409)
    const payload = await response.json()
    assert.match(payload.error ?? '', /saved metadata match before Noona can search alternate Raven titles/i)
    assert.deepEqual(queueCalls, [])
})

test('POST /api/recommendations/:id/deny marks recommendations as denied for manageRecommendations users', async (t) => {
    const updateCalls = []
    const recommendations = [
        {
            _id: 'rec-deny-1',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'Tower of God',
            title: 'Tower of God',
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.update = async (collection, query = {}, update = {}, options = {}) => {
        updateCalls.push([collection, query, update, options])
        if (collection !== 'portal_recommendations') {
            return {status: 'ok', matched: 0, modified: 0}
        }

        const index = recommendations.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        recommendations[index] = applyMongoUpdate({...recommendations[index]}, update, {isInsert: false})
        return {status: 'ok', matched: 1, modified: 1}
    }

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

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-deny-1/deny`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({reason: 'Duplicate request'}),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.id, 'rec-deny-1')
    assert.equal(payload.recommendation?.status, 'denied')
    assert.equal(payload.recommendation?.denialReason, 'Duplicate request')
    assert.ok(Array.isArray(payload.recommendation?.timeline))
    assert.ok(payload.recommendation.timeline.some((event) => event?.type === 'denied'))
    assert.equal(updateCalls.length, 1)
    assert.equal(updateCalls[0][2]?.$set?.status, 'denied')
    assert.equal(updateCalls[0][2]?.$set?.denialReason, 'Duplicate request')
    assert.equal(recommendations[0].status, 'denied')
})

test('POST /api/recommendations/:id/comments appends admin timeline comments', async (t) => {
    const updateCalls = []
    const recommendations = [
        {
            _id: 'rec-comment-1',
            source: 'discord',
            status: 'pending',
            requestedAt: '2025-01-01T00:00:00.000Z',
            query: 'Omniscient Reader',
            title: 'Omniscient Reader',
            requestedBy: {
                discordId: '111',
                tag: 'requester',
            },
        },
    ]
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })
    const originalFindMany = vault.client.mongo.findMany
    vault.client.mongo.findMany = async (collection, query = {}) => {
        if (collection === 'portal_recommendations') {
            return recommendations.map((entry) => ({...entry}))
        }
        return originalFindMany(collection, query)
    }
    vault.client.mongo.update = async (collection, query = {}, update = {}, options = {}) => {
        updateCalls.push([collection, query, update, options])
        if (collection !== 'portal_recommendations') {
            return {status: 'ok', matched: 0, modified: 0}
        }

        const index = recommendations.findIndex((entry) => matchesMongoQuery(entry, query))
        if (index < 0) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        recommendations[index] = applyMongoUpdate({...recommendations[index]}, update, {isInsert: false})
        return {status: 'ok', matched: 1, modified: 1}
    }

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

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'RecommendationManager', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    const token = loginPayload?.token
    assert.ok(typeof token === 'string' && token.length > 10)

    const response = await fetch(`${baseUrl}/api/recommendations/rec-comment-1/comments`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({comment: 'We are checking source availability first.'}),
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.id, 'rec-comment-1')
    assert.ok(Array.isArray(payload.recommendation?.timeline))
    const commentEvent = payload.recommendation.timeline.find((event) => event?.type === 'comment')
    assert.ok(commentEvent)
    assert.equal(commentEvent.body, 'We are checking source availability first.')
    assert.equal(commentEvent.actor?.role, 'admin')
    assert.equal(updateCalls.length, 1)
    assert.ok(Array.isArray(updateCalls[0][2]?.$set?.timeline))
    assert.equal(recommendations[0].timeline?.[0]?.body, 'We are checking source availability first.')
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

test('POST /api/raven/library/imports/check proxies Raven library imports', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async checkAvailableLibraryImports() {
                calls.push('imports')
                return {manifestsFound: 2, importedTitles: 2, queuedChapters: 1}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/library/imports/check`, {method: 'POST'})
    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), {manifestsFound: 2, importedTitles: 2, queuedChapters: 1})
    assert.deepEqual(calls, ['imports'])
})

test('POST /api/raven/library/imports/check surfaces Raven errors', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async checkAvailableLibraryImports() {
                throw new Error('boom')
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/library/imports/check`, {method: 'POST'})
    assert.equal(response.status, 502)
    const payload = await response.json()
    assert.ok(payload.error.includes('Unable to check Raven library imports'))
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

test('GET /api/raven/title-details proxies Raven source-title metadata lookups', async (t) => {
    const calls = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async getTitleDetails(sourceUrl) {
                calls.push(sourceUrl)
                return {
                    sourceUrl,
                    status: 'Complete',
                    released: '2018',
                    officialTranslation: true,
                    animeAdaptation: true,
                }
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/title-details?url=${encodeURIComponent('https://source.example/solo-leveling')}`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
        sourceUrl: 'https://source.example/solo-leveling',
        status: 'Complete',
        released: '2018',
        officialTranslation: true,
        animeAdaptation: true,
    })
    assert.deepEqual(calls, ['https://source.example/solo-leveling'])
})

test('GET /api/raven/title-details validates the source url query parameter', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub(),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/title-details`)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {error: 'url is required.'})
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

test('POST /api/raven/search forwards trimmed special-character queries to Raven client', async (t) => {
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
        body: JSON.stringify({query: "  D.Gray-man & JoJo's: Part 7/Steel Ball Run? #1%+()  "}),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { results: [{ title: 'Naruto' }] })
    assert.deepEqual(queries, ["D.Gray-man & JoJo's: Part 7/Steel Ball Run? #1%+()"])
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
            async queueDownloadDetailed(payload) {
                payloads.push(payload)
                return {
                    status: 202,
                    payload: {status: 'queued', message: 'Download queued for: Naruto'},
                }
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
    assert.deepEqual(await response.json(), {status: 'queued', message: 'Download queued for: Naruto'})
    assert.deepEqual(payloads, [{ searchId: 'search-123', optionIndex: 2 }])
})

test('POST /api/raven/download rejects invalid payloads', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async queueDownloadDetailed() {
                throw new Error('queueDownloadDetailed should not run')
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
            async queueDownloadDetailed() {
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

test('POST /api/raven/download preserves Raven semantic failure statuses', async (t) => {
    const payloads = []
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async queueDownloadDetailed(payload) {
                payloads.push(payload)
                return {
                    status: 410,
                    payload: {
                        status: 'search_expired',
                        message: 'Search session expired or not found. Please search again.',
                        queuedCount: 0,
                        queuedTitles: [],
                        skippedTitles: [],
                    },
                }
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/download`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({searchId: 'stale-search', optionIndex: 1}),
    })

    assert.equal(response.status, 410)
    assert.deepEqual(await response.json(), {
        status: 'search_expired',
        message: 'Search session expired or not found. Please search again.',
        queuedCount: 0,
        queuedTitles: [],
        skippedTitles: [],
    })
    assert.deepEqual(payloads, [{searchId: 'stale-search', optionIndex: 1}])
})

test('POST /api/raven/downloads/pause proxies Raven pause requests', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async pauseDownloads() {
                return {
                    affectedTasks: 1,
                    pausedImmediately: [],
                    pausingAfterCurrentChapter: ['Solo Leveling'],
                }
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/downloads/pause`, {
        method: 'POST',
    })
    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), {
        affectedTasks: 1,
        pausedImmediately: [],
        pausingAfterCurrentChapter: ['Solo Leveling'],
    })
})

test('POST /api/raven/downloads/pause surfaces Raven failures', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        ravenClient: createRavenStub({
            async pauseDownloads() {
                throw new Error('boom')
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/raven/downloads/pause`, {
        method: 'POST',
    })
    assert.equal(response.status, 502)
    const payload = await response.json()
    assert.ok(payload.error.includes('Unable to pause Raven downloads'))
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

test('Raven routes split library and download management permissions after setup completes', async (t) => {
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'LibraryUser',
        password: 'Password123',
        permissions: ['moon_login', 'lookup_new_title'],
    })
    await vault.client.users.create({
        username: 'DownloadUser',
        password: 'Password123',
        permissions: ['moon_login', 'download_new_title'],
    })
    await vault.client.users.create({
        username: 'HomeUser',
        password: 'Password123',
        permissions: ['moon_login'],
    })
    await vault.client.users.create({
        username: 'RecommendationManager',
        password: 'Password123',
        permissions: ['moon_login', 'manageRecommendations'],
    })

    const searchQueries = []
    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        wizardStateClient: {
            async loadState() {
                return {completed: true}
            },
        },
        ravenClient: createRavenStub({
            async getLibrary() {
                return [{title: 'One Piece'}]
            },
            async getDownloadStatus() {
                return [{title: 'One Piece', status: 'queued'}]
            },
            async searchTitle(query) {
                searchQueries.push(query)
                return {results: [{title: 'One Piece'}]}
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const loginWithPassword = async (username) => {
        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password: 'Password123'}),
        })
        assert.equal(response.status, 200)
        const payload = await response.json()
        assert.ok(typeof payload.token === 'string' && payload.token.length > 10)
        return payload.token
    }

    const libraryToken = await loginWithPassword('LibraryUser')
    const downloadToken = await loginWithPassword('DownloadUser')
    const homeToken = await loginWithPassword('HomeUser')
    const recommendationManagerToken = await loginWithPassword('RecommendationManager')

    const libraryResponse = await fetch(`${baseUrl}/api/raven/library`, {
        headers: {Authorization: `Bearer ${libraryToken}`},
    })
    assert.equal(libraryResponse.status, 200)
    assert.deepEqual(await libraryResponse.json(), [{title: 'One Piece'}])

    const latestTitlesResponse = await fetch(`${baseUrl}/api/raven/library/latest`, {
        headers: {Authorization: `Bearer ${homeToken}`},
    })
    assert.equal(latestTitlesResponse.status, 200)
    assert.deepEqual(await latestTitlesResponse.json(), [{title: 'One Piece'}])

    const forbiddenDownloadsResponse = await fetch(`${baseUrl}/api/raven/downloads/status`, {
        headers: {Authorization: `Bearer ${libraryToken}`},
    })
    assert.equal(forbiddenDownloadsResponse.status, 403)

    const forbiddenSearchResponse = await fetch(`${baseUrl}/api/raven/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${libraryToken}`,
        },
        body: JSON.stringify({query: 'one piece'}),
    })
    assert.equal(forbiddenSearchResponse.status, 403)

    const forbiddenRecommendationsResponse = await fetch(`${baseUrl}/api/recommendations`, {
        headers: {Authorization: `Bearer ${libraryToken}`},
    })
    assert.equal(forbiddenRecommendationsResponse.status, 403)

    const forbiddenLibraryResponse = await fetch(`${baseUrl}/api/raven/library`, {
        headers: {Authorization: `Bearer ${downloadToken}`},
    })
    assert.equal(forbiddenLibraryResponse.status, 403)

    const forbiddenHomeLibraryResponse = await fetch(`${baseUrl}/api/raven/library`, {
        headers: {Authorization: `Bearer ${homeToken}`},
    })
    assert.equal(forbiddenHomeLibraryResponse.status, 403)

    const forbiddenHomeRecommendationsResponse = await fetch(`${baseUrl}/api/recommendations`, {
        headers: {Authorization: `Bearer ${homeToken}`},
    })
    assert.equal(forbiddenHomeRecommendationsResponse.status, 403)

    const downloadStatusResponse = await fetch(`${baseUrl}/api/raven/downloads/status`, {
        headers: {Authorization: `Bearer ${downloadToken}`},
    })
    assert.equal(downloadStatusResponse.status, 200)
    assert.deepEqual(await downloadStatusResponse.json(), [{title: 'One Piece', status: 'queued'}])

    const searchResponse = await fetch(`${baseUrl}/api/raven/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${downloadToken}`,
        },
        body: JSON.stringify({query: '  one piece  '}),
    })
    assert.equal(searchResponse.status, 200)
    assert.deepEqual(await searchResponse.json(), {results: [{title: 'One Piece'}]})
    assert.deepEqual(searchQueries, ['one piece'])

    const recommendationsResponse = await fetch(`${baseUrl}/api/recommendations`, {
        headers: {Authorization: `Bearer ${downloadToken}`},
    })
    assert.equal(recommendationsResponse.status, 403)

    const managerRecommendationsResponse = await fetch(`${baseUrl}/api/recommendations`, {
        headers: {Authorization: `Bearer ${recommendationManagerToken}`},
    })
    assert.equal(managerRecommendationsResponse.status, 200)
    const managerRecommendationsPayload = await managerRecommendationsResponse.json()
    assert.equal(managerRecommendationsPayload.canManage, true)

    const managerDeleteResponse = await fetch(`${baseUrl}/api/recommendations/does-not-exist`, {
        method: 'DELETE',
        headers: {Authorization: `Bearer ${recommendationManagerToken}`},
    })
    assert.equal(managerDeleteResponse.status, 404)
    const managerApproveResponse = await fetch(`${baseUrl}/api/recommendations/does-not-exist/approve`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${recommendationManagerToken}`},
    })
    assert.equal(managerApproveResponse.status, 404)
    const recommendationsPayload = await recommendationsResponse.json()
    assert.ok(typeof recommendationsPayload.error === 'string')
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

test('POST /api/setup/services/noona-kavita/service-key provisions a managed key and updates selected services', async (t) => {
    const vault = createVaultAuthStub()
    const serviceConfigs = new Map([
        ['noona-portal', {env: {DISCORD_BOT_TOKEN: 'bot-token'}}],
        ['noona-raven', {env: {KAVITA_LIBRARY_ROOT: ''}}],
        ['noona-komf', {env: {KOMF_LOG_LEVEL: 'INFO'}}],
    ])
    const updateCalls = []
    const managedCalls = []

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return {status: 200, results: []}
            },
            async getServiceHealth() {
                return {status: 'healthy', detail: 'ok'}
            },
            async getServiceConfig(name) {
                return serviceConfigs.get(name) ?? {env: {}}
            },
            async updateServiceConfig(name, updates = {}) {
                updateCalls.push([name, updates])
                serviceConfigs.set(name, {env: {...(updates?.env ?? {})}})
                return {
                    restarted: true,
                    service: {
                        name,
                        env: updates?.env ?? {},
                    },
                }
            },
        },
        managedKavitaSetupClient: {
            async ensureServiceApiKey(options) {
                managedCalls.push(options)
                return {
                    apiKey: 'managed-kavita-key',
                    account: {
                        username: 'noona-system',
                        email: 'noona-system@noona.local',
                        password: 'super-secret',
                    },
                    mode: 'register',
                }
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/noona-kavita/service-key`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            services: ['noona-portal', 'noona-raven', 'noona-komf'],
            account: {
                username: 'reader-admin',
                email: 'reader-admin@example.com',
                password: 'Password123!',
            },
        }),
    })

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.apiKey, 'managed-kavita-key')
    assert.equal(payload.baseUrl, 'http://noona-kavita:5000')
    assert.equal(payload.mode, 'register')
    assert.deepEqual(payload.services, ['noona-portal', 'noona-raven', 'noona-komf'])
    assert.equal(managedCalls.length, 1)
    assert.deepEqual(managedCalls[0], {
        account: {
            username: 'reader-admin',
            email: 'reader-admin@example.com',
            password: 'Password123!',
        },
        allowRegister: true,
    })

    assert.equal(updateCalls.length, 3)
    assert.deepEqual(updateCalls[0], [
        'noona-portal',
        {
            env: {
                DISCORD_BOT_TOKEN: 'bot-token',
                KAVITA_BASE_URL: 'http://noona-kavita:5000',
                KAVITA_API_KEY: 'managed-kavita-key',
            },
            restart: true,
        },
    ])
    assert.deepEqual(updateCalls[1], [
        'noona-raven',
        {
            env: {
                KAVITA_LIBRARY_ROOT: '/manga',
                KAVITA_BASE_URL: 'http://noona-kavita:5000',
                KAVITA_API_KEY: 'managed-kavita-key',
            },
            restart: true,
        },
    ])
    assert.deepEqual(updateCalls[2], [
        'noona-komf',
        {
            env: {
                KOMF_LOG_LEVEL: 'INFO',
                KOMF_KAVITA_BASE_URI: 'http://noona-kavita:5000',
                KOMF_KAVITA_API_KEY: 'managed-kavita-key',
            },
            restart: true,
        },
    ])

    const stored = vault.settingDocs.find((entry) => entry.key === 'setup.managedKavitaServiceAccount')
    assert.ok(stored)
    assert.equal(stored.value?.apiKey, 'managed-kavita-key')
    assert.deepEqual(stored.value?.account, {
        username: 'noona-system',
        email: 'noona-system@noona.local',
    })
})

test('POST /api/setup/services/noona-kavita/service-key validates partial managed account payloads', async (t) => {
    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return {status: 200, results: []}
            },
            async getServiceHealth() {
                return {status: 'healthy', detail: 'ok'}
            },
            async getServiceConfig() {
                return {env: {}}
            },
            async updateServiceConfig() {
                throw new Error('updateServiceConfig should not be called')
            },
        },
        managedKavitaSetupClient: {
            async ensureServiceApiKey() {
                throw new Error('ensureServiceApiKey should not be called')
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/noona-kavita/service-key`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            services: ['noona-portal'],
            account: {
                username: 'reader-admin',
                email: '',
                password: 'Password123!',
            },
        }),
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
        error: 'Managed Kavita account requires a username, email, and password.',
    })
})

test('POST /api/setup/services/noona-kavita/service-key reuses an existing service key when one is already configured', async (t) => {
    const managedCalls = []
    const updateCalls = []

    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return {status: 200, results: []}
            },
            async getServiceHealth() {
                return {status: 'healthy', detail: 'ok'}
            },
            async getServiceConfig(name) {
                if (name === 'noona-portal') {
                    return {
                        env: {
                            KAVITA_BASE_URL: 'http://noona-kavita:5000',
                            KAVITA_API_KEY: 'existing-service-key',
                        },
                    }
                }

                if (name === 'noona-komf') {
                    return {
                        env: {
                            KOMF_KAVITA_BASE_URI: 'http://noona-kavita:5000',
                            KOMF_KAVITA_API_KEY: '',
                        },
                    }
                }

                return {env: {}}
            },
            async updateServiceConfig(name, updates = {}) {
                updateCalls.push([name, updates])
                return {
                    restarted: true,
                    service: {
                        name,
                        env: updates?.env ?? {},
                    },
                }
            },
        },
        managedKavitaSetupClient: {
            async ensureServiceApiKey() {
                managedCalls.push('called')
                return {
                    apiKey: 'should-not-run',
                    account: null,
                    mode: 'register',
                }
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/noona-kavita/service-key`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({services: ['noona-portal', 'noona-komf']}),
    })

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.apiKey, 'existing-service-key')
    assert.equal(payload.mode, 'existing')
    assert.deepEqual(managedCalls, [])
    assert.deepEqual(updateCalls, [
        [
            'noona-portal',
            {
                env: {
                    KAVITA_BASE_URL: 'http://noona-kavita:5000',
                    KAVITA_API_KEY: 'existing-service-key',
                },
                restart: true,
            },
        ],
        [
            'noona-komf',
            {
                env: {
                    KOMF_KAVITA_BASE_URI: 'http://noona-kavita:5000',
                    KOMF_KAVITA_API_KEY: 'existing-service-key',
                },
                restart: true,
            },
        ],
    ])
})

test('POST /api/setup/services/noona-kavita/service-key falls back to managed noona-kavita env credentials', async (t) => {
    const managedCalls = []

    const app = createSageApp({
        serviceName: 'test-sage',
        setupClient: {
            async listServices() {
                return []
            },
            async installServices() {
                return {status: 200, results: []}
            },
            async getServiceHealth() {
                return {status: 'healthy', detail: 'ok'}
            },
            async getServiceConfig(name) {
                if (name === 'noona-kavita') {
                    return {
                        env: {
                            KAVITA_ADMIN_USERNAME: 'reader-admin',
                            KAVITA_ADMIN_EMAIL: 'reader-admin@example.com',
                            KAVITA_ADMIN_PASSWORD: 'Password123!',
                        },
                    }
                }

                return {env: {}}
            },
            async updateServiceConfig(name, updates = {}) {
                return {
                    restarted: true,
                    service: {
                        name,
                        env: updates?.env ?? {},
                    },
                }
            },
        },
        managedKavitaSetupClient: {
            async ensureServiceApiKey(options) {
                managedCalls.push(options)
                return {
                    apiKey: 'managed-kavita-key',
                    account: {
                        username: 'reader-admin',
                        email: 'reader-admin@example.com',
                        password: 'Password123!',
                    },
                    mode: 'login',
                }
            },
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/setup/services/noona-kavita/service-key`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({services: ['noona-portal']}),
    })

    assert.equal(response.status, 200)
    assert.equal(managedCalls.length, 1)
    assert.deepEqual(managedCalls[0], {
        account: {
            username: 'reader-admin',
            email: 'reader-admin@example.com',
            password: 'Password123!',
        },
        allowRegister: true,
    })
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
            redirectUri: 'http://moon.local/discord/callback',
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
            redirectUri: 'http://moon.local/discord/callback',
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
    assert.deepEqual(createPayload.user.permissions, ['moon_login', 'library_management'])

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
            redirectUri: 'http://moon.local/discord/callback',
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

test('discord oauth login preserves same-origin absolute return targets and rejects foreign origins', async (t) => {
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
                    'same-origin-login': {
                        id: '123123123123123123',
                        username: 'MoonReader',
                        globalName: 'Moon Reader',
                        email: 'moon-reader@example.com',
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

    const startSameOriginResponse = await fetch(`${baseUrl}/api/auth/discord/start`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            mode: 'login',
            redirectUri: 'https://moon.local/discord/callback',
            returnTo: 'https://moon.local/kavita/complete?target=https%3A%2F%2Fbeta.local%2Flogin',
        }),
    })
    assert.equal(startSameOriginResponse.status, 200)
    const startSameOriginPayload = await startSameOriginResponse.json()

    const callbackSameOriginResponse = await fetch(`${baseUrl}/api/auth/discord/callback`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            code: 'same-origin-login',
            state: startSameOriginPayload.state,
        }),
    })
    assert.equal(callbackSameOriginResponse.status, 200)
    const callbackSameOriginPayload = await callbackSameOriginResponse.json()
    assert.equal(callbackSameOriginPayload.returnTo, 'https://moon.local/kavita/complete?target=https%3A%2F%2Fbeta.local%2Flogin')

    const startForeignOriginResponse = await fetch(`${baseUrl}/api/auth/discord/start`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            mode: 'login',
            redirectUri: 'https://moon.local/discord/callback',
            returnTo: 'https://evil.local/steal',
        }),
    })
    assert.equal(startForeignOriginResponse.status, 200)
    const startForeignOriginPayload = await startForeignOriginResponse.json()

    const callbackForeignOriginResponse = await fetch(`${baseUrl}/api/auth/discord/callback`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            code: 'same-origin-login',
            state: startForeignOriginPayload.state,
        }),
    })
    assert.equal(callbackForeignOriginResponse.status, 200)
    const callbackForeignOriginPayload = await callbackForeignOriginResponse.json()
    assert.equal(callbackForeignOriginPayload.returnTo, '/')
})

test('auth user management updates legacy Discord users missing authProvider metadata', async (t) => {
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

    const now = new Date().toISOString()
    vault.userDocs.push({
        username: 'Reader Legacy',
        usernameNormalized: 'discord.222333444555666777',
        discordUserId: '222333444555666777',
        role: 'member',
        permissions: ['moon_login'],
        createdAt: now,
        updatedAt: now,
    })

    const updateResponse = await fetch(`${baseUrl}/api/auth/users/discord.222333444555666777`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            username: 'Reader Legacy Prime',
            permissions: ['moon_login', 'lookup_new_title', 'download_new_title'],
        }),
    })
    assert.equal(updateResponse.status, 200)
    const updatePayload = await updateResponse.json()
    assert.equal(updatePayload.user.authProvider, 'discord')
    assert.equal(updatePayload.user.discordUserId, '222333444555666777')
    assert.equal(updatePayload.user.username, 'Reader Legacy Prime')
    assert.deepEqual(updatePayload.user.permissions, ['moon_login', 'library_management', 'download_management'])

    const storedUser = vault.userDocs.find((entry) => entry.usernameNormalized === 'discord.222333444555666777')
    assert.ok(storedUser)
    assert.equal(storedUser.authProvider, 'discord')
    assert.equal(storedUser.authProviderId, '222333444555666777')
    assert.equal(storedUser.username, 'Reader Legacy Prime')
    assert.deepEqual(storedUser.permissions, ['moon_login', 'library_management', 'download_management'])
})

test('auth user management updates permissions when Vault user docs expose serialized _id values', async (t) => {
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

    const storedUser = vault.userDocs.find((entry) => entry.usernameNormalized === 'readerone')
    assert.ok(storedUser)
    storedUser._id = '507f1f77bcf86cd799439011'

    const originalMongoUpdate = vault.client.mongo.update
    vault.client.mongo.update = async (collectionName, query = {}, update = {}, options = {}) => {
        if (Object.prototype.hasOwnProperty.call(query ?? {}, '_id')) {
            return {status: 'ok', matched: 0, modified: 0}
        }

        return originalMongoUpdate(collectionName, query, update, options)
    }

    const updateResponse = await fetch(`${baseUrl}/api/auth/users/ReaderOne`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({permissions: ['moon_login']}),
    })
    assert.equal(updateResponse.status, 200)
    const updatePayload = await updateResponse.json()
    assert.deepEqual(updatePayload.user.permissions, ['moon_login'])

    const refreshedStoredUser = vault.userDocs.find((entry) => entry.usernameNormalized === 'readerone')
    assert.ok(refreshedStoredUser)
    assert.deepEqual(refreshedStoredUser.permissions, ['moon_login'])
})

test('auth user management surfaces Vault write failures instead of reporting false success', async (t) => {
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

    vault.client.mongo.update = async () => ({status: 'ok', matched: 0, modified: 0})

    const updateResponse = await fetch(`${baseUrl}/api/auth/users/ReaderOne`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({permissions: ['moon_login']}),
    })
    assert.equal(updateResponse.status, 502)
    const updatePayload = await updateResponse.json()
    assert.equal(updatePayload.error, 'Vault did not persist auth user update.')

    const storedUser = vault.userDocs.find((entry) => entry.usernameNormalized === 'readerone')
    assert.ok(storedUser)
    assert.deepEqual(storedUser.permissions, [
        'moon_login',
        'library_management',
        'download_management',
        'mySubscriptions',
        'myRecommendations',
    ])
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

test('auth default permissions routes persist defaults and apply them to new member accounts', async (t) => {
    const vault = createVaultAuthStub({
        settings: [{
            key: 'auth.default_member_permissions',
            permissions: ['moon_login', 'download_new_title'],
            updatedAt: '2026-01-01T00:00:00.000Z',
        }],
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
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const getDefaultsResponse = await fetch(`${baseUrl}/api/auth/users/default-permissions`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(getDefaultsResponse.status, 200)
    assert.deepEqual(await getDefaultsResponse.json(), {
        key: 'auth.default_member_permissions',
        defaultPermissions: ['moon_login', 'download_management', 'mySubscriptions', 'myRecommendations'],
        permissions: [
            'moon_login',
            'library_management',
            'download_management',
            'mySubscriptions',
            'myRecommendations',
            'manageRecommendations',
            'user_management',
            'admin',
        ],
        updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const putDefaultsResponse = await fetch(`${baseUrl}/api/auth/users/default-permissions`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            permissions: ['moon_login', 'lookup_new_title', 'user_management'],
        }),
    })
    assert.equal(putDefaultsResponse.status, 200)
    const putDefaultsPayload = await putDefaultsResponse.json()
    assert.equal(putDefaultsPayload.ok, true)
    assert.deepEqual(putDefaultsPayload.defaultPermissions, [
        'moon_login',
        'library_management',
        'mySubscriptions',
        'myRecommendations',
        'user_management',
    ])

    const createResponse = await fetch(`${baseUrl}/api/auth/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({username: 'DefaultedUser', password: 'Password123', role: 'member'}),
    })
    assert.equal(createResponse.status, 201)
    const createPayload = await createResponse.json()
    assert.deepEqual(createPayload.user.permissions, [
        'moon_login',
        'library_management',
        'mySubscriptions',
        'myRecommendations',
        'user_management',
    ])

    const listResponse = await fetch(`${baseUrl}/api/auth/users`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(listResponse.status, 200)
    const listPayload = await listResponse.json()
    assert.deepEqual(listPayload.defaultPermissions, [
        'moon_login',
        'library_management',
        'mySubscriptions',
        'myRecommendations',
        'user_management',
    ])
})

test('Discord OAuth login auto-creates a Discord user with configured default permissions', async (t) => {
    const vault = createVaultAuthStub({
        settings: [{
            key: 'auth.default_member_permissions',
            permissions: ['moon_login', 'download_new_title'],
            updatedAt: '2026-01-01T00:00:00.000Z',
        }],
    })

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
                    'new-reader-login': {
                        id: '222333444555666777',
                        username: 'BrandNewReader',
                        globalName: 'Brand New Reader',
                        email: 'brand-new@example.com',
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

    const startLoginResponse = await fetch(`${baseUrl}/api/auth/discord/start`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            mode: 'login',
            redirectUri: 'http://moon.local/discord/callback',
            returnTo: '/',
        }),
    })
    assert.equal(startLoginResponse.status, 200)
    const startLoginPayload = await startLoginResponse.json()

    const callbackLoginResponse = await fetch(`${baseUrl}/api/auth/discord/callback`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            code: 'new-reader-login',
            state: startLoginPayload.state,
        }),
    })
    assert.equal(callbackLoginResponse.status, 200)
    const callbackLoginPayload = await callbackLoginResponse.json()
    assert.equal(callbackLoginPayload.stage, 'authenticated')
    assert.equal(callbackLoginPayload.user.authProvider, 'discord')
    assert.equal(callbackLoginPayload.user.discordUserId, '222333444555666777')
    assert.equal(callbackLoginPayload.user.username, 'Brand New Reader')
    assert.deepEqual(callbackLoginPayload.user.permissions, [
        'moon_login',
        'download_management',
        'mySubscriptions',
        'myRecommendations',
    ])

    const storedUser = vault.userDocs.find((entry) => entry.usernameNormalized === 'discord.222333444555666777')
    assert.ok(storedUser)
    assert.equal(storedUser.authProvider, 'discord')
    assert.deepEqual(storedUser.permissions, [
        'moon_login',
        'download_management',
        'mySubscriptions',
        'myRecommendations',
    ])
})

test('settings Discord onboarding message route returns the seeded default template', async (t) => {
    const defaultTemplate = [
        'Welcome to {guild_name}!',
        '',
        'Start with Moon: {moon_url}',
        'Read in Kavita: {kavita_url}',
        '',
        'Use the website onboarding flow to create your library access.',
        'Server: {server_ip}',
    ].join('\n')
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const finalized = await finalizeBootstrapAdmin({baseUrl, token})
    assert.equal(finalized.response.status, 200)

    const response = await fetch(`${baseUrl}/api/settings/discord/onboarding-message`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.key, 'discord.onboarding_message')
    assert.equal(payload.template, defaultTemplate)
    assert.ok(typeof payload.updatedAt === 'string')

    const stored = vault.settingDocs.find((entry) => entry.key === 'discord.onboarding_message')
    assert.ok(stored)
    assert.equal(stored.template, defaultTemplate)
})

test('settings Discord onboarding message route persists updates and returns updatedAt', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})
    const template = [
        'Hello {guild_name},',
        '',
        'Moon: {moon_url}',
        'Kavita: {kavita_url}',
        'Unknown token stays: {custom_note}',
    ].join('\n')

    const putResponse = await fetch(`${baseUrl}/api/settings/discord/onboarding-message`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({template}),
    })
    assert.equal(putResponse.status, 200)
    const putPayload = await putResponse.json()
    assert.equal(putPayload.key, 'discord.onboarding_message')
    assert.equal(putPayload.template, template)
    assert.ok(typeof putPayload.updatedAt === 'string')

    const getResponse = await fetch(`${baseUrl}/api/settings/discord/onboarding-message`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(getResponse.status, 200)
    const getPayload = await getResponse.json()
    assert.equal(getPayload.template, template)
    assert.equal(getPayload.updatedAt, putPayload.updatedAt)

    const stored = vault.settingDocs.find((entry) => entry.key === 'discord.onboarding_message')
    assert.ok(stored)
    assert.equal(stored.template, template)
    assert.equal(stored.updatedAt, putPayload.updatedAt)
})

test('settings Discord onboarding message route rejects empty templates', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})

    const response = await fetch(`${baseUrl}/api/settings/discord/onboarding-message`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({template: ' \n \t '}),
    })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {
        error: 'template must not be empty.',
    })
})

test('settings Discord onboarding message route stays admin-gated after setup completes', async (t) => {
    const vault = createVaultAuthStub()
    await vault.client.users.create({
        username: 'ReaderOne',
        password: 'Password123',
        role: 'member',
    })

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

    const unauthorizedResponse = await fetch(`${baseUrl}/api/settings/discord/onboarding-message`)
    assert.equal(unauthorizedResponse.status, 401)
    assert.deepEqual(await unauthorizedResponse.json(), {
        error: 'Unauthorized.',
    })

    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'ReaderOne', password: 'Password123'}),
    })
    assert.equal(loginResponse.status, 200)
    const loginPayload = await loginResponse.json()
    assert.equal(loginPayload.user.role, 'member')

    const memberResponse = await fetch(`${baseUrl}/api/settings/discord/onboarding-message`, {
        headers: {Authorization: `Bearer ${loginPayload.token}`},
    })
    assert.equal(memberResponse.status, 403)
    assert.deepEqual(await memberResponse.json(), {
        error: 'Admin privileges are required.',
    })
})

test('settings download worker routes read and update per-thread rate limits', async (t) => {
    const vault = createVaultAuthStub({
        settings: [{
            key: 'downloads.workers',
            threadRateLimitsKbps: [128, 0, 1024 * 1024],
            cpuCoreIds: [2, -1],
            updatedAt: '2026-01-01T00:00:00.000Z',
        }],
    })

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        ravenClient: {
            getDownloadSummary: async () => ({maxThreads: 5}),
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})

    const getResponse = await fetch(`${baseUrl}/api/settings/downloads/workers`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(getResponse.status, 200)
    assert.deepEqual(await getResponse.json(), {
        key: 'downloads.workers',
        threadRateLimitsKbps: [128, -1, 1024 * 1024, -1, -1],
        cpuCoreIds: [2, -1, -1, -1, -1],
        updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const putResponse = await fetch(`${baseUrl}/api/settings/downloads/workers`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            threadRateLimitsKbps: [512, -1, '10mb', '1gb', '0'],
            cpuCoreIds: [3, -1, '7', '8', 9.8],
        }),
    })
    assert.equal(putResponse.status, 200)
    const putPayload = await putResponse.json()
    assert.equal(putPayload.key, 'downloads.workers')
    assert.deepEqual(putPayload.threadRateLimitsKbps, [512, -1, 10 * 1024, 1024 * 1024, -1])
    assert.deepEqual(putPayload.cpuCoreIds, [3, -1, 7, 8, 9])
    assert.ok(typeof putPayload.updatedAt === 'string')

    const stored = vault.settingDocs.find((entry) => entry.key === 'downloads.workers')
    assert.ok(stored)
    assert.deepEqual(stored.threadRateLimitsKbps, [512, -1, 10 * 1024, 1024 * 1024, -1])
    assert.deepEqual(stored.cpuCoreIds, [3, -1, 7, 8, 9])
})

test('settings download worker routes reject invalid unit strings', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})

    const putResponse = await fetch(`${baseUrl}/api/settings/downloads/workers`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            threadRateLimitsKbps: ['fast'],
        }),
    })

    assert.equal(putResponse.status, 400)
    const payload = await putResponse.json()
    assert.equal(payload.error, 'Thread 1 rate limit must be a number in KB/s, may use `mb`/`gb`, or `-1` for unlimited.')
})

test('settings download worker routes reject invalid cpu core assignments', async (t) => {
    const vault = createVaultAuthStub()

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        ravenClient: {
            getDownloadSummary: async () => ({maxThreads: 3}),
        },
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})

    const putResponse = await fetch(`${baseUrl}/api/settings/downloads/workers`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            threadRateLimitsKbps: [512, -1, -1],
            cpuCoreIds: [0, 'left', -1],
        }),
    })

    assert.equal(putResponse.status, 400)
    const payload = await putResponse.json()
    assert.equal(payload.error, 'Thread 2 CPU core must be `-1` or a non-negative integer CPU ID.')
})

test('settings VPN routes read and update masked PIA credentials', async (t) => {
    const vault = createVaultAuthStub({
        settings: [{
            key: 'downloads.vpn',
            provider: 'pia',
            enabled: true,
            onlyDownloadWhenVpnOn: true,
            autoRotate: true,
            rotateEveryMinutes: 30,
            region: 'us_california',
            piaUsername: 'pia-user',
            piaPassword: 'super-secret',
            updatedAt: '2026-01-01T00:00:00.000Z',
        }],
    })

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        ravenClient: createRavenStub({
            async getVpnStatus() {
                return {
                    connectionState: 'connected',
                    publicIp: '198.51.100.12',
                }
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})

    const getRes = await fetch(`${baseUrl}/api/settings/downloads/vpn`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(getRes.status, 200)
    const getPayload = await getRes.json()
    assert.equal(getPayload.provider, 'pia')
    assert.equal(getPayload.enabled, true)
    assert.equal(getPayload.onlyDownloadWhenVpnOn, true)
    assert.equal(getPayload.piaUsername, 'pia-user')
    assert.equal(getPayload.piaPassword, '********')
    assert.equal(getPayload.passwordConfigured, true)
    assert.equal(getPayload.status.connectionState, 'connected')

    const putRes = await fetch(`${baseUrl}/api/settings/downloads/vpn`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            enabled: true,
            onlyDownloadWhenVpnOn: false,
            autoRotate: true,
            rotateEveryMinutes: 45,
            region: 'us_texas',
            piaUsername: 'new-user',
            piaPassword: 'new-secret',
        }),
    })
    assert.equal(putRes.status, 200)
    const putPayload = await putRes.json()
    assert.equal(putPayload.enabled, true)
    assert.equal(putPayload.onlyDownloadWhenVpnOn, false)
    assert.equal(putPayload.rotateEveryMinutes, 45)
    assert.equal(putPayload.region, 'us_texas')
    assert.equal(putPayload.piaUsername, 'new-user')
    assert.equal(putPayload.piaPassword, '********')
    assert.equal(putPayload.passwordConfigured, true)

    const stored = vault.settingDocs.find((entry) => entry.key === 'downloads.vpn')
    assert.ok(stored)
    assert.equal(stored.piaUsername, 'new-user')
    assert.equal(stored.piaPassword, 'new-secret')
    assert.equal(stored.onlyDownloadWhenVpnOn, false)
    assert.equal(stored.rotateEveryMinutes, 45)
})

test('settings VPN routes proxy region list and rotate action to Raven', async (t) => {
    const vault = createVaultAuthStub()
    const rotateCalls = []
    const loginTestCalls = []

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        ravenClient: createRavenStub({
            async getVpnRegions() {
                return [
                    {id: 'us_california', label: 'Us California', endpoint: '212.56.53.84'},
                    {id: 'us_texas', label: 'Us Texas', endpoint: '203.0.113.22'},
                ]
            },
            async rotateVpnNow(triggeredBy) {
                rotateCalls.push(triggeredBy)
                return {
                    ok: true,
                    message: 'VPN rotation complete.',
                    region: 'us_california',
                }
            },
            async testVpnLogin(payload) {
                loginTestCalls.push(payload)
                return {
                    ok: true,
                    message: 'PIA login succeeded for region us_california.',
                    region: 'us_california',
                    endpoint: '212.56.53.84',
                    reportedIp: '198.51.100.42',
                }
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})

    const regionsRes = await fetch(`${baseUrl}/api/settings/downloads/vpn/regions`, {
        headers: {Authorization: `Bearer ${token}`},
    })
    assert.equal(regionsRes.status, 200)
    const regionsPayload = await regionsRes.json()
    assert.equal(regionsPayload.provider, 'pia')
    assert.equal(regionsPayload.regions.length, 2)
    assert.equal(regionsPayload.regions[0].id, 'us_california')

    const rotateRes = await fetch(`${baseUrl}/api/settings/downloads/vpn/rotate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({triggeredBy: 'moon-settings'}),
    })
    assert.equal(rotateRes.status, 202)
    const rotatePayload = await rotateRes.json()
    assert.equal(rotatePayload.ok, true)
    assert.equal(rotateCalls.length, 1)
    assert.equal(rotateCalls[0], 'moon-settings')

    const testLoginRes = await fetch(`${baseUrl}/api/settings/downloads/vpn/test-login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            triggeredBy: 'moon-settings',
            region: 'us_california',
            piaUsername: 'pia-user',
            piaPassword: 'pia-secret',
        }),
    })
    assert.equal(testLoginRes.status, 200)
    const testLoginPayload = await testLoginRes.json()
    assert.equal(testLoginPayload.ok, true)
    assert.equal(testLoginPayload.region, 'us_california')
    assert.equal(testLoginPayload.reportedIp, '198.51.100.42')
    assert.equal(loginTestCalls.length, 1)
    assert.equal(loginTestCalls[0].triggeredBy, 'moon-settings')
    assert.equal(loginTestCalls[0].region, 'us_california')
    assert.equal(loginTestCalls[0].piaUsername, 'pia-user')
    assert.equal(loginTestCalls[0].piaPassword, 'pia-secret')
})

test('settings VPN test-login falls back to persisted credentials when form values are blank', async (t) => {
    const vault = createVaultAuthStub({
        settings: [{
            key: 'downloads.vpn',
            provider: 'pia',
            enabled: true,
            autoRotate: true,
            rotateEveryMinutes: 45,
            region: 'us_texas',
            piaUsername: 'saved-user',
            piaPassword: 'saved-secret',
            updatedAt: '2026-01-01T00:00:00.000Z',
        }],
    })
    const loginTestCalls = []

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        ravenClient: createRavenStub({
            async testVpnLogin(payload) {
                loginTestCalls.push(payload)
                return {
                    ok: true,
                    message: 'PIA login succeeded for region us_texas.',
                    region: payload.region,
                    endpoint: '203.0.113.22',
                    reportedIp: '198.51.100.42',
                }
            },
        }),
    })

    const {server, baseUrl} = await listen(app)
    t.after(() => closeServer(server))

    const {token} = await bootstrapAdminAndLogin({baseUrl})

    const testLoginRes = await fetch(`${baseUrl}/api/settings/downloads/vpn/test-login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            triggeredBy: 'moon-settings',
            region: '',
            piaUsername: '',
            piaPassword: '',
        }),
    })
    assert.equal(testLoginRes.status, 200)
    const testLoginPayload = await testLoginRes.json()
    assert.equal(testLoginPayload.ok, true)
    assert.equal(testLoginPayload.region, 'us_texas')
    assert.equal(loginTestCalls.length, 1)
    assert.equal(loginTestCalls[0].triggeredBy, 'moon-settings')
    assert.equal(loginTestCalls[0].region, 'us_texas')
    assert.equal(loginTestCalls[0].piaUsername, 'saved-user')
    assert.equal(loginTestCalls[0].piaPassword, 'saved-secret')
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
                    bootPersistence: {
                        setupConfig: {deleted: true, entries: []},
                        runtimeConfig: {deleted: true, path: '/srv/noona/warden/service-runtime-config.json'},
                        runtimeOverridesCleared: true,
                        wizardStateCleared: true,
                    },
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

test('settings factory reset route accepts Discord admin confirmation by username', async (t) => {
    const wipeCalls = []
    const restartCalls = []
    const vault = createVaultAuthStub()
    vault.client.mongo.wipe = async () => {
        wipeCalls.push('mongo')
        return {status: 'ok'}
    }
    vault.client.redis.wipe = async () => {
        wipeCalls.push('redis')
        return {status: 'ok'}
    }

    const app = createSageApp({
        serviceName: 'test-sage',
        vaultClient: vault.client,
        auth: {
            fetchImpl: createDiscordOauthFetchStub({
                identitiesByCode: {
                    'reset-discord-admin': {
                        id: '123456789012345678',
                        username: 'PaxKun',
                        globalName: 'Pax-kun',
                        email: 'pax@example.com',
                    },
                },
            }),
        },
        setupClient: {
            async factoryResetEcosystem(options = {}) {
                restartCalls.push(options)
                return {
                    ok: true,
                    bootPersistence: {
                        setupConfig: {deleted: true, entries: []},
                        runtimeConfig: {deleted: true, path: '/srv/noona/warden/service-runtime-config.json'},
                        runtimeOverridesCleared: true,
                        wizardStateCleared: true,
                    },
                    ravenDownloads: {
                        requested: false,
                        mountCount: 0,
                        entries: [],
                        deleted: true,
                    },
                    dockerCleanup: {
                        requested: false,
                        containersRemoved: [],
                        imagesRemoved: [],
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

    const configResponse = await fetch(`${baseUrl}/api/auth/discord/config`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            clientId: 'discord-client-id',
            clientSecret: 'discord-client-secret',
        }),
    })
    assert.equal(configResponse.status, 200)

    const startBootstrapResponse = await fetch(`${baseUrl}/api/auth/discord/start`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            mode: 'bootstrap',
            redirectUri: 'http://moon.local/discord/callback',
            returnTo: '/setupwizard/summary',
        }),
    })
    assert.equal(startBootstrapResponse.status, 200)
    const startBootstrapPayload = await startBootstrapResponse.json()

    const callbackBootstrapResponse = await fetch(`${baseUrl}/api/auth/discord/callback`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            code: 'reset-discord-admin',
            state: startBootstrapPayload.state,
        }),
    })
    assert.equal(callbackBootstrapResponse.status, 200)
    const callbackBootstrapPayload = await callbackBootstrapResponse.json()
    const token = callbackBootstrapPayload.token

    const badRes = await fetch(`${baseUrl}/api/settings/factory-reset`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({confirmation: 'Wrong Name'}),
    })
    assert.equal(badRes.status, 401)
    const badPayload = await badRes.json()
    assert.equal(badPayload.error, 'Confirmation did not match the current Discord account.')

    const okRes = await fetch(`${baseUrl}/api/settings/factory-reset`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({confirmation: 'Pax-kun'}),
    })
    assert.equal(okRes.status, 202)
    const okPayload = await okRes.json()
    assert.equal(okPayload.ok, true)
    assert.equal(okPayload.restartQueued, true)
    assert.equal(okPayload.redirectTo, 'https://noona.local')

    assert.deepEqual(wipeCalls, ['mongo', 'redis'])
    assert.deepEqual(restartCalls, [{
        deleteRavenDownloads: false,
        deleteDockers: false,
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
                    bootPersistence: {
                        setupConfig: {deleted: true, entries: []},
                        runtimeConfig: {deleted: true, path: '/srv/noona/warden/service-runtime-config.json'},
                        runtimeOverridesCleared: true,
                        wizardStateCleared: true,
                    },
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

test('settings factory reset route falls back to SERVER_IP for redirect URLs', async (t) => {
    const previousServerIp = process.env.SERVER_IP
    process.env.SERVER_IP = '192.168.1.25'

    try {
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
                        bootPersistence: {
                            setupConfig: {deleted: true, entries: []},
                            runtimeConfig: {deleted: true, path: '/srv/noona/warden/service-runtime-config.json'},
                            runtimeOverridesCleared: true,
                            wizardStateCleared: true,
                        },
                        ravenDownloads: {
                            requested: false,
                            mountCount: 0,
                            entries: [],
                            deleted: true,
                        },
                        dockerCleanup: {
                            requested: false,
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
            body: JSON.stringify({password}),
        })
        assert.equal(response.status, 202)

        const payload = await response.json()
        assert.equal(payload.redirectTo, 'http://192.168.1.25')
    } finally {
        if (previousServerIp === undefined) {
            delete process.env.SERVER_IP
        } else {
            process.env.SERVER_IP = previousServerIp
        }
    }
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
