// services/sage/initSage.mjs

import express from 'express'
import cors from 'cors'

import {getPages} from '../../utilities/dynamic/pages/getPages.mjs'
import {debugMSG, errMSG, log} from '../../utilities/etc/logger.mjs'

const PORT = process.env.API_PORT || 3004
const SERVICE_NAME = process.env.SERVICE_NAME || 'noona-sage'

const app = express()

// Enable CORS so Moon can safely call this backend within the Docker network
app.use(cors())

// Enable JSON body parsing (useful for future POST/PUT routes)
app.use(express.json())

/**
 * GET /health
 * Used by Warden to confirm Sage is running.
 */
app.get('/health', (req, res) => {
    debugMSG(`[${SERVICE_NAME}] ✅ Healthcheck OK`)
    res.status(200).send('ok')
})

/**
 * GET /api/pages
 * Returns all dynamic page slugs stored in Redis.
 * Each entry is transformed into { name, path } for Moon to render as Vuetify cards.
 */
app.get('/api/pages', async (req, res) => {
    try {
        const rawPages = await getPages()

        const pages = rawPages.map(p => ({
            name: p.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            path: `/dynamic/${p.slug}`,
        }))

        debugMSG(`[${SERVICE_NAME}] 📦 Found ${pages.length} pages`)
        res.json(pages)
    } catch (err) {
        errMSG(`[${SERVICE_NAME}] ❌ Failed to fetch pages: ${err.message}`)
        res.status(500).json({error: 'Failed to load dynamic pages'})
    }
})

// Start the Express server
app.listen(PORT, () => {
    log(`[${SERVICE_NAME}] 🧠 Sage is live on port ${PORT}`)
})
