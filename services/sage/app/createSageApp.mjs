// services/sage/app/createSageApp.mjs

import cors from 'cors'
import crypto from 'node:crypto'
import express from 'express'

import {debugMSG, errMSG, isDebugEnabled, log, setDebug} from '../../../utilities/etc/logger.mjs'
import {createDiscordSetupClient} from '../clients/discordSetupClient.mjs'
import {createManagedKavitaSetupClient} from '../clients/managedKavitaSetupClient.mjs'
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
                                  managedKavitaSetupClient: managedKavitaSetupClientOverride,
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
    const managedKavitaSetupClient =
        managedKavitaSetupClientOverride ||
        createManagedKavitaSetupClient({
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
    const oauthStatePrefix =
        typeof authOptions.oauthStatePrefix === 'string' && authOptions.oauthStatePrefix.trim()
            ? authOptions.oauthStatePrefix.trim()
            : 'noona:discord:oauth:'
    const oauthStateTtlSeconds = (() => {
        const fromOptions = Number(authOptions.oauthStateTtlSeconds)
        if (Number.isFinite(fromOptions) && fromOptions > 0) {
            return Math.floor(fromOptions)
        }

        return 600
    })()
    const discordOauthFetch = authOptions.fetchImpl ?? authOptions.fetch ?? fetch
    const discordOauthBaseUrl =
        typeof authOptions.discordOauthBaseUrl === 'string' && authOptions.discordOauthBaseUrl.trim()
            ? authOptions.discordOauthBaseUrl.trim().replace(/\/+$/, '')
            : 'https://discord.com/api'
    const inMemorySessionStore = new Map()
    const inMemoryOauthStateStore = new Map()
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
    const DEFAULT_MEMBER_PERMISSIONS_SETTINGS_KEY = 'auth.default_member_permissions'
    const DOWNLOAD_WORKER_SETTINGS_KEY = 'downloads.workers'
    const DISCORD_AUTH_SETTINGS_KEY = 'auth.discord'
    const DISCORD_CALLBACK_PATH = '/discord/callback/'
    const LOCAL_AUTH_PROVIDER = 'local'
    const DISCORD_AUTH_PROVIDER = 'discord'
    const USER_DISPLAY_NAME_MAX_LENGTH = 80

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
    const normalizeDiscordUserId = (value) => {
        const normalized = normalizeString(value)
        return /^\d{5,32}$/.test(normalized) ? normalized : ''
    }
    const normalizeAuthProvider = (value, fallback = LOCAL_AUTH_PROVIDER) => {
        const normalized = normalizeString(value).toLowerCase()
        if (normalized === DISCORD_AUTH_PROVIDER) {
            return DISCORD_AUTH_PROVIDER
        }
        if (normalized === LOCAL_AUTH_PROVIDER) {
            return LOCAL_AUTH_PROVIDER
        }
        return fallback
    }
    const normalizeDisplayName = (value, fallback = '') => {
        const normalized = normalizeString(value)
        if (normalized) {
            return normalized.slice(0, USER_DISPLAY_NAME_MAX_LENGTH)
        }
        return normalizeString(fallback).slice(0, USER_DISPLAY_NAME_MAX_LENGTH)
    }
    const buildDiscordLookupKey = (discordUserId) => {
        const normalized = normalizeDiscordUserId(discordUserId)
        return normalized ? `discord.${normalized}` : ''
    }
    const discordUserIdFromLookupKey = (value) => {
        const normalized = normalizeUsernameKey(value)
        const match = /^discord\.(\d{5,32})$/.exec(normalized)
        return match ? match[1] : ''
    }
    const resolveStoredAuthProvider = (user, fallback = LOCAL_AUTH_PROVIDER) => {
        const explicitProvider = normalizeAuthProvider(user?.authProvider, '')
        if (explicitProvider) {
            return explicitProvider
        }

        const discordUserId =
            normalizeDiscordUserId(user?.discordUserId || user?.authProviderId)
            || discordUserIdFromLookupKey(user?.usernameNormalized)
        if (discordUserId) {
            return DISCORD_AUTH_PROVIDER
        }

        return fallback
    }
    const resolveDiscordDisplayName = (user, fallback = '') =>
        normalizeDisplayName(
            user?.username
            || user?.discordGlobalName
            || user?.globalName
            || user?.discordUsername
            || user?.usernameTag
            || fallback,
            fallback,
        )
    const buildDiscordAvatarUrl = ({id, avatar}) => {
        const userId = normalizeDiscordUserId(id)
        const avatarHash = normalizeString(avatar)
        if (!userId || !avatarHash) {
            return null
        }

        const extension = avatarHash.startsWith('a_') ? 'gif' : 'png'
        return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${extension}?size=256`
    }
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
        if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
            return false
        }

        let salt
        let expected
        try {
            salt = Buffer.from(parts[4], 'base64')
            expected = Buffer.from(parts[5], 'base64')
        } catch {
            return false
        }

        let derived
        try {
            derived = crypto.scryptSync(password, salt, expected.length, {N, r, p})
        } catch {
            return false
        }

        if (derived.length !== expected.length) {
            return false
        }

        return crypto.timingSafeEqual(derived, expected)
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
    const LEGACY_MOON_PERMISSION_ALIASES = Object.freeze({
        lookup_new_title: 'library_management',
        download_new_title: 'download_management',
        check_download_missing_titles: 'download_management',
    })
    const SUPPORTED_MOON_PERMISSION_KEYS = Object.freeze([
        'moon_login',
        'library_management',
        'download_management',
        'user_management',
        'admin',
        ...Object.keys(LEGACY_MOON_PERMISSION_ALIASES),
    ])
    const MOON_OP_PERMISSION_KEYS = Object.freeze([
        'moon_login',
        'library_management',
        'download_management',
        'user_management',
        'admin',
    ])
    const MOON_OP_PERMISSION_SET = new Set(SUPPORTED_MOON_PERMISSION_KEYS)
    const DEFAULT_MEMBER_PERMISSION_KEYS = Object.freeze([
        'moon_login',
        'library_management',
        'download_management',
    ])
    const DEFAULT_MEMBER_PERMISSIONS_SETTINGS = Object.freeze({
        key: DEFAULT_MEMBER_PERMISSIONS_SETTINGS_KEY,
        permissions: [...DEFAULT_MEMBER_PERMISSION_KEYS],
    })
    const DEFAULT_DOWNLOAD_WORKER_SETTINGS = Object.freeze({
        key: DOWNLOAD_WORKER_SETTINGS_KEY,
        threadRateLimitsKbps: [],
    })
    const UNLIMITED_THREAD_RATE_LIMIT_KBPS = -1
    const MAX_THREAD_RATE_LIMIT_KBPS = 2_147_483_647
    const THREAD_RATE_LIMIT_SUFFIX_MULTIPLIERS = Object.freeze({
        '': 1,
        k: 1,
        kb: 1,
        m: 1024,
        mb: 1024,
        g: 1024 * 1024,
        gb: 1024 * 1024,
    })
    const sortMoonPermissions = (permissions = []) => {
        const present = new Set(Array.isArray(permissions) ? permissions : [])
        return MOON_OP_PERMISSION_KEYS.filter((entry) => present.has(entry))
    }
    const normalizePermissionEntry = (value) => normalizeString(value).toLowerCase()
    const normalizePermissionKey = (value) => {
        const key = normalizePermissionEntry(value)
        if (!key || !MOON_OP_PERMISSION_SET.has(key)) {
            return ''
        }

        return LEGACY_MOON_PERMISSION_ALIASES[key] ?? key
    }
    const normalizePermissionList = (value) => {
        if (!Array.isArray(value)) {
            return []
        }

        const normalized = []
        for (const entry of value) {
            const key = normalizePermissionKey(entry)
            if (!key) {
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
            const rawKey = normalizePermissionEntry(entry)
            if (!rawKey) {
                continue
            }
            if (!MOON_OP_PERMISSION_SET.has(rawKey)) {
                return {ok: false, error: `Unsupported permission: ${rawKey}`}
            }
            normalized.push(LEGACY_MOON_PERMISSION_ALIASES[rawKey] ?? rawKey)
        }

        return {
            ok: true,
            permissions: sortMoonPermissions(Array.from(new Set(normalized))),
        }
    }
    const normalizeDefaultMemberPermissions = (value) => {
        const normalized = normalizePermissionList(value)
        const next = new Set(normalized)
        next.add('moon_login')
        return sortMoonPermissions(Array.from(next))
    }
    const parseThreadRateLimitEntry = (value, {strict = false} = {}) => {
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) {
                return strict
                    ? {ok: false, error: 'must be a finite number, `mb`/`gb` value, or `-1` for unlimited.'}
                    : {ok: true, value: UNLIMITED_THREAD_RATE_LIMIT_KBPS}
            }

            if (value <= 0) {
                return {ok: true, value: UNLIMITED_THREAD_RATE_LIMIT_KBPS}
            }

            const normalized = Math.floor(value)
            if (normalized > MAX_THREAD_RATE_LIMIT_KBPS) {
                return strict
                    ? {ok: false, error: 'is too large.'}
                    : {ok: true, value: MAX_THREAD_RATE_LIMIT_KBPS}
            }

            return {ok: true, value: normalized}
        }

        const raw = normalizeString(value).trim().toLowerCase()
        if (!raw) {
            return strict
                ? {ok: false, error: 'must not be empty. Use KB/s numbers, `mb`/`gb`, or `-1` for unlimited.'}
                : {ok: true, value: UNLIMITED_THREAD_RATE_LIMIT_KBPS}
        }

        if (raw === '-1' || raw === '0') {
            return {ok: true, value: UNLIMITED_THREAD_RATE_LIMIT_KBPS}
        }

        const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*(k|kb|m|mb|g|gb)?(?:\/s)?$/i)
        if (!match) {
            return strict
                ? {ok: false, error: 'must be a number in KB/s, may use `mb`/`gb`, or `-1` for unlimited.'}
                : {ok: true, value: UNLIMITED_THREAD_RATE_LIMIT_KBPS}
        }

        const amount = Number(match[1])
        const suffix = normalizeString(match[2]).toLowerCase()
        const multiplier = THREAD_RATE_LIMIT_SUFFIX_MULTIPLIERS[suffix] ?? 1
        const normalized = Math.floor(amount * multiplier)
        if (!Number.isFinite(normalized) || normalized <= 0) {
            return strict
                ? {ok: false, error: 'must resolve to a positive KB/s value or `-1`.'}
                : {ok: true, value: UNLIMITED_THREAD_RATE_LIMIT_KBPS}
        }
        if (normalized > MAX_THREAD_RATE_LIMIT_KBPS) {
            return strict
                ? {ok: false, error: 'is too large.'}
                : {ok: true, value: MAX_THREAD_RATE_LIMIT_KBPS}
        }

        return {ok: true, value: normalized}
    }
    const normalizeThreadRateLimits = (value) => {
        if (!Array.isArray(value)) {
            return []
        }

        return value.map((entry) => parseThreadRateLimitEntry(entry).value)
    }
    const validateThreadRateLimitsInput = (value) => {
        if (!Array.isArray(value)) {
            return {ok: false, error: 'threadRateLimitsKbps must be provided as an array.'}
        }

        const normalized = []
        for (let index = 0; index < value.length; index += 1) {
            const parsed = parseThreadRateLimitEntry(value[index], {strict: true})
            if (!parsed.ok) {
                return {ok: false, error: `Thread ${index + 1} rate limit ${parsed.error}`}
            }
            normalized.push(parsed.value)
        }

        return {ok: true, threadRateLimitsKbps: normalized}
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
    const snapshotAuthUser = (user) => ({
        lookupKey: normalizeUserLookupKey(user),
        username: normalizeUsername(user?.username),
        passwordHash: normalizeString(user?.passwordHash) || null,
        authProvider: resolveStoredAuthProvider(user, LOCAL_AUTH_PROVIDER),
        authProviderId:
            normalizeDiscordUserId(user?.authProviderId || user?.discordUserId)
            || discordUserIdFromLookupKey(user?.usernameNormalized)
            || null,
        discordUserId:
            normalizeDiscordUserId(user?.discordUserId || user?.authProviderId)
            || discordUserIdFromLookupKey(user?.usernameNormalized)
            || null,
        discordUsername: normalizeString(user?.discordUsername) || null,
        discordGlobalName: normalizeString(user?.discordGlobalName) || null,
        avatarUrl: normalizeString(user?.avatarUrl) || null,
        email: normalizeString(user?.email) || null,
        role: normalizeRole(user?.role, 'member'),
        permissions: resolveUserPermissions(user, normalizeRole(user?.role, 'member')),
        isBootstrapUser: parseBooleanInput(user?.isBootstrapUser) === true,
    })
    const authUserSnapshotsMatch = (left, right) => {
        const leftSnapshot = snapshotAuthUser(left)
        const rightSnapshot = snapshotAuthUser(right)
        return leftSnapshot.lookupKey === rightSnapshot.lookupKey
            && leftSnapshot.username === rightSnapshot.username
            && leftSnapshot.passwordHash === rightSnapshot.passwordHash
            && leftSnapshot.authProvider === rightSnapshot.authProvider
            && leftSnapshot.authProviderId === rightSnapshot.authProviderId
            && leftSnapshot.discordUserId === rightSnapshot.discordUserId
            && leftSnapshot.discordUsername === rightSnapshot.discordUsername
            && leftSnapshot.discordGlobalName === rightSnapshot.discordGlobalName
            && leftSnapshot.avatarUrl === rightSnapshot.avatarUrl
            && leftSnapshot.email === rightSnapshot.email
            && leftSnapshot.role === rightSnapshot.role
            && JSON.stringify(leftSnapshot.permissions) === JSON.stringify(rightSnapshot.permissions)
            && leftSnapshot.isBootstrapUser === rightSnapshot.isBootstrapUser
    }
    const hasMoonPermission = (user, permission) => {
        const key = normalizePermissionKey(permission)
        if (!key) {
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
        const authProvider = resolveStoredAuthProvider(user, '')
        if (authProvider === DISCORD_AUTH_PROVIDER) {
            const discordLookup = buildDiscordLookupKey(
                user?.discordUserId || user?.authProviderId || discordUserIdFromLookupKey(user?.usernameNormalized),
            )
            if (discordLookup) {
                return discordLookup
            }
        }
        const normalized = normalizeUsernameKey(user?.usernameNormalized)
        if (normalized) {
            return normalized
        }
        return normalizeUsernameKey(user?.username)
    }
    const buildAuthUserLookupQuery = (user, fallbackLookupKey = '') => {
        if (user && Object.prototype.hasOwnProperty.call(user, '_id')) {
            return {_id: user._id}
        }

        const storedLookupKey = normalizeUsernameKey(user?.usernameNormalized)
        if (storedLookupKey) {
            return {usernameNormalized: storedLookupKey}
        }

        const username = normalizeUsername(user?.username)
        if (username) {
            return {username}
        }

        const fallbackLookup = normalizeUsernameKey(fallbackLookupKey)
        if (fallbackLookup) {
            return {usernameNormalized: fallbackLookup}
        }

        return null
    }
    const buildAuthUserDoc = ({
                                  existingUser = null,
                                  username = '',
                                  password = '',
                                  role = 'member',
                                  permissions = undefined,
                                  isBootstrapUser = false,
                                  authProvider = undefined,
                                  discordUserId = '',
                                  discordUsername = '',
                                  discordGlobalName = '',
                                  avatarUrl = '',
                                  email = '',
                              } = {}) => {
        const provider = normalizeAuthProvider(authProvider, resolveStoredAuthProvider(existingUser, LOCAL_AUTH_PROVIDER))
        const now = new Date().toISOString()
        const currentRole = normalizeRole(existingUser?.role, 'member')
        const nextRole = normalizeRole(role, currentRole)
        const hasPermissionsInput = Array.isArray(permissions)
        let nextPermissions = hasPermissionsInput
            ? normalizePermissionList(permissions)
            : resolveUserPermissions(existingUser, nextRole)

        if (!hasPermissionsInput && (!Array.isArray(existingUser?.permissions) || nextPermissions.length === 0)) {
            nextPermissions = defaultPermissionsForRole(nextRole)
        }

        if (nextRole === 'admin' && !nextPermissions.includes('admin')) {
            nextPermissions = sortMoonPermissions([...nextPermissions, 'admin'])
        }
        if (nextRole !== 'admin') {
            nextPermissions = sortMoonPermissions(nextPermissions.filter((entry) => entry !== 'admin'))
        }

        if (provider === DISCORD_AUTH_PROVIDER) {
            const normalizedDiscordId = normalizeDiscordUserId(
                discordUserId
                || existingUser?.discordUserId
                || existingUser?.authProviderId
                || discordUserIdFromLookupKey(existingUser?.usernameNormalized),
            )
            if (!normalizedDiscordId) {
                throw new Error('discordUserId is required for Discord-auth users.')
            }

            return {
                username:
                    resolveDiscordDisplayName(
                        {
                            username,
                            discordGlobalName,
                            discordUsername,
                        },
                        existingUser?.username || `Discord ${normalizedDiscordId}`,
                    ) || `Discord ${normalizedDiscordId}`,
                usernameNormalized: buildDiscordLookupKey(normalizedDiscordId),
                passwordHash: null,
                authProvider: DISCORD_AUTH_PROVIDER,
                authProviderId: normalizedDiscordId,
                discordUserId: normalizedDiscordId,
                discordUsername: normalizeString(discordUsername) || normalizeString(existingUser?.discordUsername) || null,
                discordGlobalName:
                    normalizeString(discordGlobalName) || normalizeString(existingUser?.discordGlobalName) || null,
                avatarUrl:
                    normalizeString(avatarUrl)
                    || normalizeString(existingUser?.avatarUrl)
                    || buildDiscordAvatarUrl({
                        id: normalizedDiscordId,
                        avatar: existingUser?.discordAvatar,
                    })
                    || null,
                email: normalizeString(email) || normalizeString(existingUser?.email) || null,
                role: nextPermissions.includes('admin') ? 'admin' : 'member',
                permissions: nextPermissions,
                isBootstrapUser: parseBooleanInput(isBootstrapUser ?? existingUser?.isBootstrapUser) === true,
                createdAt:
                    normalizeString(existingUser?.createdAt)
                    || now,
                updatedAt: now,
                createdBy: normalizeString(existingUser?.createdBy) || serviceName,
                updatedBy: serviceName,
            }
        }

        const normalizedUsername = normalizeUsername(username || existingUser?.username)
        if (!normalizedUsername || !isValidUsername(normalizedUsername)) {
            throw new Error('username must be 3-64 characters (letters, numbers, ., _, -).')
        }

        const nextDoc = {
            username: normalizedUsername,
            usernameNormalized: normalizeUsernameKey(normalizedUsername),
            passwordHash:
                typeof password === 'string' && password
                    ? hashPassword(password)
                    : normalizeString(existingUser?.passwordHash) || null,
            authProvider: LOCAL_AUTH_PROVIDER,
            authProviderId: null,
            discordUserId: null,
            discordUsername: null,
            discordGlobalName: null,
            avatarUrl: null,
            email: null,
            role: nextPermissions.includes('admin') ? 'admin' : 'member',
            permissions: nextPermissions,
            isBootstrapUser: parseBooleanInput(isBootstrapUser ?? existingUser?.isBootstrapUser) === true,
            createdAt:
                normalizeString(existingUser?.createdAt)
                || now,
            updatedAt: now,
            createdBy: normalizeString(existingUser?.createdBy) || serviceName,
            updatedBy: serviceName,
        }

        if (!nextDoc.passwordHash) {
            throw new Error('password must be provided for local-auth users.')
        }

        return nextDoc
    }
    const listAuthUsers = async () => {
        if (vaultClient?.mongo?.findMany) {
            const users = await vaultClient.mongo.findMany('noona_users', {})
            if (!Array.isArray(users)) {
                return []
            }
            return users.filter((entry) => entry && typeof entry === 'object')
        }

        if (vaultClient?.users?.list) {
            const users = await vaultClient.users.list()
            if (!Array.isArray(users)) {
                return []
            }
            return users.filter((entry) => entry && typeof entry === 'object')
        }

        return []
    }
    const createAuthUser = async (payload = {}) => {
        if (vaultClient?.mongo?.insert) {
            const users = await listAuthUsers()
            const nextDoc = buildAuthUserDoc(payload)
            const lookupKey = normalizeUserLookupKey(nextDoc)
            if (lookupKey && findUserByLookupKey(users, lookupKey)) {
                const error = new Error('User already exists.')
                error.status = 409
                throw error
            }

            await vaultClient.mongo.insert('noona_users', nextDoc)
            return {ok: true, user: nextDoc}
        }

        if (!vaultClient?.users?.create) {
            throw new Error('Vault user management is not configured.')
        }

        return vaultClient.users.create(payload)
    }

    const updateAuthUser = async (lookupUsername, updates = {}) => {
        const lookupKey = normalizeUsernameKey(lookupUsername)
        if (vaultClient?.mongo?.update) {
            const users = await listAuthUsers()
            const existing = findUserByLookupKey(users, lookupKey)
            if (!existing) {
                const error = new Error('User not found.')
                error.status = 404
                throw error
            }

            const nextDoc = buildAuthUserDoc({
                existingUser: existing,
                username:
                    Object.prototype.hasOwnProperty.call(updates, 'username')
                        ? updates.username
                        : existing.username,
                password:
                    Object.prototype.hasOwnProperty.call(updates, 'password')
                        ? updates.password
                        : '',
                role:
                    Object.prototype.hasOwnProperty.call(updates, 'role')
                        ? updates.role
                        : existing.role,
                permissions:
                    Object.prototype.hasOwnProperty.call(updates, 'permissions')
                        ? updates.permissions
                        : existing.permissions,
                isBootstrapUser:
                    Object.prototype.hasOwnProperty.call(updates, 'isBootstrapUser')
                        ? updates.isBootstrapUser
                        : existing.isBootstrapUser,
                authProvider:
                    Object.prototype.hasOwnProperty.call(updates, 'authProvider')
                        ? updates.authProvider
                        : existing.authProvider,
                discordUserId:
                    Object.prototype.hasOwnProperty.call(updates, 'discordUserId')
                        ? updates.discordUserId
                        : existing.discordUserId,
                discordUsername:
                    Object.prototype.hasOwnProperty.call(updates, 'discordUsername')
                        ? updates.discordUsername
                        : existing.discordUsername,
                discordGlobalName:
                    Object.prototype.hasOwnProperty.call(updates, 'discordGlobalName')
                        ? updates.discordGlobalName
                        : existing.discordGlobalName,
                avatarUrl:
                    Object.prototype.hasOwnProperty.call(updates, 'avatarUrl')
                        ? updates.avatarUrl
                        : existing.avatarUrl,
                email:
                    Object.prototype.hasOwnProperty.call(updates, 'email')
                        ? updates.email
                        : existing.email,
            })

            const nextLookupKey = normalizeUserLookupKey(nextDoc)
            const conflict = users.find((entry) => {
                const entryLookup = normalizeUserLookupKey(entry)
                return entryLookup && entryLookup === nextLookupKey && entryLookup !== lookupKey
            })
            if (conflict) {
                const error = new Error('Username is already in use.')
                error.status = 409
                throw error
            }

            const query = buildAuthUserLookupQuery(existing, lookupKey)
            if (!query) {
                throw new Error('Unable to resolve existing auth user.')
            }

            await vaultClient.mongo.update('noona_users', query, {$set: nextDoc})

            const refreshedUsers = await listAuthUsers()
            const persistedUser = findUserByLookupKey(refreshedUsers, nextLookupKey)
            if (!persistedUser || !authUserSnapshotsMatch(persistedUser, nextDoc)) {
                const error = new Error('Vault did not persist auth user update.')
                error.status = 502
                throw error
            }

            return {ok: true, user: persistedUser}
        }

        if (!vaultClient?.users?.update) {
            throw new Error('Vault user management is not configured.')
        }

        return vaultClient.users.update(lookupUsername, updates)
    }

    const deleteAuthUser = async (lookupUsername) => {
        const lookupKey = normalizeUsernameKey(lookupUsername)
        if (vaultClient?.mongo?.delete) {
            const users = await listAuthUsers()
            const existing = findUserByLookupKey(users, lookupKey)
            if (!existing) {
                return {deleted: false}
            }

            const query = buildAuthUserLookupQuery(existing, lookupKey)
            if (!query) {
                return {deleted: false}
            }

            const result = await vaultClient.mongo.delete('noona_users', query)
            return {deleted: result?.deletedCount !== 0}
        }

        if (!vaultClient?.users?.delete) {
            throw new Error('Vault user management is not configured.')
        }

        return vaultClient.users.delete(lookupUsername)
    }

    const authenticateAuthUser = async ({username, password}) => {
        if (vaultClient?.mongo?.findMany) {
            const lookup = normalizeUsernameKey(username)
            const users = await listAuthUsers()
            let existing = users.find((entry) =>
                normalizeUserLookupKey(entry) === lookup
                || normalizeUsernameKey(entry?.username) === lookup,
            )
            if (!existing) {
                return {authenticated: false, user: null}
            }

            if (!normalizeString(existing?.usernameNormalized) && lookup && vaultClient?.mongo?.update) {
                const query = buildAuthUserLookupQuery(existing, lookup)
                if (query) {
                    const updatedAt = new Date().toISOString()
                    await vaultClient.mongo.update('noona_users', query, {
                        $set: {
                            usernameNormalized: lookup,
                            updatedAt,
                            updatedBy: serviceName,
                        },
                    })
                    existing = {
                        ...existing,
                        usernameNormalized: lookup,
                        updatedAt,
                        updatedBy: serviceName,
                    }
                }
            }

            if (resolveStoredAuthProvider(existing, LOCAL_AUTH_PROVIDER) === DISCORD_AUTH_PROVIDER) {
                return {
                    authenticated: false,
                    user: publicUser(existing, existing?.username || username),
                    error: 'This account uses Discord login.',
                    provider: DISCORD_AUTH_PROVIDER,
                }
            }

            if (!verifyPassword(password, existing?.passwordHash)) {
                return {authenticated: false, user: null}
            }

            return {
                authenticated: true,
                user: publicUser(existing, existing?.username || username),
            }
        }

        if (!vaultClient?.users?.authenticate) {
            throw new Error('Vault user authentication is not configured.')
        }

        return vaultClient.users.authenticate({username, password})
    }

    const findUserByDiscordId = (users, discordUserId) => {
        const lookup = normalizeDiscordUserId(discordUserId)
        if (!lookup || !Array.isArray(users)) {
            return null
        }

        return users.find((entry) =>
            normalizeDiscordUserId(entry?.discordUserId || entry?.authProviderId || discordUserIdFromLookupKey(entry?.usernameNormalized)) === lookup,
        ) ?? null
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
        const authProvider = resolveStoredAuthProvider(user, LOCAL_AUTH_PROVIDER)
        const discordUserId =
            normalizeDiscordUserId(user?.discordUserId || user?.authProviderId)
            || discordUserIdFromLookupKey(user?.usernameNormalized)
        const username =
            authProvider === DISCORD_AUTH_PROVIDER
                ? resolveDiscordDisplayName(user, fallbackUsername || `Discord ${discordUserId}`)
                : normalizeUsername(user?.username) || fallbackUsername
        const usernameNormalized =
            normalizeUserLookupKey({
                ...user,
                authProvider,
                discordUserId,
            })
            || normalizeUsernameKey(user?.usernameNormalized || user?.username || fallbackUsername)
        const permissions = resolveUserPermissions(user, normalizeRole(user?.role, 'member'))
        const role = inferRoleFromPermissions(permissions, normalizeRole(user?.role, 'member'))

        return {
            username,
            usernameNormalized,
            lookupKey: usernameNormalized,
            role,
            permissions,
            isBootstrapUser: isBootstrapUserDoc(user),
            authProvider,
            authProviderId: authProvider === DISCORD_AUTH_PROVIDER ? discordUserId || null : null,
            discordUserId: discordUserId || null,
            discordUsername: normalizeString(user?.discordUsername) || null,
            discordGlobalName: normalizeString(user?.discordGlobalName) || null,
            avatarUrl: normalizeString(user?.avatarUrl) || null,
            email: normalizeString(user?.email) || null,
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

        if (normalizeUserLookupKey(user) !== protectedLookupKey) {
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
            lookupKey: pendingAdmin.usernameNormalized,
            role: 'admin',
            permissions: [...MOON_OP_PERMISSION_KEYS],
            isBootstrapUser: true,
            authProvider: LOCAL_AUTH_PROVIDER,
            authProviderId: null,
            discordUserId: null,
            discordUsername: null,
            discordGlobalName: null,
            avatarUrl: null,
            email: null,
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
        Boolean(
            (vaultClient?.mongo?.findMany && vaultClient?.mongo?.insert && vaultClient?.mongo?.update)
            || (vaultClient?.users?.list && vaultClient?.users?.create && vaultClient?.users?.update && vaultClient?.users?.authenticate),
        )

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

    const oauthStateKeyForToken = (token) => `${oauthStatePrefix}${token}`
    const getStoredOauthState = (token) => {
        const entry = inMemoryOauthStateStore.get(token)
        if (!entry || typeof entry !== 'object') {
            return null
        }

        const expiresAt = Number(entry.expiresAt)
        if (Number.isFinite(expiresAt) && expiresAt > 0 && Date.now() >= expiresAt) {
            inMemoryOauthStateStore.delete(token)
            return null
        }

        return entry.payload && typeof entry.payload === 'object' ? entry.payload : null
    }
    const setStoredOauthState = (token, payload, ttlSeconds = oauthStateTtlSeconds) => {
        const ttl = Number(ttlSeconds)
        const expiresAt = Number.isFinite(ttl) && ttl > 0 ? Date.now() + Math.floor(ttl * 1000) : null
        inMemoryOauthStateStore.set(token, {payload, expiresAt})
    }
    const deleteStoredOauthState = (token) => {
        inMemoryOauthStateStore.delete(token)
    }
    const writeOauthState = async (token, payload, ttlSeconds = oauthStateTtlSeconds) => {
        setStoredOauthState(token, payload, ttlSeconds)

        if (!vaultClient?.redis?.set) {
            return
        }

        try {
            await vaultClient.redis.set(oauthStateKeyForToken(token), payload, {ttl: ttlSeconds})
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            logger.warn?.(`[${serviceName}] Discord OAuth state persistence failed: ${message}`)
        }
    }
    const readOauthState = async (token) => {
        if (vaultClient?.redis?.get) {
            try {
                const fromRedis = await vaultClient.redis.get(oauthStateKeyForToken(token))
                if (fromRedis && typeof fromRedis === 'object') {
                    setStoredOauthState(token, fromRedis, oauthStateTtlSeconds)
                    return fromRedis
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logger.warn?.(`[${serviceName}] Discord OAuth state lookup failed: ${message}`)
            }
        }

        return getStoredOauthState(token)
    }
    const consumeOauthState = async (token) => {
        const stored = await readOauthState(token)
        deleteStoredOauthState(token)

        if (vaultClient?.redis?.del) {
            try {
                await vaultClient.redis.del(oauthStateKeyForToken(token))
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logger.warn?.(`[${serviceName}] Discord OAuth state delete failed: ${message}`)
            }
        }

        return stored
    }
    const readDiscordAuthConfig = async () => {
        if (!vaultClient?.mongo?.findOne) {
            return {
                key: DISCORD_AUTH_SETTINGS_KEY,
                configured: false,
                clientId: null,
                clientSecret: null,
                callbackPath: DISCORD_CALLBACK_PATH,
                updatedAt: null,
                lastTestedAt: null,
                lastTestedUser: null,
            }
        }

        const doc = await vaultClient.mongo.findOne(settingsCollection, {key: DISCORD_AUTH_SETTINGS_KEY})
        const clientId = normalizeString(doc?.clientId) || null
        const clientSecret = normalizeString(doc?.clientSecret) || null
        const lastTestedUser =
            doc?.lastTestedUser && typeof doc.lastTestedUser === 'object'
                ? {
                    id: normalizeDiscordUserId(doc.lastTestedUser.id) || null,
                    username: normalizeString(doc.lastTestedUser.username) || null,
                    globalName: normalizeString(doc.lastTestedUser.globalName) || null,
                    avatarUrl: normalizeString(doc.lastTestedUser.avatarUrl) || null,
                    email: normalizeString(doc.lastTestedUser.email) || null,
                }
                : null

        return {
            key: DISCORD_AUTH_SETTINGS_KEY,
            configured: Boolean(clientId && clientSecret),
            clientId,
            clientSecret,
            callbackPath: DISCORD_CALLBACK_PATH,
            updatedAt: normalizeString(doc?.updatedAt) || null,
            lastTestedAt: normalizeString(doc?.lastTestedAt) || null,
            lastTestedUser,
        }
    }
    const saveDiscordAuthConfig = async ({clientId, clientSecret}) => {
        if (!vaultClient?.mongo?.update) {
            throw new Error('Vault storage is not configured.')
        }

        const nextClientId = normalizeString(clientId)
        const nextClientSecret = normalizeString(clientSecret)
        if (!nextClientId || !nextClientSecret) {
            throw new Error('Discord client ID and client secret are required.')
        }

        const updatedAt = new Date().toISOString()
        await vaultClient.mongo.update(
            settingsCollection,
            {key: DISCORD_AUTH_SETTINGS_KEY},
            {
                $set: {
                    key: DISCORD_AUTH_SETTINGS_KEY,
                    clientId: nextClientId,
                    clientSecret: nextClientSecret,
                    callbackPath: DISCORD_CALLBACK_PATH,
                    updatedAt,
                    updatedBy: serviceName,
                    lastTestedAt: null,
                    lastTestedUser: null,
                },
            },
            {upsert: true},
        )

        return {
            key: DISCORD_AUTH_SETTINGS_KEY,
            configured: true,
            clientId: nextClientId,
            clientSecret: nextClientSecret,
            callbackPath: DISCORD_CALLBACK_PATH,
            updatedAt,
            lastTestedAt: null,
            lastTestedUser: null,
        }
    }
    const markDiscordAuthConfigTested = async (identity) => {
        if (!vaultClient?.mongo?.update) {
            return null
        }

        const testedAt = new Date().toISOString()
        const snapshot = {
            id: normalizeDiscordUserId(identity?.id) || null,
            username: normalizeString(identity?.username) || null,
            globalName: normalizeString(identity?.globalName) || null,
            avatarUrl: normalizeString(identity?.avatarUrl) || null,
            email: normalizeString(identity?.email) || null,
        }

        await vaultClient.mongo.update(
            settingsCollection,
            {key: DISCORD_AUTH_SETTINGS_KEY},
            {
                $set: {
                    key: DISCORD_AUTH_SETTINGS_KEY,
                    callbackPath: DISCORD_CALLBACK_PATH,
                    lastTestedAt: testedAt,
                    lastTestedUser: snapshot,
                    updatedAt: testedAt,
                    updatedBy: serviceName,
                },
            },
            {upsert: true},
        )

        return {
            lastTestedAt: testedAt,
            lastTestedUser: snapshot,
        }
    }
    const buildOauthRedirectTarget = (value, fallback = '/') => {
        const normalized = normalizeString(value)
        if (!normalized.startsWith('/')) {
            return fallback
        }
        return normalized
    }
    const fetchDiscordJson = async (url, init = {}, {expectFormError = false} = {}) => {
        const response = await discordOauthFetch(url, init)
        const text = await response.text().catch(() => '')
        let payload = {}
        if (text) {
            try {
                payload = JSON.parse(text)
            } catch {
                payload = {error: text}
            }
        }

        if (!response.ok) {
            const message =
                normalizeString(payload?.error_description)
                || normalizeString(payload?.error)
                || `Discord responded with HTTP ${response.status}.`
            const error = new Error(message)
            error.status = response.status
            error.payload = payload
            if (!expectFormError || response.status < 400 || response.status >= 500) {
                logger.warn?.(`[${serviceName}] Discord OAuth request failed (${response.status}): ${message}`)
            }
            throw error
        }

        return payload
    }
    const exchangeDiscordAuthorizationCode = async ({code, redirectUri}) => {
        const config = await readDiscordAuthConfig()
        if (!config.configured || !config.clientId || !config.clientSecret) {
            throw new Error('Discord OAuth is not configured.')
        }

        const body = new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
        })

        return fetchDiscordJson(`${discordOauthBaseUrl}/oauth2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: body.toString(),
        }, {expectFormError: true})
    }
    const fetchDiscordIdentity = async (accessToken) => {
        const payload = await fetchDiscordJson(`${discordOauthBaseUrl}/users/@me`, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
            },
        })

        const id = normalizeDiscordUserId(payload?.id)
        if (!id) {
            throw new Error('Discord did not return a valid user ID.')
        }

        return {
            id,
            username: normalizeString(payload?.username) || null,
            globalName: normalizeString(payload?.global_name) || null,
            avatarUrl: normalizeString(buildDiscordAvatarUrl({id, avatar: payload?.avatar})) || null,
            email: normalizeString(payload?.email) || null,
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

        const existingDefaultMemberPermissions = await vaultClient.mongo.findOne(settingsCollection, {
            key: DEFAULT_MEMBER_PERMISSIONS_SETTINGS.key,
        })
        if (!existingDefaultMemberPermissions) {
            await vaultClient.mongo.update(
                settingsCollection,
                {key: DEFAULT_MEMBER_PERMISSIONS_SETTINGS.key},
                {
                    $set: {
                        ...DEFAULT_MEMBER_PERMISSIONS_SETTINGS,
                        permissions: normalizeDefaultMemberPermissions(DEFAULT_MEMBER_PERMISSIONS_SETTINGS.permissions),
                        updatedAt: timestamp,
                    },
                },
                {upsert: true},
            )
        }

        const existingDownloadWorkerSettings = await vaultClient.mongo.findOne(settingsCollection, {
            key: DEFAULT_DOWNLOAD_WORKER_SETTINGS.key,
        })
        if (!existingDownloadWorkerSettings) {
            await vaultClient.mongo.update(
                settingsCollection,
                {key: DEFAULT_DOWNLOAD_WORKER_SETTINGS.key},
                {
                    $set: {
                        ...DEFAULT_DOWNLOAD_WORKER_SETTINGS,
                        threadRateLimitsKbps: normalizeThreadRateLimits(DEFAULT_DOWNLOAD_WORKER_SETTINGS.threadRateLimitsKbps),
                        updatedAt: timestamp,
                    },
                },
                {upsert: true},
            )
        }
    }
    const readDefaultMemberPermissions = async () => {
        if (!vaultClient?.mongo?.findOne) {
            return {
                key: DEFAULT_MEMBER_PERMISSIONS_SETTINGS.key,
                permissions: normalizeDefaultMemberPermissions(DEFAULT_MEMBER_PERMISSIONS_SETTINGS.permissions),
                updatedAt: null,
            }
        }

        const doc = await vaultClient.mongo.findOne(settingsCollection, {
            key: DEFAULT_MEMBER_PERMISSIONS_SETTINGS.key,
        })

        return {
            key: DEFAULT_MEMBER_PERMISSIONS_SETTINGS.key,
            permissions: normalizeDefaultMemberPermissions(doc?.permissions ?? DEFAULT_MEMBER_PERMISSIONS_SETTINGS.permissions),
            updatedAt: normalizeString(doc?.updatedAt) || null,
        }
    }
    const writeDefaultMemberPermissions = async (permissions) => {
        if (!vaultClient?.mongo?.update) {
            throw new Error('Vault storage is not configured.')
        }

        const nextPermissions = normalizeDefaultMemberPermissions(permissions)
        const updatedAt = new Date().toISOString()
        await vaultClient.mongo.update(
            settingsCollection,
            {key: DEFAULT_MEMBER_PERMISSIONS_SETTINGS.key},
            {
                $set: {
                    key: DEFAULT_MEMBER_PERMISSIONS_SETTINGS.key,
                    permissions: nextPermissions,
                    updatedAt,
                },
            },
            {upsert: true},
        )

        return {
            key: DEFAULT_MEMBER_PERMISSIONS_SETTINGS.key,
            permissions: nextPermissions,
            updatedAt,
        }
    }
    const readDownloadWorkerSettings = async () => {
        if (!vaultClient?.mongo?.findOne) {
            return {
                key: DEFAULT_DOWNLOAD_WORKER_SETTINGS.key,
                threadRateLimitsKbps: normalizeThreadRateLimits(DEFAULT_DOWNLOAD_WORKER_SETTINGS.threadRateLimitsKbps),
                updatedAt: null,
            }
        }

        const doc = await vaultClient.mongo.findOne(settingsCollection, {
            key: DEFAULT_DOWNLOAD_WORKER_SETTINGS.key,
        })

        return {
            key: DEFAULT_DOWNLOAD_WORKER_SETTINGS.key,
            threadRateLimitsKbps: normalizeThreadRateLimits(doc?.threadRateLimitsKbps),
            updatedAt: normalizeString(doc?.updatedAt) || null,
        }
    }
    const writeDownloadWorkerSettings = async (threadRateLimitsKbps) => {
        if (!vaultClient?.mongo?.update) {
            throw new Error('Vault storage is not configured.')
        }

        const nextThreadRateLimitsKbps = normalizeThreadRateLimits(threadRateLimitsKbps)
        const updatedAt = new Date().toISOString()
        await vaultClient.mongo.update(
            settingsCollection,
            {key: DEFAULT_DOWNLOAD_WORKER_SETTINGS.key},
            {
                $set: {
                    key: DEFAULT_DOWNLOAD_WORKER_SETTINGS.key,
                    threadRateLimitsKbps: nextThreadRateLimitsKbps,
                    updatedAt,
                },
            },
            {upsert: true},
        )

        return {
            key: DEFAULT_DOWNLOAD_WORKER_SETTINGS.key,
            threadRateLimitsKbps: nextThreadRateLimitsKbps,
            updatedAt,
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
            normalizeString(process.env.HOST_SERVICE_URL) ||
            normalizeString(process.env.SERVER_IP)

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
            const targetLookup = normalizeUserLookupKey(targetUser) || normalizeUsername(targetUser.username)
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

            const demotionLookup = lookupKey || normalizeUsername(user?.username)
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
    const writeDiscordAdminToVault = async (identity) => {
        if (!hasVaultUserApi()) {
            throw new Error('Vault user storage is not configured.')
        }

        const discordUserId = normalizeDiscordUserId(identity?.id)
        if (!discordUserId) {
            throw new Error('Discord user ID is required.')
        }

        const lookupKey = buildDiscordLookupKey(discordUserId)
        const username = resolveDiscordDisplayName(identity, `Discord ${discordUserId}`)
        const now = new Date().toISOString()
        const users = await listAuthUsers()
        const existingUserByDiscord = findUserByDiscordId(users, discordUserId)
        const existingAdmin = selectPrimaryAdmin(users)
        const targetUser = existingUserByDiscord || existingAdmin || null
        let created = false

        if (targetUser) {
            const targetLookup = normalizeUserLookupKey(targetUser)
            if (!targetLookup) {
                throw new Error('Unable to resolve existing admin account.')
            }

            await updateAuthUser(targetLookup, {
                username,
                role: 'admin',
                permissions: [...MOON_OP_PERMISSION_KEYS],
                isBootstrapUser: true,
                authProvider: DISCORD_AUTH_PROVIDER,
                discordUserId,
                discordUsername: identity?.username || null,
                discordGlobalName: identity?.globalName || null,
                avatarUrl: identity?.avatarUrl || null,
                email: identity?.email || null,
            })
        } else {
            await createAuthUser({
                username,
                role: 'admin',
                permissions: [...MOON_OP_PERMISSION_KEYS],
                isBootstrapUser: true,
                authProvider: DISCORD_AUTH_PROVIDER,
                discordUserId,
                discordUsername: identity?.username || null,
                discordGlobalName: identity?.globalName || null,
                avatarUrl: identity?.avatarUrl || null,
                email: identity?.email || null,
            })
            created = true
        }

        const allUsersAfterWrite = await listAuthUsers()
        for (const user of allUsersAfterWrite) {
            if (!isAdminUser(user)) {
                continue
            }

            const currentLookup = normalizeUserLookupKey(user)
            if (currentLookup === lookupKey) {
                continue
            }

            if (!currentLookup) {
                continue
            }

            await updateAuthUser(currentLookup, {
                role: 'member',
                permissions: [...DEFAULT_MEMBER_PERMISSION_KEYS],
                isBootstrapUser: false,
            })
        }

        const refreshedUsers = await listAuthUsers()
        const verifiedUser = findUserByDiscordId(refreshedUsers, discordUserId)
        if (!verifiedUser || !isAdminUser(verifiedUser)) {
            throw new Error('Bootstrap verification failed after Discord account write.')
        }

        await ensureDefaultSettings(now)

        return {
            created,
            user: toSessionUser(verifiedUser, username),
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
        buildDiscordLookupKey,
        buildOauthRedirectTarget,
        buildVerificationCheckResult,
        consumeOauthState,
        collectVerificationHealth,
        createAuthUser,
        createEmptyVerificationSummary,
        createSessionToken,
        defaultPermissionsForRole,
        DEFAULT_DOWNLOAD_WORKER_SETTINGS,
        DEFAULT_MEMBER_PERMISSIONS_SETTINGS,
        DEFAULT_NAMING_SETTINGS,
        deleteAuthUser,
        DISCORD_AUTH_PROVIDER,
        DISCORD_CALLBACK_PATH,
        discordSetupClient,
        dropSession,
        ensureMoonPermission,
        exchangeDiscordAuthorizationCode,
        fetchDiscordIdentity,
        finalizePendingAdminToVault,
        findUserByDiscordId,
        findUserByLookupKey,
        generateTemporaryPassword,
        hasMoonPermission,
        hasVaultUserApi,
        inferRoleFromPermissions,
        isValidPassword,
        isValidUsername,
        LOCAL_AUTH_PROVIDER,
        listAuthUsers,
        logger,
        markDiscordAuthConfigTested,
        managedKavitaSetupClient,
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
        readDefaultMemberPermissions,
        readDebugSetting,
        readDownloadWorkerSettings,
        readDiscordAuthConfig,
        readVerificationSummary,
        requireAdminSession,
        requireAdminSessionIfSetupCompleted,
        requirePermissionSession,
        requireSession,
        requireSessionIfSetupCompleted,
        resolveBaseRedirectUrl,
        resolveProtectedBootstrapLookupKey,
        resolveStoredAuthProvider,
        resolveSetupCompleted,
        resolveWizardStepKey,
        saveDiscordAuthConfig,
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
        validateThreadRateLimitsInput,
        vaultClient,
        vaultErrorMessage,
        vaultErrorStatus,
        VERIFICATION_SERVICES,
        verifyFactoryResetSelections,
        verifySessionPassword,
        wizardMetadata,
        wizardStateClient,
        writeDefaultMemberPermissions,
        writeDownloadWorkerSettings,
        writeDiscordAdminToVault,
        writeOauthState,
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
                              managedKavitaSetupClient,
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
        managedKavitaSetupClient,
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
