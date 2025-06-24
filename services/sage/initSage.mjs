// services/sage/initSage.mjs

import express from 'express'
import cors from 'cors'

import {getPages} from '../../utilities/dynamic/pages/getPages.mjs'
import {debugMSG, errMSG, log} from '../../utilities/etc/logger.mjs'

const PORT = process.env.API_PORT || 3004
const SERVICE_NAME = process.env.SERVICE_NAME || 'noona-sage'

const app = express()

// Enable CORS so Moon can call this API inside Docker network
app.use(cors())

// Optional: allow JSON parsing if needed later
app.use(express.json())

/**
 * Healthcheck route for Warden to verify container health.
 */
app.get('/health', (req, res) => {
    debugMSG(`[${SERVICE_NAME}] ✅ Healthcheck OK`)
    res.status(200).send('ok')
})

/**
 * GET /api/pages
 * Returns all dynamic pages currently registered in Redis.
 * Transforms each page to { name, path } for Moon to display.
 */
app.get('/api/pages', async (req, res) => {
    try {
        const raw = await getPages()

        const pages = raw.map(p => ({
            name: p.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            path: `/dynamic/${p.slug}`
        }))

        debugMSG(`[${SERVICE_NAME}] 📦 Found ${pages.length} pages`)
        res.json(pages)
    } catch (err) {
        errMSG(`[${SERVICE_NAME}] ❌ Failed to fetch pages: ${err.message}`)
        res.status(500).json({error: 'Failed to load dynamic pages'})
    }
})

// Start listening
app.listen(PORT, () => {
    log(`[${SERVICE_NAME}] 🧠 Sage is live on port ${PORT}`)
})
