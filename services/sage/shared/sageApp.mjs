// services/sage/shared/sageApp.mjs

import express from 'express'
import cors from 'cors'

import { debugMSG, errMSG, log } from '../../../utilities/etc/logger.mjs'
import { SetupValidationError } from './errors.mjs'
import { createDiscordSetupClient } from './discordSetupClient.mjs'

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
    }
}

export const createSageApp = ({
    serviceName = defaultServiceName(),
    logger: loggerOverrides,
    setupClient: setupClientOverride,
    discordSetupClient: discordSetupClientOverride,
    setup: setupOptions = {},
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
    const app = express()

    app.use(cors())
    app.use(express.json())

    app.get('/health', (req, res) => {
        logger.debug(`[${serviceName}] ✅ Healthcheck OK`)
        res.status(200).send('Sage is live!')
    })

    app.get('/api/pages', (req, res) => {
        const pages = [
            { name: 'Setup', path: '/setup' },
            { name: 'Dashboard', path: '/dashboard' },
        ]

        logger.debug(`[${serviceName}] 🗂️ Serving ${pages.length} static page entries`)
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

    app.get('/api/setup/services/install/progress', async (req, res) => {
        try {
            const progress = await setupClient.getInstallProgress()
            res.json(progress ?? { items: [], status: 'idle', percent: null })
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load install progress: ${error.message}`)
            res.status(502).json({ error: 'Unable to retrieve installation progress.' })
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
    setup,
} = {}) => {
    const logger = resolveLogger(loggerOverrides)
    const app = createSageApp({
        serviceName,
        logger,
        setupClient,
        discordSetupClient,
        setup,
    })
    const server = app.listen(port, () => {
        logger.info(`[${serviceName}] 🧠 Sage is live on port ${port}`)
    })

    return { app, server }
}
