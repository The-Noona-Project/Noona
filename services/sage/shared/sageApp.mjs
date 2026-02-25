// services/sage/shared/sageApp.mjs

import express from 'express'
import cors from 'cors'
import crypto from 'node:crypto'

import {debugMSG, errMSG, isDebugEnabled, log, setDebug} from '../../../utilities/etc/logger.mjs'
import {SetupValidationError} from './errors.mjs'
import {createDiscordSetupClient} from './discordSetupClient.mjs'
import {createRavenClient} from './ravenClient.mjs'
import {createWizardStateClient} from './wizardStateClient.mjs'
import {createVaultPacketClient, isVaultClientErrorStatus} from './vaultPacketClient.mjs'
import {
    createDefaultWizardState,
    normalizeWizardMetadata,
    resolveWizardStateOperation,
    WIZARD_STEP_KEYS,
} from './wizardStateSchema.mjs'

const defaultServiceName = () => process.env.SERVICE_NAME || 'noona-sage'
const defaultPort = () => process.env.API_PORT || 3004
const normalizeUrl = (candidate) => {
    if (!candidate || typeof candidate !== 'string') {
        return null
    }

    const trimmed = candidate.trim()
    if (!trimmed) {
        return null
    }

    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed
    }

    return `http://${trimmed}`
}

const resolveDefaultWardenUrls = (env = process.env) => {
    const candidates = [
        env?.WARDEN_BASE_URL,
        env?.WARDEN_INTERNAL_BASE_URL,
        env?.WARDEN_DOCKER_URL,
    ]

    const hostCandidates = [
        env?.WARDEN_HOST,
        env?.WARDEN_SERVICE_HOST,
    ]

    for (const host of hostCandidates) {
        if (typeof host === 'string' && host.trim()) {
            const port = env?.WARDEN_PORT || '4001'
            const normalizedHost = host.trim()
            candidates.push(`${normalizedHost}:${port}`)
        }
    }

    candidates.push(
        'http://noona-warden:4001',
        'http://warden:4001',
        'http://host.docker.internal:4001',
        'http://127.0.0.1:4001',
        'http://localhost:4001',
    )

    const normalized = candidates
        .map(normalizeUrl)
        .filter(Boolean)

    return Array.from(new Set(normalized))
}

const defaultWardenBaseUrl = (env = process.env) => {
    const [first] = resolveDefaultWardenUrls(env)
    return first || 'http://localhost:4001'
}

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
    { name: 'noona-vault', label: 'Vault' },
    { name: 'noona-redis', label: 'Redis' },
    { name: 'noona-mongo', label: 'Mongo' },
    { name: 'noona-portal', label: 'Portal' },
    { name: 'noona-raven', label: 'Raven' },
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

export const normalizeServiceInstallPayload = (services) => {
    if (!Array.isArray(services) || services.length === 0) {
        throw new SetupValidationError('Body must include a non-empty "services" array.')
    }

    return services.map((entry) => {
        if (typeof entry === 'string' || typeof entry === 'number') {
            const trimmed = String(entry).trim()
            if (!trimmed) {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            return { name: trimmed }
        }

        if (!entry || typeof entry !== 'object') {
            throw new SetupValidationError('Service entries must be strings or objects with a "name" field.')
        }

        const name = typeof entry.name === 'string' ? entry.name.trim() : ''
        if (!name) {
            throw new SetupValidationError('Service descriptor is missing a valid "name" field.')
        }

        if (entry.env != null && (typeof entry.env !== 'object' || Array.isArray(entry.env))) {
            throw new SetupValidationError(`Environment overrides for ${name} must be provided as an object.`)
        }

        let env = null
        if (entry.env) {
            const normalized = {}

            for (const [key, value] of Object.entries(entry.env)) {
                if (typeof key !== 'string') {
                    continue
                }

                const trimmedKey = key.trim()
                if (!trimmedKey) {
                    continue
                }

                normalized[trimmedKey] = value == null ? '' : String(value)
            }

            if (Object.keys(normalized).length > 0) {
                env = normalized
            }
        }

        return env ? { name, env } : { name }
    })
}

const createSetupClient = ({
    baseUrl,
    baseUrls = [],
    fetchImpl = fetch,
    logger,
    serviceName,
    env = process.env,
} = {}) => {
    const defaults = resolveDefaultWardenUrls(env)
    const deduped = Array.from(
        new Set([
            normalizeUrl(baseUrl),
            ...baseUrls.map(normalizeUrl),
            ...defaults,
        ].filter(Boolean)),
    )

    if (deduped.length === 0) {
        deduped.push('http://localhost:4001')
    }

    let preferredBaseUrl = deduped[0]

    const fetchFromWarden = async (path, options) => {
        const errors = []
        const candidates = preferredBaseUrl
            ? [preferredBaseUrl, ...deduped.filter((url) => url !== preferredBaseUrl)]
            : deduped

        for (const candidate of candidates) {
            try {
                const requestUrl = new URL(path, candidate)
                const response = await fetchImpl(requestUrl.toString(), options)

                if (!response.ok) {
                    throw new Error(`Warden responded with status ${response.status}`)
                }

                preferredBaseUrl = candidate
                return response
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                errors.push(`${candidate} (${message})`)
            }
        }

        throw new Error(`All Warden endpoints failed: ${errors.join(' | ')}`)
    }

    return {
        async listServices(options = {}) {
            const includeInstalled = options.includeInstalled ?? false
            const response = await fetchFromWarden(
                `/api/services?includeInstalled=${includeInstalled ? 'true' : 'false'}`,
            )

            const payload = await response.json()
            const services = Array.isArray(payload.services) ? payload.services : []

            logger.debug?.(
                `[${serviceName}] 📦 Retrieved ${services.length} services from Warden via ${preferredBaseUrl}`,
            )
            return services
        },

        async installServices(services) {
            const normalized = normalizeServiceInstallPayload(services)
            const response = await fetchFromWarden('/api/services/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ services: normalized }),
            })

            const payload = await response.json().catch(() => ({}))
            const results = Array.isArray(payload.results) ? payload.results : []
            const status = response.status || 200

            logger.info?.(
                `[${serviceName}] 🚀 Installation request forwarded for ${normalized.length} services (status: ${status}) via ${preferredBaseUrl}`,
            )
            return { status, results }
        },
        async getInstallProgress() {
            const response = await fetchFromWarden('/api/services/install/progress')
            return await response.json().catch(() => ({ items: [], status: 'idle', percent: null }))
        },
        async getInstallationLogs(options = {}) {
            const limit = options?.limit
            const suffix = limit ? `?limit=${encodeURIComponent(limit)}` : ''
            const response = await fetchFromWarden(`/api/services/installation/logs${suffix}`)
            return await response
                .json()
                .catch(() => ({
                    service: 'installation',
                    entries: [],
                    summary: { status: 'idle', percent: null, detail: null, updatedAt: null },
                }))
        },
        async getServiceLogs(name, options = {}) {
            if (!name || typeof name !== 'string') {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const trimmed = name.trim()
            const limit = options?.limit
            const suffix = limit ? `?limit=${encodeURIComponent(limit)}` : ''
            const response = await fetchFromWarden(`/api/services/${encodeURIComponent(trimmed)}/logs${suffix}`)
            return await response.json().catch(() => ({ service: trimmed, entries: [], summary: {} }))
        },
        async testService(name, body = {}) {
            if (!name || typeof name !== 'string') {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const trimmed = name.trim()
            const response = await fetchFromWarden(`/api/services/${encodeURIComponent(trimmed)}/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body ?? {}),
            })

            const payload = await response.json().catch(() => ({}))
            return { status: response.status ?? 200, result: payload }
        },
        async detectRavenMount() {
            const response = await fetchFromWarden('/api/services/noona-raven/detect', {
                method: 'POST',
            })

            const payload = await response.json().catch(() => ({}))
            return { status: response.status ?? 200, detection: payload?.detection ?? null, error: payload?.error }
        },
        async getServiceHealth(name) {
            if (!name || typeof name !== 'string') {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const trimmed = name.trim()
            if (!trimmed) {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const response = await fetchFromWarden(`/api/services/${encodeURIComponent(trimmed)}/health`)
            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                const message = payload?.error || `Unable to retrieve health for ${trimmed}.`
                throw new Error(message)
            }

            return payload
        },
        async getServiceConfig(name) {
            if (!name || typeof name !== 'string') {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const trimmed = name.trim()
            if (!trimmed) {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const response = await fetchFromWarden(`/api/services/${encodeURIComponent(trimmed)}/config`)
            return await response.json().catch(() => ({}))
        },
        async updateServiceConfig(name, updates = {}) {
            if (!name || typeof name !== 'string') {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const trimmed = name.trim()
            if (!trimmed) {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const response = await fetchFromWarden(`/api/services/${encodeURIComponent(trimmed)}/config`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(updates ?? {}),
            })

            return await response.json().catch(() => ({}))
        },
        async restartService(name) {
            if (!name || typeof name !== 'string') {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const trimmed = name.trim()
            if (!trimmed) {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const response = await fetchFromWarden(`/api/services/${encodeURIComponent(trimmed)}/restart`, {
                method: 'POST',
            })

            return await response.json().catch(() => ({}))
        },
        async listServiceUpdates() {
            const response = await fetchFromWarden('/api/services/updates')
            const payload = await response.json().catch(() => ({}))
            return Array.isArray(payload?.updates) ? payload.updates : []
        },
        async checkServiceUpdates(services = null) {
            const body = Array.isArray(services) ? {services} : {}
            const response = await fetchFromWarden('/api/services/updates/check', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body),
            })

            const payload = await response.json().catch(() => ({}))
            return Array.isArray(payload?.updates) ? payload.updates : []
        },
        async updateServiceImage(name, options = {}) {
            if (!name || typeof name !== 'string') {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const trimmed = name.trim()
            if (!trimmed) {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const response = await fetchFromWarden(`/api/services/${encodeURIComponent(trimmed)}/update`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(options ?? {}),
            })

            return await response.json().catch(() => ({}))
        },
        async startEcosystem(options = {}) {
            const response = await fetchFromWarden('/api/ecosystem/start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(options ?? {}),
            })

            return await response.json().catch(() => ({}))
        },
        async stopEcosystem(options = {}) {
            const response = await fetchFromWarden('/api/ecosystem/stop', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(options ?? {}),
            })

            return await response.json().catch(() => ({}))
        },
        async restartEcosystem(options = {}) {
            const response = await fetchFromWarden('/api/ecosystem/restart', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(options ?? {}),
            })

            return await response.json().catch(() => ({}))
        },
        async factoryResetEcosystem(options = {}) {
            const response = await fetchFromWarden('/api/ecosystem/factory-reset', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(options ?? {}),
            })

            return await response.json().catch(() => ({}))
        },
        async setDebug(enabled) {
            const response = await fetchFromWarden('/api/debug', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({enabled: !!enabled}),
            })

            return await response.json().catch(() => ({}))
        },
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

        const fallback = selectPrimaryAdmin(users)
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

    app.get('/health', (req, res) => {
        logger.debug(`[${serviceName}] ✅ Healthcheck OK`)
        res.status(200).send('Sage is live!')
    })

    app.post('/api/auth/bootstrap', async (req, res) => {
        try {
            const setupCompleted = await resolveSetupCompleted()
            if (setupCompleted) {
                res.status(409).json({error: 'Setup already completed.'})
                return
            }

            const username = normalizeUsername(req.body?.username)
            const password = typeof req.body?.password === 'string' ? req.body.password : ''

            if (!username || !isValidUsername(username)) {
                res.status(400).json({error: 'username must be 3-64 characters (letters, numbers, ., _, -).'})
                return
            }

            if (!isValidPassword(password)) {
                res.status(400).json({error: 'password must be at least 8 characters.'})
                return
            }

            const created = pendingAdmin == null
            setPendingAdminCredentials({username, password})

            res.json({
                ok: true,
                created,
                persisted: false,
                username,
                role: 'admin',
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to bootstrap admin user: ${error.message}`)
            const message = error instanceof Error && error.message.trim()
                ? error.message.trim()
                : 'Unable to bootstrap admin user.'
            const status = 502
            res.status(status).json({error: message})
        }
    })

    app.get('/api/auth/bootstrap/status', async (_req, res) => {
        try {
            const setupCompleted = await resolveSetupCompleted()
            const pendingUser = pendingAdminPublicUser()
            if (pendingUser) {
                res.json({
                    setupCompleted: setupCompleted === true,
                    adminExists: true,
                    username: pendingUser.username,
                    persisted: false,
                })
                return
            }

            if (!vaultClient?.users) {
                res.json({
                    setupCompleted: setupCompleted === true,
                    adminExists: false,
                    username: null,
                    persisted: false,
                })
                return
            }

            const users = await listAuthUsers()
            const existingAdmin = selectPrimaryAdmin(users)
            const username = normalizeUsername(existingAdmin?.username) || null

            res.json({
                setupCompleted: setupCompleted === true,
                adminExists: Boolean(existingAdmin),
                username,
                persisted: Boolean(existingAdmin),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load bootstrap status: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to load bootstrap status.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/bootstrap/finalize', async (req, res) => {
        const session = await requireAdminSession(req, res)
        if (!session) return

        if (!pendingAdmin) {
            res.json({
                ok: true,
                persisted: false,
                username: normalizeUsername(session?.username) || null,
            })
            return
        }

        if (!hasVaultUserApi()) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        try {
            const persisted = await finalizePendingAdminToVault()
            if (req.sessionToken && session && typeof session === 'object') {
                await writeSession(req.sessionToken, session, sessionTtlSeconds)
            }

            res.json({
                ok: true,
                persisted: persisted.persisted === true,
                created: persisted.created === true,
                username: normalizeUsername(persisted.user?.username) || null,
                role: normalizeRole(persisted.user?.role, 'admin'),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to finalize bootstrap admin user: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to finalize admin user.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/login', async (req, res) => {
        try {
            const username = normalizeUsername(req.body?.username)
            const password = typeof req.body?.password === 'string' ? req.body.password : ''

            if (!username || !password) {
                res.status(400).json({error: 'username and password are required.'})
                return
            }

            let authResult = authenticatePendingAdmin({username, password})

            if (!authResult?.authenticated && vaultClient?.users?.authenticate) {
                authResult = await authenticateAuthUser({username, password})
            }

            if (!authResult?.authenticated && !vaultClient?.users?.authenticate && !pendingAdmin) {
                res.status(503).json({error: 'Vault storage is not configured.'})
                return
            }

            if (!authResult?.authenticated || !authResult.user) {
                res.status(401).json({error: 'Invalid credentials.'})
                return
            }

            const token = createSessionToken()
            const session = toSessionUser(authResult.user, username)
            if (!hasMoonPermission(session, 'moon_login')) {
                res.status(403).json({error: 'Moon login permission is required for this account.'})
                return
            }
            await writeSession(token, session, sessionTtlSeconds)
            res.json({
                token,
                user: {
                    username: session.username,
                    role: session.role,
                    permissions: session.permissions,
                    isBootstrapUser: session.isBootstrapUser === true,
                },
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to login: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to login.')
            res.status(status).json({error: message})
        }
    })

    app.get('/api/auth/status', async (req, res) => {
        try {
            const session = await requireSession(req, res)
            if (!session) return
            res.json({user: session})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load auth status: ${error.message}`)
            res.status(502).json({error: 'Unable to validate session.'})
        }
    })

    app.post('/api/auth/logout', async (req, res) => {
        try {
            const session = await requireSession(req, res)
            if (!session) return

            await dropSession(req.sessionToken)
            res.json({ok: true})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to logout: ${error.message}`)
            res.status(502).json({error: 'Unable to logout.'})
        }
    })

    app.get('/api/auth/users', async (req, res) => {
        if (!vaultClient?.users) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        try {
            const users = await listAuthUsers()
            const protectedLookupKey = resolveProtectedBootstrapLookupKey(users)
            const mappedUsers = users
                .map((entry) => applyProtectedBootstrapUserFlag(publicUser(entry), protectedLookupKey))
                .filter((entry) => Boolean(entry.usernameNormalized))
            res.json({
                users: mappedUsers,
                permissions: [...MOON_OP_PERMISSION_KEYS],
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to list auth users: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to list users.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/users', async (req, res) => {
        if (!vaultClient?.users) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        const username = normalizeUsername(req.body?.username)
        const password = typeof req.body?.password === 'string' ? req.body.password : ''
        const hasRoleInput = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'role')
        let role = hasRoleInput ? normalizeRole(req.body?.role, 'member') : 'member'
        const hasPermissionsInput = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'permissions')
        let permissions = hasPermissionsInput ? [] : defaultPermissionsForRole(role)

        if (hasPermissionsInput) {
            const parsedPermissions = validatePermissionListInput(req.body?.permissions)
            if (!parsedPermissions.ok) {
                res.status(400).json({error: parsedPermissions.error})
                return
            }
            permissions = parsedPermissions.permissions
        }

        if (role === 'admin' && !permissions.includes('admin')) {
            permissions = sortMoonPermissions([...permissions, 'admin'])
        }
        if (role !== 'admin' && permissions.includes('admin')) {
            role = 'admin'
        }
        if (role !== 'admin') {
            permissions = sortMoonPermissions(permissions.filter((entry) => entry !== 'admin'))
        }

        if (!isValidUsername(username)) {
            res.status(400).json({error: 'username must be 3-64 characters (letters, numbers, ., _, -).'})
            return
        }

        if (!isValidPassword(password)) {
            res.status(400).json({error: 'password must be at least 8 characters.'})
            return
        }

        try {
            const payload = await createAuthUser({
                username,
                password,
                role,
                permissions,
                isBootstrapUser: false,
            })
            res.status(201).json({ok: true, user: publicUser(payload?.user, username)})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to create auth user: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to create user.')
            res.status(status).json({error: message})
        }
    })

    app.put('/api/auth/users/:username', async (req, res) => {
        if (!vaultClient?.users) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        const lookupUsername = normalizeUsername(req.params?.username)
        const lookupKey = normalizeUsernameKey(lookupUsername)
        if (!lookupUsername) {
            res.status(400).json({error: 'username is required.'})
            return
        }

        const hasUsernameUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'username')
        const hasPasswordUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'password')
        const hasRoleUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'role')
        const hasPermissionsUpdate = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'permissions')

        if (!hasUsernameUpdate && !hasPasswordUpdate && !hasRoleUpdate && !hasPermissionsUpdate) {
            res.status(400).json({error: 'At least one user field must be updated.'})
            return
        }

        try {
            const users = await listAuthUsers()
            const targetUser = findUserByLookupKey(users, lookupKey)
            if (!targetUser) {
                res.status(404).json({error: 'User not found.'})
                return
            }

            const protectedLookupKey = resolveProtectedBootstrapLookupKey(users)
            if (protectedLookupKey && normalizeUserLookupKey(targetUser) === protectedLookupKey) {
                res.status(403).json({error: 'Setup wizard account is protected and cannot be modified.'})
                return
            }

            const updates = {}
            if (hasUsernameUpdate) {
                const nextUsername = normalizeUsername(req.body?.username)
                if (!isValidUsername(nextUsername)) {
                    res.status(400).json({error: 'username must be 3-64 characters (letters, numbers, ., _, -).'})
                    return
                }
                updates.username = nextUsername
            }

            if (hasPasswordUpdate) {
                const nextPassword = typeof req.body?.password === 'string' ? req.body.password : ''
                if (!isValidPassword(nextPassword)) {
                    res.status(400).json({error: 'password must be at least 8 characters.'})
                    return
                }
                updates.password = nextPassword
            }

            if (hasPermissionsUpdate) {
                const parsedPermissions = validatePermissionListInput(req.body?.permissions)
                if (!parsedPermissions.ok) {
                    res.status(400).json({error: parsedPermissions.error})
                    return
                }
                updates.permissions = parsedPermissions.permissions
                updates.role = inferRoleFromPermissions(parsedPermissions.permissions, normalizeRole(targetUser?.role, 'member'))
            } else if (hasRoleUpdate) {
                updates.role = normalizeRole(req.body?.role, normalizeRole(targetUser?.role, 'member'))
                updates.permissions = defaultPermissionsForRole(updates.role)
            }

            if (updates.role === 'admin' && Array.isArray(updates.permissions) && !updates.permissions.includes('admin')) {
                updates.permissions = sortMoonPermissions([...updates.permissions, 'admin'])
            }
            if (updates.role !== 'admin' && Array.isArray(updates.permissions)) {
                updates.permissions = sortMoonPermissions(updates.permissions.filter((entry) => entry !== 'admin'))
            }

            const payload = await updateAuthUser(lookupUsername, updates)
            const updated = publicUser(payload?.user, updates.username || lookupUsername)
            if (req.sessionToken && lookupKey === normalizeUsernameKey(session?.usernameNormalized || session?.username)) {
                await writeSession(req.sessionToken, toSessionUser(updated, updated.username), sessionTtlSeconds)
            }

            res.json({ok: true, user: updated})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to update auth user: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to update user.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/auth/users/:username/reset-password', async (req, res) => {
        if (!vaultClient?.users) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        const lookupUsername = normalizeUsername(req.params?.username)
        const lookupKey = normalizeUsernameKey(lookupUsername)
        if (!lookupKey) {
            res.status(400).json({error: 'username is required.'})
            return
        }

        try {
            const users = await listAuthUsers()
            const targetUser = findUserByLookupKey(users, lookupKey)
            if (!targetUser) {
                res.status(404).json({error: 'User not found.'})
                return
            }

            const protectedLookupKey = resolveProtectedBootstrapLookupKey(users)
            if (protectedLookupKey && normalizeUserLookupKey(targetUser) === protectedLookupKey) {
                res.status(403).json({error: 'Setup wizard account is protected and cannot be modified.'})
                return
            }

            const password = generateTemporaryPassword()
            const payload = await updateAuthUser(lookupUsername, {password})
            const updated = publicUser(payload?.user, lookupUsername)
            if (req.sessionToken && lookupKey === normalizeUsernameKey(session?.usernameNormalized || session?.username)) {
                await writeSession(req.sessionToken, toSessionUser(updated, updated.username), sessionTtlSeconds)
            }

            res.json({ok: true, user: updated, password})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to reset auth user password: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to reset user password.')
            res.status(status).json({error: message})
        }
    })

    app.delete('/api/auth/users/:username', async (req, res) => {
        if (!vaultClient?.users) {
            res.status(503).json({error: 'Vault user storage is not configured.'})
            return
        }

        const session = await requirePermissionSession(req, res, 'user_management', {
            message: 'User management permission is required.',
        })
        if (!session) return

        const lookupUsername = normalizeUsername(req.params?.username)
        const lookupKey = normalizeUsernameKey(lookupUsername)
        if (!lookupKey) {
            res.status(400).json({error: 'username is required.'})
            return
        }

        try {
            const users = await listAuthUsers()
            const targetUser = findUserByLookupKey(users, lookupKey)
            if (!targetUser) {
                res.status(404).json({error: 'User not found.'})
                return
            }

            const protectedLookupKey = resolveProtectedBootstrapLookupKey(users)
            if (protectedLookupKey && normalizeUserLookupKey(targetUser) === protectedLookupKey) {
                res.status(403).json({error: 'Setup wizard account is protected and cannot be deleted.'})
                return
            }

            if (lookupKey === normalizeUsernameKey(session.usernameNormalized || session.username)) {
                res.status(400).json({error: 'Cannot delete the active session user.'})
                return
            }

            const payload = await deleteAuthUser(lookupUsername)
            if (payload?.deleted !== true) {
                res.status(404).json({error: 'User not found.'})
                return
            }

            res.json({deleted: true})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to delete auth user: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to delete user.')
            res.status(status).json({error: message})
        }
    })
    app.use('/api/settings', requireAdminSessionIfSetupCompleted)

    app.get('/api/settings/debug', async (_req, res) => {
        if (!vaultClient?.mongo?.findOne) {
            res.status(503).json({error: 'Vault storage is not configured.'})
            return
        }

        try {
            const setting = await readDebugSetting()
            res.json(setting)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load debug setting: ${error.message}`)
            res.status(502).json({error: 'Unable to load debug setting.'})
        }
    })

    app.put('/api/settings/debug', async (req, res) => {
        const session = await requireAdminSession(req, res)
        if (!session) return

        const enabled = parseBooleanInput(req.body?.enabled)
        if (enabled == null) {
            res.status(400).json({error: 'enabled must be a boolean value.'})
            return
        }

        try {
            const setting = await applyDebugSetting(enabled)
            res.json(setting)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to update debug setting: ${error.message}`)
            const message = error instanceof Error ? error.message : 'Unable to update debug setting.'
            res.status(502).json({error: message})
        }
    })

    app.get('/api/settings/downloads/naming', async (_req, res) => {
        if (!vaultClient) {
            res.status(503).json({error: 'Vault storage is not configured.'})
            return
        }

        try {
            const doc = await vaultClient.mongo.findOne(settingsCollection, {
                key: DEFAULT_NAMING_SETTINGS.key,
            })

            res.json({
                key: DEFAULT_NAMING_SETTINGS.key,
                titleTemplate:
                    typeof doc?.titleTemplate === 'string' && doc.titleTemplate.trim()
                        ? doc.titleTemplate.trim()
                        : DEFAULT_NAMING_SETTINGS.titleTemplate,
                chapterTemplate:
                    typeof doc?.chapterTemplate === 'string' && doc.chapterTemplate.trim()
                        ? doc.chapterTemplate.trim()
                        : DEFAULT_NAMING_SETTINGS.chapterTemplate,
                pageTemplate:
                    typeof doc?.pageTemplate === 'string' && doc.pageTemplate.trim()
                        ? doc.pageTemplate.trim()
                        : DEFAULT_NAMING_SETTINGS.pageTemplate,
                pagePad:
                    Number.isFinite(Number(doc?.pagePad)) && Number(doc.pagePad) > 0
                        ? Math.floor(Number(doc.pagePad))
                        : DEFAULT_NAMING_SETTINGS.pagePad,
                chapterPad:
                    Number.isFinite(Number(doc?.chapterPad)) && Number(doc.chapterPad) > 0
                        ? Math.floor(Number(doc.chapterPad))
                        : DEFAULT_NAMING_SETTINGS.chapterPad,
            })
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load naming settings: ${error.message}`)
            res.status(502).json({error: 'Unable to load naming settings.'})
        }
    })

    app.put('/api/settings/downloads/naming', async (req, res) => {
        if (!vaultClient) {
            res.status(503).json({error: 'Vault storage is not configured.'})
            return
        }

        try {
            const current = await vaultClient.mongo.findOne(settingsCollection, {
                key: DEFAULT_NAMING_SETTINGS.key,
            })

            const next = {
                key: DEFAULT_NAMING_SETTINGS.key,
                titleTemplate:
                    typeof req.body?.titleTemplate === 'string'
                        ? req.body.titleTemplate.trim()
                        : typeof current?.titleTemplate === 'string'
                            ? current.titleTemplate.trim()
                            : DEFAULT_NAMING_SETTINGS.titleTemplate,
                chapterTemplate:
                    typeof req.body?.chapterTemplate === 'string'
                        ? req.body.chapterTemplate.trim()
                        : typeof current?.chapterTemplate === 'string'
                            ? current.chapterTemplate.trim()
                            : DEFAULT_NAMING_SETTINGS.chapterTemplate,
                pageTemplate:
                    typeof req.body?.pageTemplate === 'string'
                        ? req.body.pageTemplate.trim()
                        : typeof current?.pageTemplate === 'string'
                            ? current.pageTemplate.trim()
                            : DEFAULT_NAMING_SETTINGS.pageTemplate,
                pagePad: Number.isFinite(Number(req.body?.pagePad))
                    ? Math.max(1, Math.min(12, Math.floor(Number(req.body.pagePad))))
                    : Number.isFinite(Number(current?.pagePad))
                        ? Math.max(1, Math.min(12, Math.floor(Number(current.pagePad))))
                        : DEFAULT_NAMING_SETTINGS.pagePad,
                chapterPad: Number.isFinite(Number(req.body?.chapterPad))
                    ? Math.max(1, Math.min(12, Math.floor(Number(req.body.chapterPad))))
                    : Number.isFinite(Number(current?.chapterPad))
                        ? Math.max(1, Math.min(12, Math.floor(Number(current.chapterPad))))
                        : DEFAULT_NAMING_SETTINGS.chapterPad,
            }

            if (!next.titleTemplate) {
                res.status(400).json({error: 'titleTemplate must not be empty.'})
                return
            }
            if (!next.chapterTemplate) {
                res.status(400).json({error: 'chapterTemplate must not be empty.'})
                return
            }
            if (!next.pageTemplate) {
                res.status(400).json({error: 'pageTemplate must not be empty.'})
                return
            }

            const now = new Date().toISOString()
            await vaultClient.mongo.update(
                settingsCollection,
                {key: DEFAULT_NAMING_SETTINGS.key},
                {$set: {...next, updatedAt: now}},
                {upsert: true},
            )

            res.json(next)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to update naming settings: ${error.message}`)
            res.status(502).json({error: 'Unable to update naming settings.'})
        }
    })

    app.get('/api/settings/services', async (_req, res) => {
        try {
            const services = await setupClient.listServices({includeInstalled: true})
            res.json({services: Array.isArray(services) ? services : []})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load service settings catalog: ${error.message}`)
            res.status(502).json({error: 'Unable to load service settings.'})
        }
    })

    app.get('/api/settings/services/updates', async (_req, res) => {
        try {
            const updates = await setupClient.listServiceUpdates()
            res.json({updates: Array.isArray(updates) ? updates : []})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to list service updates: ${error.message}`)
            res.status(502).json({error: 'Unable to load service updates.'})
        }
    })

    app.post('/api/settings/services/updates/check', async (req, res) => {
        const services = Array.isArray(req.body?.services) ? req.body.services : null

        try {
            const updates = await setupClient.checkServiceUpdates(services)
            res.json({updates: Array.isArray(updates) ? updates : []})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to check service updates: ${error.message}`)
            res.status(502).json({error: 'Unable to check service updates.'})
        }
    })

    app.get('/api/settings/services/:name/config', async (req, res) => {
        const name = typeof req.params?.name === 'string' ? req.params.name.trim() : ''
        if (!name) {
            res.status(400).json({error: 'Service name is required.'})
            return
        }

        try {
            const config = await setupClient.getServiceConfig(name)
            res.json(config ?? {})
        } catch (error) {
            const message = error instanceof SetupValidationError ? error.message : 'Unable to load service config.'
            const status = error instanceof SetupValidationError ? 400 : 502
            logger.error(`[${serviceName}] ⚠️ Failed to load service config for ${name}: ${error.message}`)
            res.status(status).json({error: message})
        }
    })

    app.put('/api/settings/services/:name/config', async (req, res) => {
        const name = typeof req.params?.name === 'string' ? req.params.name.trim() : ''
        if (!name) {
            res.status(400).json({error: 'Service name is required.'})
            return
        }

        try {
            const result = await setupClient.updateServiceConfig(name, req.body ?? {})
            res.json(result ?? {})
        } catch (error) {
            const message = error instanceof SetupValidationError ? error.message : 'Unable to update service config.'
            const status = error instanceof SetupValidationError ? 400 : 502
            logger.error(`[${serviceName}] ⚠️ Failed to update service config for ${name}: ${error.message}`)
            res.status(status).json({error: message})
        }
    })

    app.post('/api/settings/services/:name/restart', async (req, res) => {
        const name = typeof req.params?.name === 'string' ? req.params.name.trim() : ''
        if (!name) {
            res.status(400).json({error: 'Service name is required.'})
            return
        }

        try {
            const result = await setupClient.restartService(name)
            res.json(result ?? {})
        } catch (error) {
            const message = error instanceof SetupValidationError ? error.message : 'Unable to restart service.'
            const status = error instanceof SetupValidationError ? 400 : 502
            logger.error(`[${serviceName}] ⚠️ Failed to restart service ${name}: ${error.message}`)
            res.status(status).json({error: message})
        }
    })

    app.post('/api/settings/services/:name/update-image', async (req, res) => {
        const name = typeof req.params?.name === 'string' ? req.params.name.trim() : ''
        if (!name) {
            res.status(400).json({error: 'Service name is required.'})
            return
        }

        try {
            const result = await setupClient.updateServiceImage(name, req.body ?? {})
            res.json(result ?? {})
        } catch (error) {
            const message = error instanceof SetupValidationError ? error.message : 'Unable to update service image.'
            const status = error instanceof SetupValidationError ? 400 : 502
            logger.error(`[${serviceName}] ⚠️ Failed to update service image for ${name}: ${error.message}`)
            res.status(status).json({error: message})
        }
    })

    app.post('/api/settings/ecosystem/start', async (req, res) => {
        try {
            const result = await setupClient.startEcosystem(req.body ?? {})
            res.json(result ?? {})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to start ecosystem: ${error.message}`)
            res.status(502).json({error: 'Unable to start ecosystem.'})
        }
    })

    app.post('/api/settings/ecosystem/stop', async (req, res) => {
        try {
            const result = await setupClient.stopEcosystem(req.body ?? {})
            res.json(result ?? {})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to stop ecosystem: ${error.message}`)
            res.status(502).json({error: 'Unable to stop ecosystem.'})
        }
    })

    app.post('/api/settings/ecosystem/restart', async (req, res) => {
        try {
            const result = await setupClient.restartEcosystem(req.body ?? {})
            res.json(result ?? {})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to restart ecosystem: ${error.message}`)
            res.status(502).json({error: 'Unable to restart ecosystem.'})
        }
    })

    app.post('/api/settings/factory-reset', async (req, res) => {
        const session = await requireAdminSession(req, res)
        if (!session) return

        if (!vaultClient?.mongo?.wipe || !vaultClient?.redis?.wipe) {
            res.status(503).json({error: 'Vault wipe operations are not configured.'})
            return
        }

        const password = typeof req.body?.password === 'string' ? req.body.password : ''
        if (!password) {
            res.status(400).json({error: 'password is required.'})
            return
        }

        const deleteRavenDownloads = parseBooleanInput(req.body?.deleteRavenDownloads) === true
        const deleteDockers = parseBooleanInput(req.body?.deleteDockers) === true

        try {
            const passwordValid = await verifySessionPassword({session, password})
            if (!passwordValid) {
                res.status(401).json({error: 'Invalid password.'})
                return
            }

            await vaultClient.mongo.wipe()
            await vaultClient.redis.wipe()

            let factoryResetResult = null
            if (typeof setupClient?.factoryResetEcosystem === 'function') {
                factoryResetResult = await setupClient.factoryResetEcosystem({
                    deleteRavenDownloads,
                    deleteDockers,
                    setupCompleted: false,
                    forceFull: false,
                })
            } else if (typeof setupClient?.restartEcosystem === 'function') {
                factoryResetResult = await setupClient.restartEcosystem({
                    trackedOnly: false,
                    setupCompleted: false,
                    forceFull: false,
                })
            } else {
                throw new Error('Warden factory reset endpoint is unavailable.')
            }

            res.status(202).json({
                ok: true,
                restartQueued: true,
                deleteRavenDownloads,
                deleteDockers,
                redirectTo: resolveBaseRedirectUrl(),
                result: factoryResetResult ?? null,
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to run factory reset: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to run factory reset.')
            res.status(status).json({error: message})
        }
    })

    app.get('/api/settings/vault/collections', async (_req, res) => {
        if (!vaultClient?.mongo?.listCollections) {
            res.status(503).json({error: 'Vault collection viewer is not configured.'})
            return
        }

        try {
            const collections = await vaultClient.mongo.listCollections()
            res.json({collections: Array.isArray(collections) ? collections : []})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load Vault collections: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to load Vault collections.')
            res.status(status).json({error: message})
        }
    })

    app.get('/api/settings/vault/collections/:name/documents', async (req, res) => {
        if (!vaultClient?.mongo?.findMany) {
            res.status(503).json({error: 'Vault collection viewer is not configured.'})
            return
        }

        const name = typeof req.params?.name === 'string' ? req.params.name.trim() : ''
        if (!name) {
            res.status(400).json({error: 'Collection name is required.'})
            return
        }

        const rawLimit = Number(req.query?.limit)
        const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, Math.floor(rawLimit))) : 50

        try {
            const documents = await vaultClient.mongo.findMany(name, {})
            const list = Array.isArray(documents) ? documents.slice(0, limit) : []
            res.json({collection: name, limit, documents: list})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load Vault documents for ${name}: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, 'Unable to load Vault collection documents.')
            res.status(status).json({error: message})
        }
    })

    app.post('/api/settings/vault/wipe', async (req, res) => {
        const session = await requireAdminSession(req, res)
        if (!session) return

        if (!vaultClient?.mongo?.wipe || !vaultClient?.redis?.wipe) {
            res.status(503).json({error: 'Vault wipe operations are not configured.'})
            return
        }

        const target = normalizeString(req.body?.target).toLowerCase()
        if (target !== 'mongo' && target !== 'redis') {
            res.status(400).json({error: 'target must be either "mongo" or "redis".'})
            return
        }

        const restartRaw = parseBooleanInput(req.body?.restart)
        const shouldRestart = restartRaw == null ? true : restartRaw

        const password = typeof req.body?.password === 'string' ? req.body.password : ''
        if (!password) {
            res.status(400).json({error: 'password is required.'})
            return
        }

        try {
            const passwordValid = await verifySessionPassword({session, password})
            if (!passwordValid) {
                res.status(401).json({error: 'Invalid password.'})
                return
            }

            if (target === 'mongo') {
                await vaultClient.mongo.wipe()
            } else {
                await vaultClient.redis.wipe()
            }

            if (shouldRestart) {
                queueEcosystemRestart({trackedOnly: false, forceFull: true})
            }

            res.status(202).json({
                ok: true,
                target,
                restartQueued: shouldRestart,
                redirectTo: resolveBaseRedirectUrl(),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to wipe ${target}: ${error.message}`)
            const status = vaultErrorStatus(error, 502)
            const message = vaultErrorMessage(error, `Unable to wipe ${target}.`)
            res.status(status).json({error: message})
        }
    })
    app.get('/api/pages', (req, res) => {
        const pages = [
            { name: 'Setup', path: '/setup' },
            { name: 'Dashboard', path: '/dashboard' },
        ]

        logger.debug(`[${serviceName}] Serving ${pages.length} static page entries`)
        res.json(pages)
    })

    app.get('/api/setup/services', async (req, res) => {
        try {
            const services = await setupClient.listServices()
            res.json({ services })
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load installable services: ${error.message}`)
            res.status(502).json({ error: 'Unable to retrieve installable services.' })
        }
    })

    app.post('/api/setup/install', async (req, res) => {
        try {
            const { status, results } = await setupClient.installServices(req.body?.services)
            res.status(status ?? 200).json({ results })
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({ error: error.message })
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to install services: ${error.message}`)
            res.status(502).json({ error: 'Failed to install services.' })
        }
    })

    app.post('/api/setup/services/validate', async (req, res) => {
        try {
            const services = normalizeServiceInstallPayload(req.body?.services ?? req.body)
            const payload = { services }

            if (req.headers?.accept?.includes('application/x-ndjson')) {
                res.setHeader('Content-Type', 'application/x-ndjson')
                res.write(`${JSON.stringify({ type: 'validation', data: payload })}\n`)
                res.end()
                return
            }

            res.json(payload)
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({ error: error.message })
                return
            }

            logger.error(`[${serviceName}] ⚠️ Validation failed: ${error.message}`)
            res.status(502).json({ error: 'Unable to validate selection.' })
        }
    })

    app.post('/api/setup/services/preview', async (req, res) => {
        try {
            const services = normalizeServiceInstallPayload(req.body?.services ?? req.body)
            const catalog = await setupClient.listServices({ includeInstalled: true })
            const knownNames = new Set(catalog.map((entry) => entry?.name).filter(Boolean))

            const normalized = services.map((entry) => ({
                name: entry.name,
                env: entry.env ?? {},
                known: knownNames.has(entry.name),
            }))

            const payload = {
                services: normalized,
                summary: {
                    total: normalized.length,
                    known: normalized.filter((entry) => entry.known).length,
                    unknown: normalized.filter((entry) => !entry.known).length,
                },
            }

            if (req.headers?.accept?.includes('application/x-ndjson')) {
                res.setHeader('Content-Type', 'application/x-ndjson')
                res.write(`${JSON.stringify({ type: 'preview', data: payload })}\n`)
                res.end()
                return
            }

            res.json(payload)
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({ error: error.message })
                return
            }

            logger.error(`[${serviceName}] ⚠️ Preview failed: ${error.message}`)
            res.status(502).json({ error: 'Unable to preview selection.' })
        }
    })

    app.get('/api/setup/services/install/progress', async (req, res) => {
        try {
            const progress = await setupClient.getInstallProgress()
            res.json(progress ?? { items: [], status: 'idle', percent: null })
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load install progress: ${error.message}`)
            res.status(502).json({ error: 'Unable to retrieve installation progress.' })
        }
    })

    app.get('/api/setup/services/installation/logs', async (req, res) => {
        try {
            const history = await setupClient.getInstallationLogs({ limit: req.query?.limit })
            res.json(history)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load installation logs: ${error.message}`)
            res.status(502).json({ error: 'Unable to retrieve installation logs.' })
        }
    })

    app.get('/api/setup/services/:name/health', async (req, res) => {
        const name = req.params?.name

        try {
            const payload = await setupClient.getServiceHealth(name)
            res.json(payload)
        } catch (error) {
            const message = error instanceof SetupValidationError ? error.message : 'Unable to retrieve service health.'
            const status = error instanceof SetupValidationError ? 400 : 502
            logger.error(`[${serviceName}] ⚠️ Failed to load health for ${name}: ${error.message}`)
            res.status(status).json({ error: message })
        }
    })

    app.get('/api/setup/services/:name/logs', async (req, res) => {
        const name = req.params?.name

        try {
            const history = await setupClient.getServiceLogs(name, { limit: req.query?.limit })
            res.json(history)
        } catch (error) {
            const message = error instanceof SetupValidationError ? error.message : 'Unable to retrieve service logs.'
            const status = error instanceof SetupValidationError ? 400 : 502
            logger.error(`[${serviceName}] ⚠️ Failed to load logs for ${name}: ${error.message}`)
            res.status(status).json({ error: message })
        }
    })

    app.get('/api/setup/wizard/metadata', (_req, res) => {
        res.json(wizardMetadata)
    })

    app.get('/api/wizard/steps', (_req, res) => {
        res.json({
            steps: wizardMetadata.steps,
            featureFlags: wizardMetadata.featureFlags,
            defaults: createDefaultWizardState(),
        })
    })

    app.get('/api/setup/wizard/state', async (_req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({ error: 'Wizard state storage is not configured.' })
            return
        }

        try {
            const state = await wizardStateClient.loadState({ fallbackToDefault: true })
            res.json(state)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load wizard state: ${error.message}`)
            res.status(502).json({ error: 'Unable to load setup wizard state.' })
        }
    })

    app.get('/api/wizard/progress', async (_req, res) => {
        const progressFallback = { items: [], status: 'idle', percent: null }

        try {
            const [wizard, progress] = await Promise.all([
                wizardStateClient
                    ? wizardStateClient.loadState({ fallbackToDefault: true })
                    : Promise.resolve(createDefaultWizardState()),
                setupClient.getInstallProgress().catch(() => progressFallback),
            ])

            res.json({ wizard, progress: progress ?? progressFallback })
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load wizard progress: ${error.message}`)
            res.status(502).json({ error: 'Unable to load wizard progress.' })
        }
    })

    app.get('/api/setup/wizard/steps/:step/history', async (req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({ error: 'Wizard state storage is not configured.' })
            return
        }

        const step = resolveWizardStepKey(req.params?.step)
        if (!step) {
            res.status(400).json({ error: 'Invalid wizard step.' })
            return
        }

        try {
            const state = await wizardStateClient.loadState({ fallbackToDefault: true })
            const timeline = Array.isArray(state?.[step]?.timeline) ? state[step].timeline : []
            const limit = normalizeHistoryLimit(req.query?.limit)
            const events = limit ? timeline.slice(-limit) : [...timeline]
            res.json({ step, events })
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load ${step} history: ${error.message}`)
            res.status(502).json({ error: 'Unable to load wizard activity history.' })
        }
    })

    app.put('/api/setup/wizard/state', async (req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({ error: 'Wizard state storage is not configured.' })
            return
        }

        try {
            const operation = resolveWizardStateOperation(req.body ?? {})

            if (operation.type === 'replace') {
                const state = await wizardStateClient.writeState(operation.state)
                res.json(state)
                return
            }

            const { state } = await wizardStateClient.applyUpdates(operation.updates)
            res.json(state)
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({ error: error.message })
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to update wizard state: ${error.message}`)
            res.status(502).json({ error: 'Unable to update setup wizard state.' })
        }
    })

    app.post('/api/setup/wizard/steps/:step/reset', async (req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({ error: 'Wizard state storage is not configured.' })
            return
        }

        const step = resolveWizardStepKey(req.params?.step)
        if (!step) {
            res.status(400).json({ error: 'Invalid wizard step.' })
            return
        }

        const body = req.body ?? {}
        const limit = normalizeHistoryLimit(body.limit)
        const timestamp = new Date().toISOString()

        try {
            const { state } = await wizardStateClient.applyUpdates([
                {
                    step,
                    status: 'pending',
                    detail: null,
                    error: null,
                    completedAt: null,
                    updatedAt: timestamp,
                    timeline: [],
                    retries: 0,
                    actor: null,
                },
            ])

            let wizard = state
            if (typeof wizardStateClient.appendHistory === 'function') {
                const actor = body.actor && typeof body.actor === 'object' ? body.actor : null
                const eventDetail =
                    typeof body.detail === 'string' && body.detail.trim()
                        ? body.detail.trim()
                        : 'Cleared progress for this step.'
                const eventMessage =
                    typeof body.message === 'string' && body.message.trim()
                        ? body.message.trim()
                        : 'Step reset'
                const context = body.context && typeof body.context === 'object' ? body.context : null

                const { state: updated } = await wizardStateClient.appendHistory({
                    step,
                    entries: [
                        {
                            timestamp,
                            status: 'info',
                            code: 'step-reset',
                            message: eventMessage,
                            detail: eventDetail,
                            actor,
                            context,
                        },
                    ],
                    limit: limit ?? undefined,
                })

                wizard = updated
            }

            res.json({ wizard, step })
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({ error: error.message })
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to reset ${step}: ${error.message}`)
            res.status(502).json({ error: 'Unable to reset wizard step.' })
        }
    })

    app.post('/api/setup/wizard/steps/:step/broadcast', async (req, res) => {
        if (!wizardStateClient || typeof wizardStateClient.appendHistory !== 'function') {
            res.status(503).json({ error: 'Wizard history storage is not configured.' })
            return
        }

        const step = resolveWizardStepKey(req.params?.step)
        if (!step) {
            res.status(400).json({ error: 'Invalid wizard step.' })
            return
        }

        const body = req.body ?? {}
        const message = typeof body.message === 'string' ? body.message.trim() : ''
        if (!message) {
            res.status(400).json({ error: 'Broadcast message is required.' })
            return
        }

        const limit = normalizeHistoryLimit(body.limit)
        const eventDetail = typeof body.detail === 'string' && body.detail.trim() ? body.detail.trim() : null
        const eventStatus =
            typeof body.eventStatus === 'string' && body.eventStatus.trim() ? body.eventStatus.trim() : null
        const actor = body.actor && typeof body.actor === 'object' ? body.actor : null
        const context = body.context && typeof body.context === 'object' ? body.context : null

        try {
            const historyResult = await wizardStateClient.appendHistory({
                step,
                entries: [
                    {
                        message,
                        detail: eventDetail,
                        status: eventStatus,
                        code:
                            typeof body.code === 'string' && body.code.trim()
                                ? body.code.trim()
                                : null,
                        actor,
                        context,
                    },
                ],
                limit: limit ?? undefined,
            })

            let wizard = historyResult.state
            const patch = { step }
            let shouldUpdate = false

            if (typeof body.status === 'string' && body.status.trim()) {
                patch.status = body.status.trim()
                shouldUpdate = true
            }

            if (Object.prototype.hasOwnProperty.call(body, 'detail')) {
                patch.detail = eventDetail
                shouldUpdate = true
            } else {
                patch.detail = message
                shouldUpdate = true
            }

            if (Object.prototype.hasOwnProperty.call(body, 'error')) {
                patch.error = typeof body.error === 'string' ? body.error : null
                shouldUpdate = true
            }

            if (Object.prototype.hasOwnProperty.call(body, 'retries')) {
                patch.retries = body.retries
                shouldUpdate = true
            }

            if (actor) {
                patch.actor = actor
                shouldUpdate = true
            }

            if (Object.prototype.hasOwnProperty.call(body, 'completedAt')) {
                patch.completedAt = body.completedAt
                shouldUpdate = true
            }

            if (Object.prototype.hasOwnProperty.call(body, 'updatedAt')) {
                patch.updatedAt = body.updatedAt
                shouldUpdate = true
            }

            if (shouldUpdate) {
                const { state } = await wizardStateClient.applyUpdates([patch])
                wizard = state
            }

            const events = Array.isArray(wizard?.[step]?.timeline) ? wizard[step].timeline : []
            const event = events[events.length - 1] || null

            res.json({ wizard, event, step })
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({ error: error.message })
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to broadcast ${step} summary: ${error.message}`)
            res.status(502).json({ error: 'Unable to broadcast wizard summary.' })
        }
    })

    app.get('/api/setup/verification/status', async (_req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({ error: 'Wizard state storage is not configured.' })
            return
        }

        try {
            const [wizard, health] = await Promise.all([
                wizardStateClient.loadState({ fallbackToDefault: true }),
                collectVerificationHealth(),
            ])

            res.json({ wizard, summary: readVerificationSummary(wizard), health })
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load verification status: ${error.message}`)
            res.status(502).json({ error: 'Unable to load verification status.' })
        }
    })

    app.post('/api/setup/verification/checks', async (_req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({ error: 'Wizard state storage is not configured.' })
            return
        }

        const timestamp = new Date().toISOString()

        try {
            await wizardStateClient
                .applyUpdates([
                    {
                        step: 'verification',
                        status: 'in-progress',
                        detail: 'Running verification checks…',
                        error: null,
                        updatedAt: timestamp,
                        completedAt: null,
                    },
                ])
                .catch(() => null)

            const checks = []

            for (const config of VERIFICATION_SERVICES) {
                try {
                    const response = await setupClient.testService(config.name)
                    checks.push(
                        buildVerificationCheckResult(
                            config,
                            response?.result ?? response,
                            new Date().toISOString(),
                        ),
                    )
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    checks.push(
                        buildVerificationCheckResult(
                            config,
                            { success: false, supported: true, error: message },
                            new Date().toISOString(),
                        ),
                    )
                }
            }

            const completedAt = new Date().toISOString()
            const summary = {
                lastRunAt: completedAt,
                checks,
            }

            const hasFailures = summary.checks.some((check) => check.supported !== false && !check.success)
            const stepUpdate = {
                step: 'verification',
                status: hasFailures ? 'error' : 'complete',
                detail: JSON.stringify(summary),
                error: hasFailures ? 'Verification checks reported failures.' : null,
                updatedAt: completedAt,
                completedAt: hasFailures ? null : completedAt,
            }

            const { state } = await wizardStateClient.applyUpdates([stepUpdate])
            const health = await collectVerificationHealth()

            res.json({ wizard: state, summary, health })
        } catch (error) {
            logger.error(`[${serviceName}] ❌ Failed to execute verification checks: ${error.message}`)
            res.status(502).json({ error: 'Unable to run verification checks.' })
        }
    })

    app.post('/api/setup/wizard/complete', async (_req, res) => {
        if (!wizardStateClient) {
            res.status(503).json({ error: 'Wizard state storage is not configured.' })
            return
        }

        try {
            const current = await wizardStateClient.loadState({ fallbackToDefault: true })
            const summary = readVerificationSummary(current)

            const allChecksPassed =
                summary.checks.length > 0 &&
                summary.checks.every((check) => check.success || check.supported === false)

            if (!allChecksPassed || current?.verification?.status !== 'complete') {
                res.status(400).json({ error: 'Verification checks must succeed before completing setup.' })
                return
            }

            if (current.completed) {
                const health = await collectVerificationHealth()
                res.json({ wizard: current, summary, health })
                return
            }

            const now = new Date().toISOString()
            const nextState = {
                ...current,
                completed: true,
                updatedAt: now,
                verification: {
                    ...current.verification,
                    completedAt:
                        current?.verification?.completedAt && current.verification.completedAt.trim()
                            ? current.verification.completedAt
                            : now,
                    updatedAt: current?.verification?.updatedAt || now,
                },
            }

            const persisted = await wizardStateClient.writeState(nextState)
            const health = await collectVerificationHealth()

            res.json({ wizard: persisted, summary, health })
        } catch (error) {
            logger.error(`[${serviceName}] ❌ Failed to complete setup: ${error.message}`)
            res.status(502).json({ error: 'Unable to complete setup.' })
        }
    })

    app.post('/api/setup/services/:name/test', async (req, res) => {
        const name = req.params?.name

        try {
            const { status, result } = await setupClient.testService(name, req.body ?? {})
            res.status(status ?? 200).json(result ?? {})
        } catch (error) {
            const message = error instanceof SetupValidationError ? error.message : 'Failed to execute service test.'
            const status = error instanceof SetupValidationError ? 400 : 502
            logger.error(`[${serviceName}] ❌ Failed to test service ${name}: ${error.message}`)
            res.status(status).json({ error: message })
        }
    })

    app.post('/api/setup/services/noona-portal/discord/validate', async (req, res) => {
        try {
            const { token, guildId } = req.body ?? {}
            const payload = await discordSetupClient.fetchResources({ token, guildId })
            res.json(payload)
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({ error: error.message })
                return
            }

            logger.error(`[${serviceName}] ❌ Discord validation failed: ${error.message}`)
            res.status(502).json({ error: 'Unable to verify Discord configuration.' })
        }
    })

    app.post('/api/setup/services/noona-portal/discord/roles', async (req, res) => {
        try {
            const { token, guildId, name } = req.body ?? {}
            const role = await discordSetupClient.createRole({ token, guildId, name })
            res.status(201).json({ role })
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({ error: error.message })
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to create Discord role: ${error.message}`)
            res.status(502).json({ error: 'Unable to create Discord role.' })
        }
    })

    app.post('/api/setup/services/noona-portal/discord/channels', async (req, res) => {
        try {
            const { token, guildId, name, type } = req.body ?? {}
            const channel = await discordSetupClient.createChannel({ token, guildId, name, type })
            res.status(201).json({ channel })
        } catch (error) {
            if (error instanceof SetupValidationError) {
                res.status(400).json({ error: error.message })
                return
            }

            logger.error(`[${serviceName}] ❌ Failed to create Discord channel: ${error.message}`)
            res.status(502).json({ error: 'Unable to create Discord channel.' })
        }
    })

    app.use('/api/raven', requireSessionIfSetupCompleted)

    app.get('/api/raven/library', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'moon_login', 'Moon login permission is required.')) {
            return
        }
        try {
            const library = await ravenClient.getLibrary()
            res.json(library ?? [])
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load Raven library: ${error.message}`)
            res.status(502).json({ error: 'Unable to retrieve Raven library.' })
        }
    })

    app.post('/api/raven/library/checkForNew', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'check_download_missing_titles', 'Missing-title check permission is required.')) {
            return
        }
        try {
            const result = await ravenClient.checkLibraryForNewChapters()
            res.status(202).json(result ?? {})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to check Raven library for updates: ${error.message}`)
            res.status(502).json({error: 'Unable to check Raven library for updates.'})
        }
    })

    app.get('/api/raven/title/:uuid', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'moon_login', 'Moon login permission is required.')) {
            return
        }
        const uuid = typeof req.params?.uuid === 'string' ? req.params.uuid.trim() : ''

        if (!uuid) {
            res.status(400).json({error: 'uuid is required.'})
            return
        }

        try {
            const title = await ravenClient.getTitle(uuid)
            if (!title) {
                res.status(404).json({error: 'Title not found.'})
                return
            }

            res.json(title)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load Raven title ${uuid}: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve Raven title.'})
        }
    })

    app.post('/api/raven/title/:uuid/checkForNew', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'check_download_missing_titles', 'Missing-title check permission is required.')) {
            return
        }
        const uuid = typeof req.params?.uuid === 'string' ? req.params.uuid.trim() : ''

        if (!uuid) {
            res.status(400).json({error: 'uuid is required.'})
            return
        }

        try {
            const result = await ravenClient.checkTitleForNewChapters(uuid)
            if (!result) {
                res.status(404).json({error: 'Title not found.'})
                return
            }

            res.status(202).json(result)
        } catch (error) {
            logger.error(`[${serviceName}] Failed to check Raven title ${uuid}: ${error.message}`)
            res.status(502).json({error: 'Unable to check Raven title for updates.'})
        }
    })

    app.post('/api/raven/title', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'download_new_title', 'Download permission is required.')) {
            return
        }
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
        const sourceUrl = typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl.trim() : ''

        if (!title) {
            res.status(400).json({error: 'title is required.'})
            return
        }

        try {
            const created = await ravenClient.createTitle({title, sourceUrl: sourceUrl || null})
            res.status(200).json(created)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to create Raven title ${title}: ${error.message}`)
            res.status(502).json({error: 'Unable to create Raven title.'})
        }
    })

    app.patch('/api/raven/title/:uuid', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'download_new_title', 'Download permission is required.')) {
            return
        }
        const uuid = typeof req.params?.uuid === 'string' ? req.params.uuid.trim() : ''
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
        const sourceUrl = typeof req.body?.sourceUrl === 'string' ? req.body.sourceUrl.trim() : ''

        if (!uuid) {
            res.status(400).json({error: 'uuid is required.'})
            return
        }

        if (!title && !sourceUrl) {
            res.status(400).json({error: 'At least one of title/sourceUrl must be provided.'})
            return
        }

        try {
            const updated = await ravenClient.updateTitle(uuid, {title: title || null, sourceUrl: sourceUrl || null})
            if (!updated) {
                res.status(404).json({error: 'Title not found.'})
                return
            }

            res.json(updated)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to update Raven title ${uuid}: ${error.message}`)
            res.status(502).json({error: 'Unable to update Raven title.'})
        }
    })

    app.delete('/api/raven/title/:uuid', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'download_new_title', 'Download permission is required.')) {
            return
        }
        const uuid = typeof req.params?.uuid === 'string' ? req.params.uuid.trim() : ''

        if (!uuid) {
            res.status(400).json({error: 'uuid is required.'})
            return
        }

        try {
            const result = await ravenClient.deleteTitle(uuid)
            if (!result) {
                res.status(404).json({error: 'Title not found.'})
                return
            }

            res.json(result)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to delete Raven title ${uuid}: ${error.message}`)
            res.status(502).json({error: 'Unable to delete Raven title.'})
        }
    })

    app.get('/api/raven/title/:uuid/files', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'moon_login', 'Moon login permission is required.')) {
            return
        }
        const uuid = typeof req.params?.uuid === 'string' ? req.params.uuid.trim() : ''
        const limit = req.query?.limit

        if (!uuid) {
            res.status(400).json({error: 'uuid is required.'})
            return
        }

        try {
            const files = await ravenClient.listTitleFiles(uuid, {limit})
            if (!files) {
                res.status(404).json({error: 'Title not found.'})
                return
            }

            res.json(files)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load Raven files for ${uuid}: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve Raven title files.'})
        }
    })

    app.delete('/api/raven/title/:uuid/files', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'download_new_title', 'Download permission is required.')) {
            return
        }
        const uuid = typeof req.params?.uuid === 'string' ? req.params.uuid.trim() : ''
        const names = Array.isArray(req.body?.names) ? req.body.names : []

        if (!uuid) {
            res.status(400).json({error: 'uuid is required.'})
            return
        }

        const normalizedNames = names
            .filter((entry) => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean)

        if (normalizedNames.length === 0) {
            res.status(400).json({error: 'names must include at least one file name.'})
            return
        }

        try {
            const result = await ravenClient.deleteTitleFiles(uuid, normalizedNames)
            if (!result) {
                res.status(404).json({error: 'Title not found.'})
                return
            }

            res.json(result)
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to delete Raven files for ${uuid}: ${error.message}`)
            res.status(502).json({error: 'Unable to delete Raven title files.'})
        }
    })

    app.post('/api/raven/search', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'lookup_new_title', 'Lookup permission is required.')) {
            return
        }
        const query = typeof req.body?.query === 'string' ? req.body.query.trim() : ''

        if (!query) {
            res.status(400).json({ error: 'Search query is required.' })
            return
        }

        try {
            const results = await ravenClient.searchTitle(query)
            res.json(results ?? [])
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to search Raven for "${query}": ${error.message}`)
            res.status(502).json({ error: 'Unable to search Raven library.' })
        }
    })

    app.post('/api/raven/download', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'download_new_title', 'Download permission is required.')) {
            return
        }
        const searchId = typeof req.body?.searchId === 'string' ? req.body.searchId.trim() : ''
        const optionIndexRaw = req.body?.optionIndex
        const optionIndex =
            typeof optionIndexRaw === 'number'
                ? optionIndexRaw
                : typeof optionIndexRaw === 'string' && optionIndexRaw.trim()
                  ? Number(optionIndexRaw)
                  : NaN

        if (!searchId) {
            res.status(400).json({ error: 'searchId is required.' })
            return
        }

        if (!Number.isFinite(optionIndex)) {
            res.status(400).json({ error: 'optionIndex must be provided as a number.' })
            return
        }

        try {
            const result = await ravenClient.queueDownload({ searchId, optionIndex })
            res.status(202).json({ result })
        } catch (error) {
            logger.error(
                `[${serviceName}] ❌ Failed to queue Raven download for ${searchId}: ${error.message}`,
            )
            res.status(502).json({ error: 'Unable to queue Raven download.' })
        }
    })

    app.get('/api/raven/downloads/status', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'moon_login', 'Moon login permission is required.')) {
            return
        }
        try {
            const status = await ravenClient.getDownloadStatus()
            res.json(status ?? [])
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load Raven download status: ${error.message}`)
            res.status(502).json({ error: 'Unable to retrieve Raven download status.' })
        }
    })

    app.get('/api/raven/downloads/history', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'moon_login', 'Moon login permission is required.')) {
            return
        }
        try {
            const history = await ravenClient.getDownloadHistory()
            res.json(history ?? [])
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load Raven download history: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve Raven download history.'})
        }
    })

    app.get('/api/raven/downloads/summary', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'moon_login', 'Moon login permission is required.')) {
            return
        }
        try {
            const summary = await ravenClient.getDownloadSummary()
            res.json(summary ?? {})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load Raven download summary: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve Raven download summary.'})
        }
    })

    app.post('/api/setup/services/noona-raven/detect', async (_req, res) => {
        try {
            const { status, detection, error } = await setupClient.detectRavenMount()
            if (status && status >= 400) {
                res.status(status).json({ error: error ?? 'Unable to detect Kavita data mount.' })
                return
            }

            res.json({ detection })
        } catch (error) {
            logger.error(`[${serviceName}] ❌ Failed to detect Kavita mount: ${error.message}`)
            res.status(502).json({ error: 'Unable to detect Kavita data mount.' })
        }
    })

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

    return { app, server }
}

export { SetupValidationError } from './errors.mjs'

