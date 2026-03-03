// services/sage/routes/registerRavenRoutes.mjs

export function registerRavenRoutes(context = {}) {
    const {
        app,
        ensureMoonPermission,
        logger,
        ravenClient,
        requireSessionIfSetupCompleted,
        serviceName,
    } = context

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
            res.status(502).json({error: 'Unable to retrieve Raven library.'})
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
            res.status(400).json({error: 'Search query is required.'})
            return
        }

        try {
            const results = await ravenClient.searchTitle(query)
            res.json(results ?? [])
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to search Raven for "${query}": ${error.message}`)
            res.status(502).json({error: 'Unable to search Raven library.'})
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
            res.status(400).json({error: 'searchId is required.'})
            return
        }

        if (!Number.isFinite(optionIndex)) {
            res.status(400).json({error: 'optionIndex must be provided as a number.'})
            return
        }

        try {
            const result = await ravenClient.queueDownload({searchId, optionIndex})
            res.status(202).json({result})
        } catch (error) {
            logger.error(
                `[${serviceName}] ❌ Failed to queue Raven download for ${searchId}: ${error.message}`,
            )
            res.status(502).json({error: 'Unable to queue Raven download.'})
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
            res.status(502).json({error: 'Unable to retrieve Raven download status.'})
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
}

export default registerRavenRoutes
