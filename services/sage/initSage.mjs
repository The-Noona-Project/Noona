// services/sage/initSage.mjs

/**
 * @fileoverview
 * Sage is the backend service for Noona, providing API routes for Moon.
 * Dynamic page logic has been deprecated.
 */

import express from 'express'
import cors from 'cors'

import { debugMSG, errMSG, log } from '../../utilities/etc/logger.mjs'

const PORT = process.env.API_PORT || 3004
const SERVICE_NAME = process.env.SERVICE_NAME || 'noona-sage'

const app = express()

// Enable CORS so Moon can safely call this backend within the Docker network
app.use(cors())

// Enable JSON body parsing
app.use(express.json())

/**
 * GET /health
 * Used by Warden to confirm Sage is running.
 */
app.get('/health', (req, res) => {
    debugMSG(`[${SERVICE_NAME}] ✅ Healthcheck OK`)
    res.status(200).send('Sage is live!')
})

/**
 * GET /api/pages
 * (Static placeholder route)
 * Returns a predefined set of page slugs for Moon to render setup/dashboard content.
 */
app.get('/api/pages', (req, res) => {
    const pages = [
        { name: 'Setup', path: '/setup' },
        { name: 'Dashboard', path: '/dashboard' },
    ]

    debugMSG(`[${SERVICE_NAME}] 🗂️ Serving ${pages.length} static page entries`)
    res.json(pages)
})

// Start the Express server
app.listen(PORT, () => {
    log(`[${SERVICE_NAME}] 🧠 Sage is live on port ${PORT}`)
})
