// services/sage/shared/sageApp.mjs

import express from 'express'
import cors from 'cors'

import { debugMSG, errMSG, log } from '../../../utilities/etc/logger.mjs'

const defaultServiceName = () => process.env.SERVICE_NAME || 'noona-sage'
const defaultPort = () => process.env.API_PORT || 3004
const defaultWardenBaseUrl = () => process.env.WARDEN_BASE_URL || 'http://localhost:4001'

const resolveLogger = (overrides = {}) => ({
    debug: debugMSG,
    error: errMSG,
    info: log,
    ...overrides,
})

const createSetupClient = ({ baseUrl = defaultWardenBaseUrl(), fetchImpl = fetch, logger, serviceName }) => ({
    async listServices() {
        const response = await fetchImpl(`${baseUrl}/api/services`)

        if (!response.ok) {
            throw new Error(`Warden responded with status ${response.status}`)
        }

        const payload = await response.json()
        const services = Array.isArray(payload.services) ? payload.services : []

        logger.debug?.(`[${serviceName}] 📦 Retrieved ${services.length} services from Warden`)
        return services
    },

    async installServices(services) {
        const response = await fetchImpl(`${baseUrl}/api/services/install`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ services }),
        })

        const payload = await response.json().catch(() => ({}))
        const results = Array.isArray(payload.results) ? payload.results : []
        const status = response.status || 200

        logger.info?.(`[${serviceName}] 🚀 Installation request forwarded for ${services.length} services (status: ${status})`)
        return { status, results }
    },
})

export const createSageApp = ({
    serviceName = defaultServiceName(),
    logger: loggerOverrides,
    setupClient: setupClientOverride,
    setup: setupOptions = {},
} = {}) => {
    const logger = resolveLogger(loggerOverrides)
    const setupClient =
        setupClientOverride ||
        createSetupClient({
            baseUrl: setupOptions.baseUrl ?? defaultWardenBaseUrl(),
            fetchImpl: setupOptions.fetchImpl ?? setupOptions.fetch ?? fetch,
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
        const services = req.body?.services

        if (!Array.isArray(services) || services.length === 0) {
            res.status(400).json({ error: 'Body must include a non-empty "services" array.' })
            return
        }

        try {
            const { status, results } = await setupClient.installServices(services)
            res.status(status ?? 200).json({ results })
        } catch (error) {
            logger.error(`[${serviceName}] ❌ Failed to install services: ${error.message}`)
            res.status(502).json({ error: 'Failed to install services.' })
        }
    })

    return app
}

export const startSage = ({
    port = defaultPort(),
    serviceName = defaultServiceName(),
    logger: loggerOverrides,
    setupClient,
    setup,
} = {}) => {
    const logger = resolveLogger(loggerOverrides)
    const app = createSageApp({ serviceName, logger, setupClient, setup })
    const server = app.listen(port, () => {
        logger.info(`[${serviceName}] 🧠 Sage is live on port ${port}`)
    })

    return { app, server }
}
