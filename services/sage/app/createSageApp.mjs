// services/sage/app/createSageApp.mjs

import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'

import {debugMSG, errMSG, isDebugEnabled, log, setDebug} from '../../../utilities/etc/logger.mjs'
import {createDiscordSetupClient} from '../clients/discordSetupClient.mjs'
import {createRavenClient} from '../clients/ravenClient.mjs'
import {createVaultPacketClient, isVaultClientErrorStatus} from '../clients/vaultPacketClient.mjs'
import {createWizardStateClient} from '../wizard/wizardStateClient.mjs'
import {normalizeWizardMetadata, WIZARD_STEP_KEYS} from '../wizard/wizardStateSchema.mjs'
import {createSetupClient, defaultWardenBaseUrl, normalizeServiceInstallPayload} from './createSetupClient.mjs'
import {registerAuthRoutes} from '../routes/registerAuthRoutes.mjs'
import {registerRavenRoutes} from '../routes/registerRavenRoutes.mjs'
import {registerSettingsRoutes} from '../routes/registerSettingsRoutes.mjs'
import {registerSetupRoutes} from '../routes/registerSetupRoutes.mjs'

const defaultServiceName = () => process.env.SERVICE_NAME || 'noona-sage'
const defaultPort = () => process.env.API_PORT || 3004

const resolveLogger = (overrides = {}) => ({
    debug: debugMSG,
    error: errMSG,
    info: log,
    ...overrides,
})

const WIZARD_STEP_SET = new Set(WIZARD_STEP_KEYS)

const resolveWizardStepKey = (value) => {
    if (typeof value !== 'string') {
        return null
    }

    const normalized = value.trim()
    if (!normalized) {
        return null
    }

    return WIZARD_STEP_SET.has(normalized) ? normalized : null
}

const normalizeHistoryLimit = (value) => {
    if (value == null) {
        return null
    }

    if (Array.isArray(value)) {
        return normalizeHistoryLimit(value[0])
    }

    const number = Number(value)
    if (!Number.isFinite(number)) {
        return null
    }

    return Math.max(1, Math.min(200, Math.floor(number)))
}

const VERIFICATION_SERVICES = Object.freeze([
    {name: 'noona-vault', label: 'Vault'},
    {name: 'noona-redis', label: 'Redis'},
    {name: 'noona-mongo', label: 'Mongo'},
    {name: 'noona-portal', label: 'Portal'},
    {name: 'noona-raven', label: 'Raven'},
])

const VERIFICATION_LABELS = new Map(VERIFICATION_SERVICES.map((entry) => [entry.name, entry.label]))

const createEmptyVerificationSummary = () => ({
    lastRunAt: null,
    checks: [],
})

const formatVerificationLabel = (service) => {
    if (VERIFICATION_LABELS.has(service)) {
        return VERIFICATION_LABELS.get(service)
    }

    if (typeof service !== 'string') {
        return 'Service'
    }

    return service
        .replace(/^noona-/, '')
        .split('-')
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ')
}

const normalizeVerificationCheck = (check = {}) => {
    const service = typeof check.service === 'string' ? check.service.trim() : ''
    if (!service) {
        return null
    }

    const supported = check.supported !== false
    const success = supported ? check.success === true : false
    const status = (() => {
        if (!supported) {
            return 'skipped'
        }
        return success ? 'pass' : 'fail'
    })()

    return {
        service,
        label: typeof check.label === 'string' && check.label.trim() ? check.label.trim() : formatVerificationLabel(service),
        success,
        supported,
        status,
        message: typeof check.message === 'string' && check.message.trim() ? check.message.trim() : null,
        detail: Object.prototype.hasOwnProperty.call(check, 'detail') ? check.detail : null,
        checkedAt:
            typeof check.checkedAt === 'string' && check.checkedAt.trim()
                ? check.checkedAt.trim()
                : null,
        duration: Number.isFinite(check.duration) ? Number(check.duration) : null,
    }
}

const parseVerificationSummary = (detail) => {
    if (typeof detail !== 'string' || !detail.trim()) {
        return createEmptyVerificationSummary()
    }

    try {
        const parsed = JSON.parse(detail)
        const checks = Array.isArray(parsed?.checks) ? parsed.checks : []
        const normalizedChecks = checks
            .map((entry) => normalizeVerificationCheck(entry))
            .filter(Boolean)

        return {
            lastRunAt:
                typeof parsed?.lastRunAt === 'string' && parsed.lastRunAt.trim()
                    ? parsed.lastRunAt.trim()
                    : null,
            checks: normalizedChecks,
        }
    } catch {
        return createEmptyVerificationSummary()
    }
}

const buildVerificationCheckResult = (config, result, timestamp) => {
    const supported = result?.supported !== false
    const success = supported && result?.success === true
    const status = supported ? (success ? 'pass' : 'fail') : 'skipped'
    const message = (() => {
        if (typeof result?.error === 'string' && result.error.trim()) {
            return result.error.trim()
        }
        if (typeof result?.detail === 'string' && result.detail.trim()) {
            return result.detail.trim()
        }
        if (typeof result?.body === 'string' && result.body.trim()) {
            return result.body.trim()
        }
        if (result?.body && typeof result.body === 'object') {
            const bodyMessage = result.body.message || result.body.detail
            if (typeof bodyMessage === 'string' && bodyMessage.trim()) {
                return bodyMessage.trim()
            }
        }

        if (!supported) {
            return `${config.label} does not expose a test endpoint.`
        }

        return success ? `${config.label} health check succeeded.` : `${config.label} test failed.`
    })()

    return {
        service: config.name,
        label: config.label,
        success,
        supported,
        status,
        message,
        detail: Object.prototype.hasOwnProperty.call(result || {}, 'body') ? result.body : null,
        checkedAt: timestamp,
        duration: Number.isFinite(result?.duration) ? Number(result.duration) : null,
    }
}


export const createSageApp = ({
                                  serviceName = defaultServiceName(),
                                  logger: loggerOverrides,
                                  setupClient: setupClientOverride,
                                  discordSetupClient: discordSetupClientOverride,
                                  ravenClient: ravenClientOverride,
                                  setup: setupOptions = {},
                                  raven: ravenOptions = {},
                                  wizardStateClient: wizardStateClientOverride,
                                  wizard: wizardOptions = {},
                                  vaultClient: vaultClientOverride,
                                  vault: vaultOptions = {},
                                  auth: authOptions = {},
                                  settings: settingsOptions = {},
                              } = {}) => {
    const logger = resolveLogger(loggerOverrides)
    const setupClient =
        setupClientOverride ||
        createSetupClient({
            baseUrl: setupOptions.baseUrl ?? defaultWardenBaseUrl(),
            baseUrls: setupOptions.baseUrls ?? [],
            fetchImpl: setupOptions.fetchImpl ?? setupOptions.fetch ?? fetch,
            logger,
            serviceName,
            env: setupOptions.env ?? process.env,
        })
    const discordSetupClient =
        discordSetupClientOverride ||
        createDiscordSetupClient({
            logger,
            serviceName,
        })
    const ravenClient =
        ravenClientOverride ||
        createRavenClient({
            serviceName,
            logger,
            setupClient,
            baseUrl: ravenOptions.baseUrl,
            baseUrls: ravenOptions.baseUrls ?? [],
            fetchImpl: ravenOptions.fetchImpl ?? ravenOptions.fetch ?? fetch,
            env: ravenOptions.env ?? process.env,
        })

    const collectVerificationHealth = async () => {
        const buildEntry = (service, payload, error) => {
            if (error) {
                return {
                    service,
                    status: 'error',
                    message: error,
                    detail: null,
                    checkedAt: new Date().toISOString(),
                    success: false,
                }
            }

            const detailMessage =
                (typeof payload?.detail === 'string' && payload.detail.trim() && payload.detail.trim()) ||
                (typeof payload?.message === 'string' && payload.message.trim() && payload.message.trim()) ||
                `${formatVerificationLabel(service)} responded successfully.`

            return {
                service,
                status: typeof payload?.status === 'string' ? payload.status : 'unknown',
                message: detailMessage,
                detail: payload ?? null,
                checkedAt: new Date().toISOString(),
                success: true,
            }
        }

        const snapshot = {}

        try {
            const payload = await setupClient.getServiceHealth('noona-warden')
            snapshot.warden = buildEntry('noona-warden', payload, null)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn?.(`[${serviceName}] ⚠️ Warden health lookup failed: ${message}`)
            snapshot.warden = buildEntry('noona-warden', null, message)
        }

        try {
            const payload = await setupClient.getServiceHealth('noona-sage')
            snapshot.sage = buildEntry('noona-sage', payload, null)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn?.(`[${serviceName}] ⚠️ Sage self-health lookup failed: ${message}`)
            snapshot.sage = buildEntry('noona-sage', null, message)
        }

        return snapshot
    }

    const readVerificationSummary = (state) => parseVerificationSummary(state?.verification?.detail)
    const wizardEnv = wizardOptions.env ?? process.env
    let wizardStateClient = wizardStateClientOverride || wizardOptions.client || null

    if (!wizardStateClient) {
        const token =
            wizardOptions.token ??
            wizardEnv?.VAULT_API_TOKEN ??
            wizardEnv?.VAULT_ACCESS_TOKEN ??
            null

        if (token) {
            const baseCandidates = []
            if (wizardOptions.baseUrl) {
                baseCandidates.push(wizardOptions.baseUrl)
            }
            if (Array.isArray(wizardOptions.baseUrls)) {
                baseCandidates.push(...wizardOptions.baseUrls)
            }

            try {
                wizardStateClient = createWizardStateClient({
                    baseUrl: baseCandidates[0],
                    baseUrls: baseCandidates.slice(1),
                    token,
                    fetchImpl: wizardOptions.fetchImpl ?? wizardOptions.fetch ?? fetch,
                    env: wizardEnv,
                    logger,
                    serviceName,
                    redisKey: wizardOptions.redisKey,
                    timeoutMs: wizardOptions.timeoutMs,
                })
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logger.warn?.(`[${serviceName}] ⚠️ Wizard state client unavailable: ${message}`)
            }
        } else if (wizardOptions.required) {
            logger.warn?.(`[${serviceName}] ⚠️ Missing Vault token for wizard state; endpoints will be disabled.`)
        }
    }

    const wizardMetadataOverrides = wizardOptions.metadata ?? {}
    const wizardMetadata = normalizeWizardMetadata({
        steps: wizardMetadataOverrides.steps ?? wizardOptions.stepMetadata ?? wizardOptions.steps ?? null,
        featureFlags:
            wizardMetadataOverrides.featureFlags ??
            wizardMetadataOverrides.features ??
            wizardOptions.featureFlags ??
            wizardOptions.features ??
            wizardOptions.flags ??
            wizardOptions.featureFlag ??
            wizardEnv?.SETUP_FEATURE_FLAGS ??
            wizardEnv?.SETUP_WIZARD_FEATURE_FLAGS ??
            wizardEnv?.WIZARD_FEATURE_FLAGS ??
            null,
    })

    const vaultEnv = vaultOptions.env ?? wizardEnv
    let vaultClient = vaultClientOverride || vaultOptions.client || null

    if (!vaultClient) {
        const token =
            vaultOptions.token ??
            vaultEnv?.VAULT_API_TOKEN ??
            vaultEnv?.VAULT_ACCESS_TOKEN ??
            null

        if (token) {
            const baseCandidates = []
            if (vaultOptions.baseUrl) {
                baseCandidates.push(vaultOptions.baseUrl)
            }
            if (Array.isArray(vaultOptions.baseUrls)) {
                baseCandidates.push(...vaultOptions.baseUrls)
            }

            try {
                vaultClient = createVaultPacketClient({
                    baseUrl: baseCandidates[0],
                    baseUrls: baseCandidates.slice(1),
                    token,
                    fetchImpl: vaultOptions.fetchImpl ?? vaultOptions.fetch ?? fetch,
                    env: vaultEnv,
                    logger,
                    serviceName,
                    timeoutMs: vaultOptions.timeoutMs,
                })
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logger.warn?.(`[${serviceName}] ⚠️ Vault packet client unavailable: ${message}`)
            }
        } else if (vaultOptions.required) {
            logger.warn?.(`[${serviceName}] ⚠️ Missing Vault token for packet client; settings/auth endpoints will be disabled.`)
        }
    }

    const settingsCollection =
        typeof settingsOptions.collection === 'string' && settingsOptions.collection.trim()
            ? settingsOptions.collection.trim()
            : 'noona_settings'

    const sessionPrefix =
        typeof authOptions.sessionPrefix === 'string' && authOptions.sessionPrefix.trim()
            ? authOptions.sessionPrefix.trim()
            : 'noona:session:'

    const sessionTtlSeconds = (() => {
        const fromOptions = Number(authOptions.sessionTtlSeconds)
        if (Number.isFinite(fromOptions) && fromOptions > 0) {
            return Math.floor(fromOptions)
        }

        const fromEnv = Number(vaultEnv?.NOONA_SESSION_TTL_SECONDS ?? vaultEnv?.AUTH_SESSION_TTL_SECONDS)
        if (Number.isFinite(fromEnv) && fromEnv > 0) {
            return Math.floor(fromEnv)
        }

        return 86400
    })()
    const inMemorySessionStore = new Map()
    let pendingAdmin = null

    const DEFAULT_NAMING_SETTINGS = Object.freeze({
        key: 'downloads.naming',
        titleTemplate: '{title}',
        chapterTemplate: 'Chapter {chapter} [Pages {pages} {domain} - Noona].cbz',
        pageTemplate: '{page_padded}{ext}',
        pagePad: 3,
        chapterPad: 4,
    })

    const DEFAULT_DEBUG_SETTINGS = Object.freeze({
        key: 'noona.debug',
        enabled: isDebugEnabled(),
    })

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
    const parseBooleanInput = (value) => {
        if (typeof value === 'boolean') {
            return value
        }

        if (typeof value === 'number') {
            return value > 0
        }

        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase()
            if (!normalized) {
                return null
            }

            if (['1', 'true', 'yes', 'on', 'super'].includes(normalized)) {
                return true
            }

            if (['0', 'false', 'no', 'off'].includes(normalized)) {
                return false
            }
        }

        return null
    }
    const MOON_OP_PERMISSION_KEYS = Object.freeze([
        'moon_login',
        'lookup_new_title',
        'download_new_title',
        'check_download_missing_titles',
        'user_management',
        'admin',
    ])
    const MOON_OP_PERMISSION_SET = new Set(MOON_OP_PERMISSION_KEYS)
    const DEFAULT_MEMBER_PERMISSION_KEYS = Object.freeze([
        'moon_login',
        'lookup_new_title',
        'download_new_title',
        'check_download_missing_titles',
    ])
    const sortMoonPermissions = (permissions = []) => {
        const present = new Set(Array.isArray(permissions) ? permissions : [])
        return MOON_OP_PERMISSION_KEYS.filter((entry) => present.has(entry))
    }
    const normalizePermissionEntry = (value) => normalizeString(value).toLowerCase()
    const normalizePermissionList = (value) => {
        if (!Array.isArray(value)) {
            return []
        }

        const normalized = []
        for (const entry of value) {
            const key = normalizePermissionEntry(entry)
            if (!key || !MOON_OP_PERMISSION_SET.has(key)) {
                continue
            }
            normalized.push(key)
        }

        return sortMoonPermissions(Array.from(new Set(normalized)))
    }
    const validatePermissionListInput = (value) => {
        if (!Array.isArray(value)) {
            return {ok: false, error: 'permissions must be provided as an array.'}
        }

        const normalized = []
        for (const entry of value) {
            const key = normalizePermissionEntry(entry)
            if (!key) {
                continue
            }
            if (!MOON_OP_PERMISSION_SET.has(key)) {
                return {ok: false, error: `Unsupported permission: ${key}`}
            }
            normalized.push(key)
        }

        return {
            ok: true,
            permissions: sortMoonPermissions(Array.from(new Set(normalized))),
        }
    }
    const defaultPermissionsForRole = (role) =>
        normalizeRole(role, 'member') === 'admin'
            ? [...MOON_OP_PERMISSION_KEYS]
            : [...DEFAULT_MEMBER_PERMISSION_KEYS]
    const inferRoleFromPermissions = (permissions, fallback = 'member') =>
        Array.isArray(permissions) && permissions.includes('admin')
            ? 'admin'
            : normalizeRole(fallback, 'member') === 'admin'
                ? 'member'
                : normalizeRole(fallback, 'member')
    const isBootstrapUserDoc = (user) => parseBooleanInput(user?.isBootstrapUser) === true
    const resolveUserPermissions = (user, fallbackRole = 'member') => {
        const normalizedRole = normalizeRole(user?.role, fallbackRole)
        const existing = normalizePermissionList(user?.permissions)
        const hasExplicitPermissions = Array.isArray(user?.permissions)
        if (hasExplicitPermissions) {
            if (existing.includes('admin')) {
                return sortMoonPermissions(existing)
            }
            if (normalizedRole === 'admin') {
                return sortMoonPermissions([...existing, 'admin'])
            }
            return sortMoonPermissions(existing.filter((entry) => entry !== 'admin'))
        }

        return defaultPermissionsForRole(normalizedRole)
    }
    const hasMoonPermission = (user, permission) => {
        const key = normalizePermissionEntry(permission)
        if (!key || !MOON_OP_PERMISSION_SET.has(key)) {
            return false
        }

        const permissions = resolveUserPermissions(user, normalizeRole(user?.role, 'member'))
        if (permissions.includes('admin')) {
            return true
        }
        return permissions.includes(key)
    }
    const isAdminUser = (user) => hasMoonPermission(user, 'admin')
    const normalizeUserLookupKey = (user) => {
        const normalized = normalizeUsernameKey(user?.usernameNormalized)
        if (normalized) {
            return normalized
        }
        return normalizeUsernameKey(user?.username)
    }
    const parseUserTimestamp = (value) => {
        const normalized = normalizeString(value)
        if (!normalized) {
            return 0
        }
        const parsed = Date.parse(normalized)
        return Number.isFinite(parsed) ? parsed : 0
    }
    const toSortableLegacyTimestamp = (value) => {
        if (value > 0) {
            return value
        }
        return Number.MAX_SAFE_INTEGER
    }
    const listAuthUsers = async () => {
        if (vaultClient?.users?.list) {
            const users = await vaultClient.users.list()
            if (!Array.isArray(users)) {
                return []
            }
            return users.filter((entry) => entry && typeof entry === 'object')
        }

        if (!vaultClient?.mongo?.findMany) {
            return []
        }

        const users = await vaultClient.mongo.findMany('noona_users', {})
        if (!Array.isArray(users)) {
            return []
        }

        return users.filter((entry) => entry && typeof entry === 'object')
    }
    const createAuthUser = async ({username, password, role, permissions, isBootstrapUser}) => {
        if (!vaultClient?.users?.create) {
            throw new Error('Vault user management is not configured.')
        }

        return vaultClient.users.create({username, password, role, permissions, isBootstrapUser})
    }

    const updateAuthUser = async (lookupUsername, updates = {}) => {
        if (!vaultClient?.users?.update) {
            throw new Error('Vault user management is not configured.')
        }

        return vaultClient.users.update(lookupUsername, updates)
    }

    const deleteAuthUser = async (lookupUsername) => {
        if (!vaultClient?.users?.delete) {
            throw new Error('Vault user management is not configured.')
        }

        return vaultClient.users.delete(lookupUsername)
    }

    const authenticateAuthUser = async ({username, password}) => {
        if (!vaultClient?.users?.authenticate) {
            throw new Error('Vault user authentication is not configured.')
        }

        return vaultClient.users.authenticate({username, password})
    }

    const vaultErrorStatus = (error, fallback = 502) => {
        if (isVaultClientErrorStatus(error)) {
            const status = Number(error.status)
            if (Number.isFinite(status) && status > 0) {
                return status
            }
        }

        return fallback
    }

    const vaultErrorMessage = (error, fallback) => {
        if (error && typeof error === 'object' && typeof error.payload?.error === 'string' && error.payload.error.trim()) {
            return error.payload.error.trim()
        }

        if (error instanceof Error && error.message.trim()) {
            return error.message.trim()
        }

        return fallback
    }

    const findUserByLookupKey = (users, lookupKey) => {
        if (!lookupKey || !Array.isArray(users)) {
            return null
        }

        return users.find((entry) => normalizeUserLookupKey(entry) === lookupKey) ?? null
    }
    const selectPrimaryAdmin = (users) => {
        if (!Array.isArray(users)) {
            return null
        }

        const admins = users
            .filter((entry) => isAdminUser(entry))
            .sort((left, right) => {
                const leftUpdated = parseUserTimestamp(left?.updatedAt)
                const rightUpdated = parseUserTimestamp(right?.updatedAt)
                if (leftUpdated !== rightUpdated) {
                    return rightUpdated - leftUpdated
                }

                const leftCreated = parseUserTimestamp(left?.createdAt)
                const rightCreated = parseUserTimestamp(right?.createdAt)
                return rightCreated - leftCreated
            })

        return admins[0] ?? null
    }
    const selectLegacyBootstrapCandidate = (users) => {
        if (!Array.isArray(users)) {
            return null
        }

        const admins = users
            .filter((entry) => isAdminUser(entry))
            .sort((left, right) => {
                const leftCreated = toSortableLegacyTimestamp(parseUserTimestamp(left?.createdAt))
                const rightCreated = toSortableLegacyTimestamp(parseUserTimestamp(right?.createdAt))
                if (leftCreated !== rightCreated) {
                    return leftCreated - rightCreated
                }

                const leftUpdated = toSortableLegacyTimestamp(parseUserTimestamp(left?.updatedAt))
                const rightUpdated = toSortableLegacyTimestamp(parseUserTimestamp(right?.updatedAt))
                if (leftUpdated !== rightUpdated) {
                    return leftUpdated - rightUpdated
                }

                const leftKey = normalizeUserLookupKey(left)
                const rightKey = normalizeUserLookupKey(right)
                return leftKey.localeCompare(rightKey)
            })

        return admins[0] ?? null
    }

    const isValidUsername = (username) => /^[A-Za-z0-9._-]{3,64}$/.test(username)
    const isValidPassword = (password) => typeof password === 'string' && password.length >= 8
    const publicUser = (user, fallbackUsername = '') => {
        const username = normalizeUsername(user?.username) || fallbackUsername
        const usernameNormalized = normalizeUsernameKey(user?.usernameNormalized || user?.username || fallbackUsername)
        const permissions = resolveUserPermissions(user, normalizeRole(user?.role, 'member'))
        const role = inferRoleFromPermissions(permissions, normalizeRole(user?.role, 'member'))

        return {
            username,
            usernameNormalized,
            role,
            permissions,
            isBootstrapUser: isBootstrapUserDoc(user),
            createdAt: normalizeString(user?.createdAt) || null,
            updatedAt: normalizeString(user?.updatedAt) || null,
        }
    }
    const toSessionUser = (user, fallbackUsername = '') => {
        const base = publicUser(user, fallbackUsername)
        return {
            ...base,
            createdAt: base.createdAt || normalizeString(user?.updatedAt) || new Date().toISOString(),
        }
    }
    const resolveProtectedBootstrapLookupKey = (users) => {
        if (!Array.isArray(users) || users.length === 0) {
            return null
        }

        const explicit = users.find((entry) => isBootstrapUserDoc(entry))
        if (explicit) {
            return normalizeUserLookupKey(explicit)
        }

        // Backward compatibility for legacy records that predate isBootstrapUser.
        // Prefer the oldest admin so creating/updating other admins never steals protection.
        const fallback = selectLegacyBootstrapCandidate(users)
        return normalizeUserLookupKey(fallback)
    }
    const applyProtectedBootstrapUserFlag = (user, protectedLookupKey) => {
        if (!user || typeof user !== 'object') {
            return user
        }

        if (!protectedLookupKey) {
            return user
        }

        if (normalizeUsernameKey(user?.usernameNormalized || user?.username) !== protectedLookupKey) {
            return user
        }

        return {
            ...user,
            isBootstrapUser: true,
        }
    }
    const pendingAdminPublicUser = () => {
        if (!pendingAdmin) {
            return null
        }

        return {
            username: pendingAdmin.username,
            usernameNormalized: pendingAdmin.usernameNormalized,
            role: 'admin',
            permissions: [...MOON_OP_PERMISSION_KEYS],
            isBootstrapUser: true,
            createdAt: pendingAdmin.createdAt,
            updatedAt: pendingAdmin.updatedAt,
        }
    }
    const setPendingAdminCredentials = ({username, password}) => {
        const now = new Date().toISOString()
        const createdAt =
            pendingAdmin && typeof pendingAdmin.createdAt === 'string' && pendingAdmin.createdAt.trim()
                ? pendingAdmin.createdAt
                : now
        pendingAdmin = {
            username,
            usernameNormalized: normalizeUsernameKey(username),
            password,
            role: 'admin',
            permissions: [...MOON_OP_PERMISSION_KEYS],
            isBootstrapUser: true,
            createdAt,
            updatedAt: now,
        }
    }
    const authenticatePendingAdmin = ({username, password}) => {
        if (!pendingAdmin) {
            return {authenticated: false, user: null}
        }

        if (normalizeUsernameKey(username) !== pendingAdmin.usernameNormalized) {
            return {authenticated: false, user: null}
        }

        if (typeof password !== 'string' || password !== pendingAdmin.password) {
            return {authenticated: false, user: null}
        }

        return {
            authenticated: true,
            user: pendingAdminPublicUser(),
        }
    }
    const hasVaultUserApi = () =>
        Boolean(vaultClient?.users?.list && vaultClient?.users?.create && vaultClient?.users?.update && vaultClient?.users?.authenticate)

    const createSessionToken = () => crypto.randomBytes(32).toString('base64url')

    const sessionKeyForToken = (token) => `${sessionPrefix}${token}`
    const getStoredSession = (token) => {
        const entry = inMemorySessionStore.get(token)
        if (!entry || typeof entry !== 'object') {
            return null
        }

        const expiresAt = Number(entry.expiresAt)
        if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() >= expiresAt) {
            inMemorySessionStore.delete(token)
            return null
        }

        return entry.session && typeof entry.session === 'object' ? entry.session : null
    }
    const setStoredSession = (token, session, ttlSeconds = sessionTtlSeconds) => {
        const ttl = Number(ttlSeconds)
        const expiresAt = Number.isFinite(ttl) && ttl > 0 ? Date.now() + Math.floor(ttl * 1000) : null
        inMemorySessionStore.set(token, {session, expiresAt})
    }
    const deleteStoredSession = (token) => {
        inMemorySessionStore.delete(token)
    }
    const writeSession = async (token, session, ttlSeconds = sessionTtlSeconds) => {
        setStoredSession(token, session, ttlSeconds)

        if (!vaultClient?.redis?.set) {
            return
        }

        try {
            await vaultClient.redis.set(sessionKeyForToken(token), session, {ttl: ttlSeconds})
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn?.(`[${serviceName}] ⚠️ Failed to persist auth session in Vault Redis: ${message}`)
        }
    }
    const readSession = async (token) => {
        if (vaultClient?.redis?.get) {
            try {
                const fromRedis = await vaultClient.redis.get(sessionKeyForToken(token))
                if (fromRedis && typeof fromRedis === 'object') {
                    setStoredSession(token, fromRedis, sessionTtlSeconds)
                    return fromRedis
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logger.warn?.(`[${serviceName}] ⚠️ Failed to read auth session from Vault Redis: ${message}`)
            }
        }

        return getStoredSession(token)
    }
    const dropSession = async (token) => {
        deleteStoredSession(token)

        if (!vaultClient?.redis?.del) {
            return
        }

        try {
            await vaultClient.redis.del(sessionKeyForToken(token))
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn?.(`[${serviceName}] ⚠️ Failed to delete auth session from Vault Redis: ${message}`)
        }
    }

    const ensureDefaultSettings = async (timestamp) => {
        if (!vaultClient?.mongo?.findOne || !vaultClient?.mongo?.update) {
            return
        }

        const existingNaming = await vaultClient.mongo.findOne(settingsCollection, {
            key: DEFAULT_NAMING_SETTINGS.key,
        })
        if (!existingNaming) {
            await vaultClient.mongo.update(
                settingsCollection,
                {key: DEFAULT_NAMING_SETTINGS.key},
                {$set: {...DEFAULT_NAMING_SETTINGS, updatedAt: timestamp}},
                {upsert: true},
            )
        }

        const existingDebug = await vaultClient.mongo.findOne(settingsCollection, {
            key: DEFAULT_DEBUG_SETTINGS.key,
        })
        if (!existingDebug) {
            await vaultClient.mongo.update(
                settingsCollection,
                {key: DEFAULT_DEBUG_SETTINGS.key},
                {$set: {...DEFAULT_DEBUG_SETTINGS, updatedAt: timestamp}},
                {upsert: true},
            )
        } else {
            // If already exists, apply to current Sage process
            if (typeof existingDebug.enabled === 'boolean') {
                logger.debug(`[${serviceName}] 🛠️ Syncing live debug mode from Vault: ${existingDebug.enabled}`)
                setDebug(existingDebug.enabled)
            }
        }
    }
    const readDebugSetting = async () => {
        if (!vaultClient?.mongo?.findOne) {
            return {
                key: DEFAULT_DEBUG_SETTINGS.key,
                enabled: isDebugEnabled(),
                updatedAt: null,
            }
        }

        const doc = await vaultClient.mongo.findOne(settingsCollection, {
            key: DEFAULT_DEBUG_SETTINGS.key,
        })

        return {
            key: DEFAULT_DEBUG_SETTINGS.key,
            enabled: typeof doc?.enabled === 'boolean' ? doc.enabled : isDebugEnabled(),
            updatedAt: normalizeString(doc?.updatedAt) || null,
        }
    }
    const applyDebugSetting = async (enabled) => {
        if (!vaultClient?.mongo?.update) {
            throw new Error('Vault storage is not configured.')
        }

        const timestamp = new Date().toISOString()
        await vaultClient.mongo.update(
            settingsCollection,
            {key: DEFAULT_DEBUG_SETTINGS.key},
            {
                $set: {
                    key: DEFAULT_DEBUG_SETTINGS.key,
                    enabled,
                    updatedAt: timestamp,
                },
            },
            {upsert: true},
        )

        setDebug(enabled)

        const propagationErrors = []
        const propagate = async (target, task) => {
            try {
                await task()
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                propagationErrors.push(`${target}: ${message}`)
            }
        }

        await propagate('warden', async () => {
            if (typeof setupClient?.setDebug !== 'function') {
                throw new Error('Warden debug endpoint is unavailable.')
            }

            await setupClient.setDebug(enabled)
        })

        if (typeof ravenClient?.setDebug === 'function') {
            await propagate('raven', async () => {
                await ravenClient.setDebug(enabled)
            })
        }

        if (typeof vaultClient?.setDebug === 'function') {
            await propagate('vault', async () => {
                await vaultClient.setDebug(enabled)
            })
        }

        if (propagationErrors.length > 0) {
            throw new Error(`Saved debug mode, but propagation failed (${propagationErrors.join(' | ')})`)
        }

        return {
            key: DEFAULT_DEBUG_SETTINGS.key,
            enabled,
            updatedAt: timestamp,
        }
    }
    const resolveBaseRedirectUrl = () => {
        const direct =
            normalizeString(settingsOptions.baseUrl) ||
            normalizeString(process.env.BASE_URL) ||
            normalizeString(process.env.HOST_SERVICE_URL)

        if (!direct) {
            return '/'
        }

        if (/^https?:\/\//i.test(direct)) {
            return direct
        }

        return `http://${direct}`
    }
    const queueEcosystemRestart = (options = {}) => {
        if (typeof setupClient?.restartEcosystem !== 'function') {
            logger.warn?.(`[${serviceName}] restartEcosystem is unavailable; skipping restart queue.`)
            return false
        }

        Promise.resolve(setupClient.restartEcosystem(options)).catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            logger.error(`[${serviceName}] Failed to restart ecosystem after vault wipe: ${message}`)
        })
        return true
    }
    const verifyFactoryResetSelections = ({result, deleteRavenDownloads, deleteDockers}) => {
        const failures = []

        if (deleteRavenDownloads) {
            if (result?.ravenDownloads?.requested !== true) {
                failures.push('Raven download cleanup was not requested by Warden.')
            } else if (result?.ravenDownloads?.deleted !== true) {
                const failedEntries = Array.isArray(result?.ravenDownloads?.entries)
                    ? result.ravenDownloads.entries.filter((entry) => entry?.deleted !== true)
                    : []
                if (failedEntries.length > 0) {
                    const details = failedEntries
                        .map((entry) => {
                            const target = normalizeString(entry?.target).trim() || 'unknown-target'
                            const reason =
                                normalizeString(entry?.error).trim()
                                || normalizeString(entry?.reason).trim()
                                || 'unknown error'
                            return `${target}: ${reason}`
                        })
                        .join(' | ')
                    failures.push(`Raven download cleanup failed for one or more mounts (${details}).`)
                } else {
                    failures.push('Raven download cleanup did not report success.')
                }
            }
        }

        if (deleteDockers) {
            if (result?.dockerCleanup?.requested !== true) {
                failures.push('Docker cleanup was not requested by Warden.')
            } else {
                const containerErrors = Array.isArray(result?.dockerCleanup?.containerErrors)
                    ? result.dockerCleanup.containerErrors
                    : []
                const imageErrors = Array.isArray(result?.dockerCleanup?.imageErrors)
                    ? result.dockerCleanup.imageErrors
                    : []
                if (containerErrors.length > 0 || imageErrors.length > 0) {
                    const details = [
                        ...containerErrors.map((entry) => {
                            const id = normalizeString(entry?.id).trim() || 'unknown-container'
                            const reason = normalizeString(entry?.error).trim() || 'unknown error'
                            return `container ${id}: ${reason}`
                        }),
                        ...imageErrors.map((entry) => {
                            const id = normalizeString(entry?.id).trim() || 'unknown-image'
                            const reason = normalizeString(entry?.error).trim() || 'unknown error'
                            return `image ${id}: ${reason}`
                        }),
                    ].join(' | ')
                    failures.push(`Docker cleanup failed for one or more artifacts (${details}).`)
                }
            }
        }

        return failures
    }
    const verifySessionPassword = async ({session, password}) => {
        if (!vaultClient?.users?.authenticate) {
            throw new Error('Vault user authentication is not configured.')
        }

        const username = normalizeUsername(session?.username || session?.usernameNormalized)
        if (!username) {
            throw new Error('Session username is unavailable.')
        }

        const authenticated = await authenticateAuthUser({username, password})
        return authenticated?.authenticated === true
    }
    const writeAdminToVault = async ({username, password}) => {
        if (!hasVaultUserApi()) {
            throw new Error('Vault user storage is not configured.')
        }

        const usernameNormalized = normalizeUsernameKey(username)
        const now = new Date().toISOString()
        const users = await listAuthUsers()
        const existingUserByName = findUserByLookupKey(users, usernameNormalized)
        const existingAdmin = selectPrimaryAdmin(users)
        const targetUser = existingUserByName || existingAdmin || null
        let created = false

        if (targetUser) {
            const targetLookup = normalizeUsername(targetUser.username) || normalizeUserLookupKey(targetUser)
            if (!targetLookup) {
                throw new Error('Unable to resolve existing admin account.')
            }

            await updateAuthUser(targetLookup, {
                username,
                password,
                role: 'admin',
                permissions: [...MOON_OP_PERMISSION_KEYS],
                isBootstrapUser: true,
            })
        } else {
            await createAuthUser({
                username,
                password,
                role: 'admin',
                permissions: [...MOON_OP_PERMISSION_KEYS],
                isBootstrapUser: true,
            })
            created = true
        }

        const allUsersAfterWrite = await listAuthUsers()
        for (const user of allUsersAfterWrite) {
            if (!isAdminUser(user)) {
                continue
            }

            const lookupKey = normalizeUserLookupKey(user)
            if (lookupKey === usernameNormalized) {
                continue
            }

            const demotionLookup = normalizeUsername(user?.username) || lookupKey
            if (!demotionLookup) {
                continue
            }

            await updateAuthUser(demotionLookup, {
                role: 'member',
                permissions: [...DEFAULT_MEMBER_PERMISSION_KEYS],
                isBootstrapUser: false,
            })
        }

        const verified = await authenticateAuthUser({username, password})
        if (!verified?.authenticated || !isAdminUser(verified.user)) {
            throw new Error('Bootstrap verification failed after account write.')
        }

        await ensureDefaultSettings(now)

        return {
            created,
            user: toSessionUser(verified.user, username),
        }
    }
    const finalizePendingAdminToVault = async () => {
        if (!pendingAdmin) {
            return {persisted: false, created: false, user: null}
        }

        const snapshot = {
            username: pendingAdmin.username,
            password: pendingAdmin.password,
        }
        const payload = await writeAdminToVault(snapshot)
        pendingAdmin = null
        return {persisted: true, ...payload}
    }

    const resolveSetupCompleted = (() => {
        const ttlMs = 3000
        let cachedAt = 0
        let cached = false

        return async () => {
            if (!wizardStateClient) {
                return false
            }

            const now = Date.now()
            if (now - cachedAt < ttlMs) {
                return cached
            }

            try {
                const state = await wizardStateClient.loadState({fallbackToDefault: true})
                cached = state?.completed === true
            } catch {
                cached = false
            } finally {
                cachedAt = now
            }

            return cached
        }
    })()

    const getBearerToken = (req) => {
        const header = req.headers?.authorization
        if (typeof header !== 'string') {
            return null
        }

        const match = header.match(/^Bearer\s+(.+)$/i)
        if (!match) {
            return null
        }

        const token = match[1]?.trim()
        return token ? token : null
    }

    const requireSession = async (req, res) => {
        const token = getBearerToken(req)
        if (!token) {
            res.status(401).json({error: 'Unauthorized.'})
            return null
        }

        const session = await readSession(token)
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return null
        }

        const fallbackUsername = normalizeUsername(session?.username || session?.usernameNormalized)
        const normalizedSession = toSessionUser(session, fallbackUsername)
        req.user = normalizedSession
        req.sessionToken = token
        return normalizedSession
    }

    const requireSessionIfSetupCompleted = async (req, res, next) => {
        try {
            const completed = await resolveSetupCompleted()
            if (!completed) {
                next()
                return
            }

            const session = await requireSession(req, res)
            if (!session) {
                return
            }

            next()
        } catch (error) {
            logger.error(`[${serviceName}] ❌ Auth middleware failed: ${error.message}`)
            res.status(502).json({error: 'Unable to validate session.'})
        }
    }

    const requireAdminSession = async (req, res) => {
        const session = await requireSession(req, res)
        if (!session) {
            return null
        }

        if (!hasMoonPermission(session, 'admin')) {
            res.status(403).json({error: 'Admin privileges are required.'})
            return null
        }

        return session
    }
    const requirePermissionSession = async (req, res, permission, options = {}) => {
        const session = await requireSession(req, res)
        if (!session) {
            return null
        }

        if (!hasMoonPermission(session, permission)) {
            const errorMessage =
                typeof options?.message === 'string' && options.message.trim()
                    ? options.message.trim()
                    : 'Insufficient permissions.'
            res.status(403).json({error: errorMessage})
            return null
        }

        return session
    }
    const requireAdminSessionIfSetupCompleted = async (req, res, next) => {
        try {
            const completed = await resolveSetupCompleted()
            if (!completed) {
                next()
                return
            }

            const session = await requireAdminSession(req, res)
            if (!session) {
                return
            }

            next()
        } catch (error) {
            logger.error(`[${serviceName}] ❌ Admin auth middleware failed: ${error.message}`)
            res.status(502).json({error: 'Unable to validate admin session.'})
        }
    }
    const ensureMoonPermission = (req, res, permission, message) => {
        const session = req.user
        if (!session) {
            return true
        }

        if (hasMoonPermission(session, permission)) {
            return true
        }

        const errorMessage = typeof message === 'string' && message.trim()
            ? message.trim()
            : 'Insufficient permissions.'
        res.status(403).json({error: errorMessage})
        return false
    }
    const generateTemporaryPassword = (length = 16) => {
        const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
        const lowercase = 'abcdefghijkmnopqrstuvwxyz'
        const numbers = '23456789'
        const symbols = '!@#$%*-_'
        const all = `${uppercase}${lowercase}${numbers}${symbols}`
        const nextChar = (pool) => pool.charAt(Math.floor(Math.random() * pool.length))

        const out = [
            nextChar(uppercase),
            nextChar(lowercase),
            nextChar(numbers),
            nextChar(symbols),
        ]

        while (out.length < Math.max(12, Math.floor(length))) {
            out.push(nextChar(all))
        }

        for (let index = out.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1))
            const temp = out[index]
            out[index] = out[swapIndex]
            out[swapIndex] = temp
        }

        return out.join('')
    }

    const app = express()

    app.use(cors())
    app.use(express.json())

    const pendingAdminState = {
        get value() {
            return pendingAdmin
        },
    }

    app.get('/health', (req, res) => {
        logger.debug(`[${serviceName}] ??? Healthcheck OK`)
        res.status(200).send('Sage is live!')
    })

    const routeContext = {
        app,
        applyDebugSetting,
        applyProtectedBootstrapUserFlag,
        authenticateAuthUser,
        authenticatePendingAdmin,
        buildVerificationCheckResult,
        collectVerificationHealth,
        createAuthUser,
        createEmptyVerificationSummary,
        createSessionToken,
        defaultPermissionsForRole,
        DEFAULT_NAMING_SETTINGS,
        deleteAuthUser,
        discordSetupClient,
        dropSession,
        ensureMoonPermission,
        finalizePendingAdminToVault,
        findUserByLookupKey,
        generateTemporaryPassword,
        hasMoonPermission,
        hasVaultUserApi,
        inferRoleFromPermissions,
        isValidPassword,
        isValidUsername,
        listAuthUsers,
        logger,
        MOON_OP_PERMISSION_KEYS,
        normalizeHistoryLimit,
        normalizeRole,
        normalizeServiceInstallPayload,
        normalizeUsername,
        normalizeUsernameKey,
        normalizeString,
        normalizeUserLookupKey,
        parseBooleanInput,
        pendingAdminPublicUser,
        pendingAdminState,
        publicUser,
        queueEcosystemRestart,
        ravenClient,
        readDebugSetting,
        readVerificationSummary,
        requireAdminSession,
        requireAdminSessionIfSetupCompleted,
        requirePermissionSession,
        requireSession,
        requireSessionIfSetupCompleted,
        resolveBaseRedirectUrl,
        resolveProtectedBootstrapLookupKey,
        resolveSetupCompleted,
        resolveWizardStepKey,
        selectPrimaryAdmin,
        serviceName,
        sessionTtlSeconds,
        setPendingAdminCredentials,
        settingsCollection,
        setupClient,
        sortMoonPermissions,
        toSessionUser,
        updateAuthUser,
        validatePermissionListInput,
        vaultClient,
        vaultErrorMessage,
        vaultErrorStatus,
        VERIFICATION_SERVICES,
        verifyFactoryResetSelections,
        verifySessionPassword,
        wizardMetadata,
        wizardStateClient,
        writeSession,
    }

    registerAuthRoutes(routeContext)
    registerSettingsRoutes(routeContext)
    registerSetupRoutes(routeContext)
    registerRavenRoutes(routeContext)

    return app
}

export const startSage = ({
                              port = defaultPort(),
                              serviceName = defaultServiceName(),
                              logger: loggerOverrides,
                              setupClient,
                              discordSetupClient,
                              ravenClient,
                              setup,
                              raven,
                              wizard,
                              wizardStateClient,
                              vault,
                              vaultClient,
                              auth,
                              settings,
                          } = {}) => {
    const logger = resolveLogger(loggerOverrides)
    const app = createSageApp({
        serviceName,
        logger,
        setupClient,
        discordSetupClient,
        ravenClient,
        setup,
        raven,
        wizard,
        wizardStateClient,
        vault,
        vaultClient,
        auth,
        settings,
    })
    const server = app.listen(port, () => {
        logger.info(`[${serviceName}] 🧠 Sage is live on port ${port}`)
    })

    return {app, server}
}

export {normalizeServiceInstallPayload} from './createSetupClient.mjs'
export {SetupValidationError} from '../lib/errors.mjs'
