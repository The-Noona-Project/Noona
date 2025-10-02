// services/sage/shared/sageApp.mjs

import express from 'express'
import cors from 'cors'

import { debugMSG, errMSG, log } from '../../../utilities/etc/logger.mjs'

const defaultServiceName = () => process.env.SERVICE_NAME || 'noona-sage'
const defaultPort = () => process.env.API_PORT || 3004

const resolveLogger = (overrides = {}) => ({
    debug: debugMSG,
    error: errMSG,
    info: log,
    ...overrides,
})

export const createSageApp = ({ serviceName = defaultServiceName(), logger: loggerOverrides } = {}) => {
    const logger = resolveLogger(loggerOverrides)
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

    return app
}

export const startSage = ({
    port = defaultPort(),
    serviceName = defaultServiceName(),
    logger: loggerOverrides,
} = {}) => {
    const logger = resolveLogger(loggerOverrides)
    const app = createSageApp({ serviceName, logger })
    const server = app.listen(port, () => {
        logger.info(`[${serviceName}] 🧠 Sage is live on port ${port}`)
    })

    return { app, server }
}
