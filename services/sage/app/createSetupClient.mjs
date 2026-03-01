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

        async installServices(services, options = {}) {
            const normalized = normalizeServiceInstallPayload(services)
            const suffix = options?.async === true ? '?async=true' : ''
            const response = await fetchFromWarden(`/api/services/install${suffix}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({services: normalized}),
            })

            const payload = await response.json().catch(() => ({}))
            const results = Array.isArray(payload.results) ? payload.results : []
            const status = response.status || 200

            logger.info?.(
                `[${serviceName}] 🚀 Installation request forwarded for ${normalized.length} services (status: ${status}) via ${preferredBaseUrl}`,
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
            const response = await fetchFromWarden('/api/services/install/progress')
            return await response.json().catch(() => ({items: [], status: 'idle', percent: null}))
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

export {createSetupClient}
export default createSetupClient
