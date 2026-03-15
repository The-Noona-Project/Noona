// services/sage/app/createSetupClient.mjs

import {SetupValidationError} from '../lib/errors.mjs'

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

const normalizeToken = (candidate) => {
    if (!candidate || typeof candidate !== 'string') {
        return null
    }

    const trimmed = candidate.trim()
    return trimmed || null
}

const normalizeResponsePayload = async (response) => {
    const text = await response.text().catch(() => '')
    if (!text) {
        return {}
    }

    try {
        const parsed = JSON.parse(text)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : {value: parsed}
    } catch {
        return {error: text}
    }
}

const DEFAULT_COLD_START_RETRY_WINDOW_MS = 15000
const DEFAULT_COLD_START_RETRY_DELAY_MS = 750
const COLD_START_RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504])

const summarizeUpstreamMessage = (status, payload = {}) => {
    const errorMessage = typeof payload?.error === 'string' ? payload.error.trim() : ''
    if (errorMessage) {
        return errorMessage
    }

    const message = typeof payload?.message === 'string' ? payload.message.trim() : ''
    if (message) {
        return message
    }

    return `Warden responded with status ${status}`
}

export class WardenUpstreamHttpError extends Error {
    constructor({status, payload = {}, path = '', baseUrl = ''} = {}) {
        super(summarizeUpstreamMessage(status, payload))
        this.name = 'WardenUpstreamHttpError'
        this.status = status
        this.payload =
            payload && typeof payload === 'object' && !Array.isArray(payload)
                ? payload
                : {error: this.message}
        this.path = path
        this.baseUrl = baseUrl
    }
}

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))

const normalizeNonNegativeInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const isColdStartRetriableError = (error) => {
    if (error instanceof WardenUpstreamHttpError) {
        return COLD_START_RETRYABLE_STATUS_CODES.has(Number(error.status))
    }

    const message = error instanceof Error ? error.message : String(error)
    return /All Warden endpoints failed/i.test(message)
        || /fetch failed/i.test(message)
        || /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timed out|socket hang up/i.test(message)
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

export const defaultWardenBaseUrl = (env = process.env) => {
    const [first] = resolveDefaultWardenUrls(env)
    return first || 'http://localhost:4001'
}

const SERVICE_NAME_ALIASES = Object.freeze({
    kavita: 'noona-kavita',
})

const normalizeServiceName = (value) => {
    if (typeof value !== 'string') {
        return ''
    }

    const trimmed = value.trim()
    if (!trimmed) {
        return ''
    }

    return SERVICE_NAME_ALIASES[trimmed] || trimmed
}

export const normalizeServiceInstallPayload = (services) => {
    if (!Array.isArray(services) || services.length === 0) {
        throw new SetupValidationError('Body must include a non-empty "services" array.')
    }

    return services.map((entry) => {
        if (typeof entry === 'string' || typeof entry === 'number') {
            const trimmed = normalizeServiceName(String(entry))
            if (!trimmed) {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            return {name: trimmed}
        }

        if (!entry || typeof entry !== 'object') {
            throw new SetupValidationError('Service entries must be strings or objects with a "name" field.')
        }

        const name = normalizeServiceName(entry.name)
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

        return env ? {name, env} : {name}
    })
}

const createSetupClient = ({
                               baseUrl,
                               baseUrls = [],
                               token,
                               coldStartRetryDelayMs = DEFAULT_COLD_START_RETRY_DELAY_MS,
                               coldStartRetryWindowMs = DEFAULT_COLD_START_RETRY_WINDOW_MS,
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
    const authToken =
        normalizeToken(token)
        || normalizeToken(env?.WARDEN_API_TOKEN)
        || normalizeToken(env?.WARDEN_ACCESS_TOKEN)

    const fetchFromWardenOnce = async (path, options, requestOptions = {}) => {
        const errors = []
        const candidates = preferredBaseUrl
            ? [preferredBaseUrl, ...deduped.filter((url) => url !== preferredBaseUrl)]
            : deduped
        const preserveHttpError = requestOptions?.preserveHttpError === true

        for (const candidate of candidates) {
            try {
                const requestUrl = new URL(path, candidate)
                const response = await fetchImpl(requestUrl.toString(), {
                    ...(options ?? {}),
                    headers: {
                        ...(authToken ? {Authorization: `Bearer ${authToken}`} : {}),
                        ...((options && options.headers) ? options.headers : {}),
                    },
                })

                if (!response.ok) {
                    const payload = await normalizeResponsePayload(response)
                    if (preserveHttpError) {
                        throw new WardenUpstreamHttpError({
                            status: response.status,
                            payload,
                            path,
                            baseUrl: candidate,
                        })
                    }

                    throw new Error(summarizeUpstreamMessage(response.status, payload))
                }

                preferredBaseUrl = candidate
                return response
            } catch (error) {
                if (error instanceof WardenUpstreamHttpError) {
                    throw error
                }

                const message = error instanceof Error ? error.message : String(error)
                errors.push(`${candidate} (${message})`)
            }
        }

        throw new Error(`All Warden endpoints failed: ${errors.join(' | ')}`)
    }

    const probeWardenReadiness = async () => {
        const candidates = preferredBaseUrl
            ? [preferredBaseUrl, ...deduped.filter((url) => url !== preferredBaseUrl)]
            : deduped

        let sawReady = false
        for (const candidate of candidates) {
            try {
                const response = await fetchImpl(new URL('/health', candidate).toString())
                const payload = await normalizeResponsePayload(response)
                if (!response.ok) {
                    continue
                }

                if (payload?.ready === false) {
                    return false
                }

                if (payload?.ready === true || payload?.status === 'ok') {
                    sawReady = true
                }
            } catch {
                // Ignore readiness probe errors and let the bounded retry window decide.
            }
        }

        return sawReady ? true : null
    }

    const fetchFromWarden = async (path, options, requestOptions = {}) => {
        if (requestOptions?.coldStartRetry !== true) {
            return fetchFromWardenOnce(path, options, requestOptions)
        }

        const retryWindowMs = normalizeNonNegativeInteger(
            requestOptions?.coldStartRetryWindowMs,
            coldStartRetryWindowMs,
        )
        const retryDelayMs = normalizeNonNegativeInteger(
            requestOptions?.coldStartRetryDelayMs,
            coldStartRetryDelayMs,
        )
        const deadline = Date.now() + retryWindowMs
        let lastError = null

        while (true) {
            try {
                return await fetchFromWardenOnce(path, options, requestOptions)
            } catch (error) {
                lastError = error
                if (!isColdStartRetriableError(error) || Date.now() >= deadline) {
                    throw error
                }

                const ready = await probeWardenReadiness()
                if (ready === false) {
                    logger?.debug?.(
                        `[${serviceName}] Warden is still booting; retrying ${path} during setup cold start.`,
                    )
                }

                await wait(retryDelayMs)
            }
        }
    }

    return {
        async listServices(options = {}) {
            const includeInstalled = options.includeInstalled ?? true
            const response = await fetchFromWarden(
                `/api/services?includeInstalled=${includeInstalled ? 'true' : 'false'}`,
                undefined,
                {
                    preserveHttpError: true,
                    coldStartRetry: true,
                },
            )

            const payload = await response.json()
            const services = Array.isArray(payload.services) ? payload.services : []

            logger.debug?.(
                `[${serviceName}] 📦 Retrieved ${services.length} services from Warden via ${preferredBaseUrl}`,
            )
            return services
        },

        async installServices(services, options = {}) {
            const suffix = options?.async === true ? '?async=true' : ''
            const normalized = Array.isArray(services) && services.length > 0
                ? normalizeServiceInstallPayload(services)
                : null
            const response = await fetchFromWarden(`/api/services/install${suffix}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(normalized ? {services: normalized} : {}),
            })

            const payload = await response.json().catch(() => ({}))
            const results = Array.isArray(payload.results) ? payload.results : []
            const status = response.status || 200

            logger.info?.(
                `[${serviceName}] 🚀 Installation request forwarded for ${
                    normalized ? normalized.length : 'persisted setup'
                } services (status: ${status}) via ${preferredBaseUrl}`,
            )
            return {
                status,
                results,
                accepted: payload?.accepted === true,
                started: payload?.started === true,
                alreadyRunning: payload?.alreadyRunning === true,
                progress: payload?.progress ?? null,
            }
        },
        async getInstallProgress() {
            const response = await fetchFromWarden('/api/services/install/progress', undefined, {coldStartRetry: true})
            return await response.json().catch(() => ({items: [], status: 'idle', percent: null}))
        },
        async getStorageLayout() {
            const response = await fetchFromWarden('/api/storage/layout', undefined, {coldStartRetry: true})
            return await response.json().catch(() => ({root: null, services: []}))
        },
        async getSetupConfig() {
            const response = await fetchFromWarden('/api/setup/config', undefined, {
                preserveHttpError: true,
                coldStartRetry: true,
            })
            return await response.json().catch(() => ({
                exists: false,
                path: null,
                snapshot: null,
                error: null,
            }))
        },
        async saveSetupConfig(snapshot = {}) {
            if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
                throw new SetupValidationError('Setup config payload must be a JSON object.')
            }

            const response = await fetchFromWarden('/api/setup/config', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(snapshot),
            }, {preserveHttpError: true})

            return await response.json().catch(() => ({}))
        },
        async normalizeSetupConfig(snapshot = {}) {
            if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
                throw new SetupValidationError('Setup config payload must be a JSON object.')
            }

            const response = await fetchFromWarden('/api/setup/config/normalize', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(snapshot),
            }, {preserveHttpError: true})

            return await response.json().catch(() => ({snapshot: null}))
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
                    summary: {status: 'idle', percent: null, detail: null, updatedAt: null},
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
            return await response.json().catch(() => ({service: trimmed, entries: [], summary: {}}))
        },
        async testService(name, body = {}) {
            if (!name || typeof name !== 'string') {
                throw new SetupValidationError('Service name must be a non-empty string.')
            }

            const trimmed = name.trim()
            const response = await fetchFromWarden(`/api/services/${encodeURIComponent(trimmed)}/test`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body ?? {}),
            })

            const payload = await response.json().catch(() => ({}))
            return {status: response.status ?? 200, result: payload}
        },
        async detectRavenMount() {
            const response = await fetchFromWarden('/api/services/noona-raven/detect', {
                method: 'POST',
            })

            const payload = await response.json().catch(() => ({}))
            return {status: response.status ?? 200, detection: payload?.detection ?? null, error: payload?.error}
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

            const response = await fetchFromWarden(`/api/services/${encodeURIComponent(trimmed)}/config`, undefined, {
                preserveHttpError: true,
            })
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
            }, {preserveHttpError: true})

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
            }, {preserveHttpError: true})

            return await response.json().catch(() => ({}))
        },
        async listServiceUpdates() {
            const response = await fetchFromWarden('/api/services/updates', undefined, {
                preserveHttpError: true,
            })
            const payload = await response.json().catch(() => ({}))
            return Array.isArray(payload?.updates) ? payload.updates : []
        },
        async checkServiceUpdates(services = null) {
            const body = Array.isArray(services) ? {services} : {}
            const response = await fetchFromWarden('/api/services/updates/check', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(body),
            }, {preserveHttpError: true})

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
            }, {preserveHttpError: true})

            return await response.json().catch(() => ({}))
        },
        async startEcosystem(options = {}) {
            const response = await fetchFromWarden('/api/ecosystem/start', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(options ?? {}),
            }, {preserveHttpError: true})

            return await response.json().catch(() => ({}))
        },
        async stopEcosystem(options = {}) {
            const response = await fetchFromWarden('/api/ecosystem/stop', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(options ?? {}),
            }, {preserveHttpError: true})

            return await response.json().catch(() => ({}))
        },
        async restartEcosystem(options = {}) {
            const response = await fetchFromWarden('/api/ecosystem/restart', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(options ?? {}),
            }, {preserveHttpError: true})

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

export {createSetupClient}
export default createSetupClient
