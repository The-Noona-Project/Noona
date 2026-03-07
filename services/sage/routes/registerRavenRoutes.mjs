// services/sage/routes/registerRavenRoutes.mjs

export function registerRavenRoutes(context = {}) {
    const {
        app,
        ensureMoonPermission,
        hasMoonPermission,
        logger,
        ravenClient,
        vaultClient,
        requireSessionIfSetupCompleted,
        serviceName,
    } = context

    const RECOMMENDATIONS_COLLECTION = 'portal_recommendations'
    const APPROVED_RECOMMENDATION_STATUSES = new Set(['approved', 'accepted'])
    const DENIED_RECOMMENDATION_STATUSES = new Set(['denied', 'rejected', 'declined'])
    const PENDING_RECOMMENDATION_STATUSES = new Set(['pending', 'new', 'requested'])
    const RECOMMENDATION_TIMELINE_EVENT_TYPES = new Set([
        'created',
        'approved',
        'denied',
        'comment',
        'download-started',
        'download-completed',
    ])
    const MAX_RECOMMENDATION_COMMENT_LENGTH = 2000

    const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '')
    const normalizeRecommendationIsoTimestamp = (value) => {
        const iso = normalizeString(value)
        if (!iso) {
            return null
        }

        const parsed = Date.parse(iso)
        if (!Number.isFinite(parsed)) {
            return null
        }

        return new Date(parsed).toISOString()
    }
    const resolveRecommendationTimestamp = (value) => {
        const iso = normalizeRecommendationIsoTimestamp(value)
        if (!iso) {
            return 0
        }

        const parsed = Date.parse(iso)
        return Number.isFinite(parsed) ? parsed : 0
    }
    const resolveRecommendationStatus = (value) => normalizeString(value).toLowerCase()
    const isApprovedRecommendationStatus = (value) => APPROVED_RECOMMENDATION_STATUSES.has(resolveRecommendationStatus(value))
    const isDeniedRecommendationStatus = (value) => DENIED_RECOMMENDATION_STATUSES.has(resolveRecommendationStatus(value))
    const isPendingRecommendationStatus = (value) => PENDING_RECOMMENDATION_STATUSES.has(resolveRecommendationStatus(value))
    const parseRecommendationLimit = (value) => {
        const rawLimit = Number(value)
        return Number.isFinite(rawLimit) ? Math.max(1, Math.min(500, Math.floor(rawLimit))) : 100
    }
    const resolveRecommendationId = (value) => {
        if (typeof value === 'string' && value.trim()) {
            return value.trim()
        }

        if (!value || typeof value !== 'object') {
            return null
        }

        if (typeof value.$oid === 'string' && value.$oid.trim()) {
            return value.$oid.trim()
        }

        if (typeof value.toHexString === 'function') {
            try {
                const hex = value.toHexString()
                if (typeof hex === 'string' && hex.trim()) {
                    return hex.trim()
                }
            } catch {
                // Best effort fallback below.
            }
        }

        if (typeof value.toString === 'function') {
            const text = value.toString()
            if (typeof text === 'string' && text.trim() && text !== '[object Object]') {
                return text.trim()
            }
        }

        return null
    }
    const normalizeRecommendationActor = (value = {}, fallbackRole = 'system') => {
        const roleRaw = normalizeString(value?.role).toLowerCase()
        const role =
            roleRaw === 'admin' || roleRaw === 'user' || roleRaw === 'system'
                ? roleRaw
                : fallbackRole

        return {
            role,
            username: normalizeString(value?.username) || null,
            discordId: normalizeString(value?.discordId) || null,
            tag: normalizeString(value?.tag) || null,
        }
    }
    const recommendationActorFromSession = (session, role = 'admin') =>
        normalizeRecommendationActor(
            {
                role,
                username: normalizeString(session?.username) || null,
                discordId: normalizeString(session?.discordUserId) || null,
                tag: null,
            },
            role,
        )
    const createRecommendationTimelineEventId = () => {
        const randomSuffix = Math.random().toString(36).slice(2, 10)
        return `${Date.now().toString(36)}-${randomSuffix || 'event'}`
    }
    const createRecommendationTimelineEvent = ({
                                                   type = 'comment',
                                                   actor = {},
                                                   body = null,
                                                   createdAt = null,
                                               } = {}) => {
        const normalizedType = normalizeString(type).toLowerCase()
        const eventType = RECOMMENDATION_TIMELINE_EVENT_TYPES.has(normalizedType) ? normalizedType : 'comment'
        const eventTimestamp = normalizeRecommendationIsoTimestamp(createdAt) || new Date().toISOString()
        const commentBody = normalizeString(body)

        return {
            id: createRecommendationTimelineEventId(),
            type: eventType,
            createdAt: eventTimestamp,
            actor: normalizeRecommendationActor(actor, eventType === 'created' ? 'user' : 'system'),
            body: commentBody || null,
        }
    }
    const normalizeRecommendationTimelineEvent = (entry = {}, index = 0) => {
        const normalizedType = normalizeString(entry?.type || entry?.event).toLowerCase()
        const type = RECOMMENDATION_TIMELINE_EVENT_TYPES.has(normalizedType) ? normalizedType : 'comment'
        const createdAt = normalizeRecommendationIsoTimestamp(entry?.createdAt || entry?.at)
        const actor = normalizeRecommendationActor(entry?.actor, type === 'created' ? 'user' : 'system')
        const body =
            normalizeString(entry?.body)
            || normalizeString(entry?.comment)
            || normalizeString(entry?.message)
            || null
        const explicitId = normalizeString(entry?.id)
        const id = explicitId || `${type}:${createdAt || 'unknown'}:${index}`

        return {
            id,
            type,
            createdAt,
            actor,
            body,
        }
    }
    const resolveLegacyRecommendationTimeline = (entry = {}) => {
        const timeline = []
        const requestedAt = normalizeRecommendationIsoTimestamp(entry?.requestedAt)
        if (requestedAt) {
            timeline.push(
                createRecommendationTimelineEvent({
                    type: 'created',
                    actor: normalizeRecommendationActor(
                        {
                            role: 'user',
                            discordId: normalizeString(entry?.requestedBy?.discordId) || null,
                            tag: normalizeString(entry?.requestedBy?.tag) || null,
                        },
                        'user',
                    ),
                    createdAt: requestedAt,
                }),
            )
        }

        const approvedAt = normalizeRecommendationIsoTimestamp(entry?.approvedAt)
        if (approvedAt || isApprovedRecommendationStatus(entry?.status)) {
            timeline.push(
                createRecommendationTimelineEvent({
                    type: 'approved',
                    actor: normalizeRecommendationActor(
                        {
                            role: 'admin',
                            username: normalizeString(entry?.approvedBy?.username) || null,
                            discordId: normalizeString(entry?.approvedBy?.discordId) || null,
                        },
                        'admin',
                    ),
                    createdAt: approvedAt || requestedAt || new Date().toISOString(),
                }),
            )
        }

        const deniedAt = normalizeRecommendationIsoTimestamp(entry?.deniedAt)
        const denialReason = normalizeString(entry?.denialReason)
        if (deniedAt || isDeniedRecommendationStatus(entry?.status)) {
            timeline.push(
                createRecommendationTimelineEvent({
                    type: 'denied',
                    actor: normalizeRecommendationActor(
                        {
                            role: 'admin',
                            username: normalizeString(entry?.deniedBy?.username) || null,
                            discordId: normalizeString(entry?.deniedBy?.discordId) || null,
                        },
                        'admin',
                    ),
                    body: denialReason || null,
                    createdAt: deniedAt || requestedAt || new Date().toISOString(),
                }),
            )
        }

        return timeline
    }
    const dedupeRecommendationTimeline = (events = []) => {
        const seen = new Set()
        const out = []

        for (const event of events) {
            if (!event || typeof event !== 'object') {
                continue
            }

            const key = [
                normalizeString(event?.type),
                normalizeString(event?.createdAt),
                normalizeString(event?.body),
                normalizeString(event?.actor?.discordId),
                normalizeString(event?.actor?.username),
                normalizeString(event?.actor?.role),
            ].join(':')
            if (seen.has(key)) {
                continue
            }

            seen.add(key)
            out.push(event)
        }

        return out
    }
    const resolveRecommendationTimeline = (entry = {}) => {
        const explicitTimeline = Array.isArray(entry?.timeline)
            ? entry.timeline.map((event, index) => normalizeRecommendationTimelineEvent(event, index))
            : []
        const merged = dedupeRecommendationTimeline([
            ...explicitTimeline,
            ...resolveLegacyRecommendationTimeline(entry),
        ])

        return merged.sort(
            (left, right) => resolveRecommendationTimestamp(left?.createdAt) - resolveRecommendationTimestamp(right?.createdAt),
        )
    }
    const resolveRecommendationLastActivityAt = (entry = {}, timeline = []) => {
        const timelineTimestamps = Array.isArray(timeline)
            ? timeline.map((event) => normalizeRecommendationIsoTimestamp(event?.createdAt)).filter(Boolean)
            : []
        const candidates = [
            normalizeRecommendationIsoTimestamp(entry?.completedAt),
            normalizeRecommendationIsoTimestamp(entry?.deniedAt),
            normalizeRecommendationIsoTimestamp(entry?.approvedAt),
            ...timelineTimestamps,
            normalizeRecommendationIsoTimestamp(entry?.requestedAt),
        ].filter(Boolean)
        if (candidates.length === 0) {
            return null
        }

        let latest = candidates[0]
        for (const candidate of candidates.slice(1)) {
            if (resolveRecommendationTimestamp(candidate) > resolveRecommendationTimestamp(latest)) {
                latest = candidate
            }
        }
        return latest
    }
    const normalizeRecommendationDoc = (entry = {}) => {
        const requestedBy = entry?.requestedBy && typeof entry.requestedBy === 'object' ? entry.requestedBy : {}
        const discordContext =
            entry?.discordContext && typeof entry.discordContext === 'object' ? entry.discordContext : {}
        const approvedBy = entry?.approvedBy && typeof entry.approvedBy === 'object' ? entry.approvedBy : {}
        const deniedBy = entry?.deniedBy && typeof entry.deniedBy === 'object' ? entry.deniedBy : {}
        const selectedOptionIndexRaw = Number(entry?.selectedOptionIndex)
        const timeline = resolveRecommendationTimeline(entry)
        const denialReason = normalizeString(entry?.denialReason) || null

        return {
            id: resolveRecommendationId(entry?._id),
            source: normalizeString(entry?.source) || 'discord',
            status: normalizeString(entry?.status) || 'pending',
            requestedAt: normalizeRecommendationIsoTimestamp(entry?.requestedAt) || null,
            query: normalizeString(entry?.query) || null,
            searchId: normalizeString(entry?.searchId) || null,
            selectedOptionIndex: Number.isFinite(selectedOptionIndexRaw) ? selectedOptionIndexRaw : null,
            title: normalizeString(entry?.title) || null,
            href: normalizeString(entry?.href) || null,
            approvedAt: normalizeRecommendationIsoTimestamp(entry?.approvedAt) || null,
            approvedBy: {
                username: normalizeString(approvedBy?.username) || null,
                discordId: normalizeString(approvedBy?.discordId) || null,
            },
            deniedAt: normalizeRecommendationIsoTimestamp(entry?.deniedAt) || null,
            deniedBy: {
                username: normalizeString(deniedBy?.username) || null,
                discordId: normalizeString(deniedBy?.discordId) || null,
            },
            denialReason,
            lastActivityAt: resolveRecommendationLastActivityAt(entry, timeline),
            requestedBy: {
                discordId: normalizeString(requestedBy?.discordId) || null,
                tag: normalizeString(requestedBy?.tag) || null,
            },
            discordContext: {
                guildId: normalizeString(discordContext?.guildId) || null,
                channelId: normalizeString(discordContext?.channelId) || null,
            },
            timeline,
        }
    }
    const buildRecommendationDocumentQueries = (entry = {}) => {
        const queries = []
        const seen = new Set()
        const pushQuery = (query = {}) => {
            if (!query || typeof query !== 'object' || Object.keys(query).length === 0) {
                return
            }

            const serialized = JSON.stringify(query)
            if (seen.has(serialized)) {
                return
            }

            seen.add(serialized)
            queries.push(query)
        }

        if (entry && typeof entry === 'object' && '_id' in entry && entry._id != null) {
            pushQuery({_id: entry._id})
        }

        const fallbackQuery = {}
        const source = normalizeString(entry?.source)
        if (source) {
            fallbackQuery.source = source
        }

        const status = normalizeString(entry?.status)
        if (status) {
            fallbackQuery.status = status
        }

        const requestedAt = normalizeString(entry?.requestedAt)
        if (requestedAt) {
            fallbackQuery.requestedAt = requestedAt
        }

        const query = normalizeString(entry?.query)
        if (query) {
            fallbackQuery.query = query
        }

        const searchId = normalizeString(entry?.searchId)
        if (searchId) {
            fallbackQuery.searchId = searchId
        }

        const selectedOptionIndexRaw = Number(entry?.selectedOptionIndex)
        if (Number.isFinite(selectedOptionIndexRaw)) {
            fallbackQuery.selectedOptionIndex = selectedOptionIndexRaw
        }

        const title = normalizeString(entry?.title)
        if (title) {
            fallbackQuery.title = title
        }

        const href = normalizeString(entry?.href)
        if (href) {
            fallbackQuery.href = href
        }

        const requestedByDiscordId = normalizeString(entry?.requestedBy?.discordId)
        if (requestedByDiscordId) {
            fallbackQuery['requestedBy.discordId'] = requestedByDiscordId
        }

        const requestedByTag = normalizeString(entry?.requestedBy?.tag)
        if (requestedByTag) {
            fallbackQuery['requestedBy.tag'] = requestedByTag
        }

        const guildId = normalizeString(entry?.discordContext?.guildId)
        if (guildId) {
            fallbackQuery['discordContext.guildId'] = guildId
        }

        const channelId = normalizeString(entry?.discordContext?.channelId)
        if (channelId) {
            fallbackQuery['discordContext.channelId'] = channelId
        }

        pushQuery(fallbackQuery)
        return queries
    }
    const recommendationBelongsToSession = (entry = {}, session = {}) => {
        const sessionDiscordUserId = normalizeString(session?.discordUserId)
        if (!sessionDiscordUserId) {
            return false
        }

        return normalizeString(entry?.requestedBy?.discordId) === sessionDiscordUserId
    }
    const sortRecommendationsByRequestedAt = (entries = []) =>
        [...entries].sort(
            (left, right) =>
                resolveRecommendationTimestamp(right?.requestedAt)
                - resolveRecommendationTimestamp(left?.requestedAt),
        )
    const findRecommendationDocumentById = (documents = [], id = '') =>
        documents.find((entry) => resolveRecommendationId(entry?._id) === id) ?? null
    const loadRecommendationDocuments = async () => {
        const documents = await vaultClient.mongo.findMany(RECOMMENDATIONS_COLLECTION, {})
        return Array.isArray(documents) ? documents : []
    }
    const persistRecommendationDocumentUpdate = async (entry = {}, update = {}) => {
        const queries = buildRecommendationDocumentQueries(entry)
        if (!queries.length) {
            return false
        }

        for (const query of queries) {
            const result = await vaultClient.mongo.update(
                RECOMMENDATIONS_COLLECTION,
                query,
                update,
            )

            const matchedRaw = Number(result?.matched ?? result?.matchedCount)
            const modifiedRaw = Number(result?.modified ?? result?.modifiedCount)
            const matched = Number.isFinite(matchedRaw) ? matchedRaw : 0
            const modified = Number.isFinite(modifiedRaw) ? modifiedRaw : 0
            if (matched > 0 || modified > 0) {
                return true
            }
        }

        return false
    }
    const appendRecommendationTimelineEvent = (entry = {}, timelineEvent = {}) => {
        const timeline = Array.isArray(entry?.timeline)
            ? entry.timeline.filter((event) => event && typeof event === 'object')
            : []
        return [...timeline, timelineEvent]
    }

    app.use('/api/raven', requireSessionIfSetupCompleted)
    app.use('/api/recommendations', requireSessionIfSetupCompleted)
    app.use('/api/myrecommendations', requireSessionIfSetupCompleted)

    app.get('/api/recommendations', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        if (!hasMoonPermission(session, 'manageRecommendations')) {
            res.status(403).json({error: 'Manage recommendations permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany) {
            res.status(503).json({error: 'Vault recommendation storage is not configured.'})
            return
        }

        const limit = parseRecommendationLimit(req.query?.limit)

        try {
            const documents = await loadRecommendationDocuments()
            const recommendations = sortRecommendationsByRequestedAt(
                documents.map((entry) => normalizeRecommendationDoc(entry)),
            )

            res.json({
                collection: RECOMMENDATIONS_COLLECTION,
                limit,
                canManage: true,
                total: recommendations.length,
                recommendations: recommendations.slice(0, limit),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load recommendations: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve recommendation records.'})
        }
    })

    app.get('/api/myrecommendations', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        const canManage = hasMoonPermission(session, 'manageRecommendations')
        if (!canManage && !hasMoonPermission(session, 'myRecommendations')) {
            res.status(403).json({error: 'My recommendations permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany) {
            res.status(503).json({error: 'Vault recommendation storage is not configured.'})
            return
        }

        const limit = parseRecommendationLimit(req.query?.limit)

        try {
            const documents = await loadRecommendationDocuments()
            const recommendations = sortRecommendationsByRequestedAt(
                documents
                    .filter((entry) => recommendationBelongsToSession(entry, session))
                    .map((entry) => normalizeRecommendationDoc(entry)),
            )

            res.json({
                collection: RECOMMENDATIONS_COLLECTION,
                limit,
                canManage,
                total: recommendations.length,
                recommendations: recommendations.slice(0, limit),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load my recommendations: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve recommendation records.'})
        }
    })

    app.get('/api/recommendations/:id', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        if (!hasMoonPermission(session, 'manageRecommendations')) {
            res.status(403).json({error: 'Manage recommendations permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany) {
            res.status(503).json({error: 'Vault recommendation storage is not configured.'})
            return
        }

        const id = normalizeString(req.params?.id)
        if (!id) {
            res.status(400).json({error: 'Recommendation id is required.'})
            return
        }

        try {
            const documents = await loadRecommendationDocuments()
            const target = findRecommendationDocumentById(documents, id)
            if (!target) {
                res.status(404).json({error: 'Recommendation not found.'})
                return
            }

            res.json({
                recommendation: normalizeRecommendationDoc(target),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load recommendation ${id}: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve recommendation.'})
        }
    })

    app.get('/api/myrecommendations/:id', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        const canManage = hasMoonPermission(session, 'manageRecommendations')
        if (!canManage && !hasMoonPermission(session, 'myRecommendations')) {
            res.status(403).json({error: 'My recommendations permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany) {
            res.status(503).json({error: 'Vault recommendation storage is not configured.'})
            return
        }

        const id = normalizeString(req.params?.id)
        if (!id) {
            res.status(400).json({error: 'Recommendation id is required.'})
            return
        }

        try {
            const documents = await loadRecommendationDocuments()
            const target = findRecommendationDocumentById(documents, id)
            if (!target) {
                res.status(404).json({error: 'Recommendation not found.'})
                return
            }

            if (!recommendationBelongsToSession(target, session) && !canManage) {
                res.status(404).json({error: 'Recommendation not found.'})
                return
            }

            res.json({
                recommendation: normalizeRecommendationDoc(target),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load my recommendation ${id}: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve recommendation.'})
        }
    })

    app.delete('/api/recommendations/:id', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        if (!hasMoonPermission(session, 'manageRecommendations')) {
            res.status(403).json({error: 'Manage recommendations permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany || !vaultClient?.mongo?.delete) {
            res.status(503).json({error: 'Vault recommendation storage is not configured.'})
            return
        }

        const id = normalizeString(req.params?.id)
        if (!id) {
            res.status(400).json({error: 'Recommendation id is required.'})
            return
        }

        try {
            const documents = await loadRecommendationDocuments()
            const target = findRecommendationDocumentById(documents, id)
            if (!target) {
                res.status(404).json({error: 'Recommendation not found.'})
                return
            }

            const queries = buildRecommendationDocumentQueries(target)
            if (queries.length === 0) {
                res.status(409).json({error: 'Recommendation does not have a delete query.'})
                return
            }

            let deleted = 0
            for (const query of queries) {
                const result = await vaultClient.mongo.delete(RECOMMENDATIONS_COLLECTION, query)
                const deletedRaw = Number(result?.deleted ?? result?.deletedCount)
                const deletedCount = Number.isFinite(deletedRaw) ? deletedRaw : 0
                if (deletedCount > 0) {
                    deleted = deletedCount
                    break
                }
            }

            if (deleted <= 0) {
                res.status(404).json({error: 'Recommendation not found.'})
                return
            }

            res.json({
                ok: true,
                deleted,
                id,
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to delete recommendation ${id}: ${error.message}`)
            res.status(502).json({error: 'Unable to delete recommendation.'})
        }
    })

    app.post('/api/recommendations/:id/approve', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        if (!hasMoonPermission(session, 'manageRecommendations')) {
            res.status(403).json({error: 'Manage recommendations permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany || !vaultClient?.mongo?.update) {
            res.status(503).json({error: 'Vault recommendation storage is not configured.'})
            return
        }

        if (!ravenClient?.queueDownload) {
            res.status(503).json({error: 'Raven download queue is not configured.'})
            return
        }

        const id = normalizeString(req.params?.id)
        if (!id) {
            res.status(400).json({error: 'Recommendation id is required.'})
            return
        }

        try {
            const documents = await loadRecommendationDocuments()
            const target = findRecommendationDocumentById(documents, id)
            if (!target) {
                res.status(404).json({error: 'Recommendation not found.'})
                return
            }

            const recommendation = normalizeRecommendationDoc(target)
            if (isApprovedRecommendationStatus(recommendation?.status)) {
                res.status(409).json({error: 'Recommendation has already been approved.'})
                return
            }
            if (!isPendingRecommendationStatus(recommendation?.status)) {
                res.status(409).json({error: 'Recommendation is no longer pending.'})
                return
            }

            const searchId = normalizeString(recommendation?.searchId)
            const selectedOptionIndex = Number(target?.selectedOptionIndex ?? recommendation?.selectedOptionIndex)
            if (!searchId || !Number.isFinite(selectedOptionIndex)) {
                res.status(409).json({error: 'Recommendation is missing Raven queue details.'})
                return
            }

            let queueResult = null
            try {
                queueResult = await ravenClient.queueDownload({searchId, optionIndex: selectedOptionIndex})
            } catch (error) {
                logger.error(`[${serviceName}] Failed to queue approved recommendation ${id}: ${error.message}`)
                res.status(502).json({error: 'Unable to queue Raven download for this recommendation.'})
                return
            }

            const approvedAt = new Date().toISOString()
            const approvedBy = recommendationActorFromSession(session, 'admin')
            const approvedTimelineEvent = createRecommendationTimelineEvent({
                type: 'approved',
                actor: approvedBy,
                createdAt: approvedAt,
            })
            const nextTimeline = appendRecommendationTimelineEvent(target, approvedTimelineEvent)
            const updatePersisted = await persistRecommendationDocumentUpdate(target, {
                $set: {
                    status: 'approved',
                    approvedAt,
                    approvedBy: {
                        username: approvedBy.username,
                        discordId: approvedBy.discordId,
                    },
                    deniedAt: null,
                    deniedBy: null,
                    denialReason: null,
                    timeline: nextTimeline,
                },
            })

            if (!updatePersisted) {
                res.status(502).json({error: 'Vault did not persist recommendation approval.'})
                return
            }

            const refreshedDocuments = await loadRecommendationDocuments()
            const refreshedTarget = findRecommendationDocumentById(refreshedDocuments, id)
            if (!refreshedTarget) {
                res.status(502).json({error: 'Vault did not persist recommendation approval.'})
                return
            }

            const persistedRecommendation = normalizeRecommendationDoc(refreshedTarget)
            if (!isApprovedRecommendationStatus(persistedRecommendation?.status)) {
                res.status(502).json({error: 'Vault did not persist recommendation approval.'})
                return
            }

            res.json({
                ok: true,
                id,
                queueResult,
                recommendation: persistedRecommendation,
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to approve recommendation ${id}: ${error.message}`)
            res.status(502).json({error: 'Unable to approve recommendation.'})
        }
    })

    app.post('/api/recommendations/:id/deny', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        if (!hasMoonPermission(session, 'manageRecommendations')) {
            res.status(403).json({error: 'Manage recommendations permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany || !vaultClient?.mongo?.update) {
            res.status(503).json({error: 'Vault recommendation storage is not configured.'})
            return
        }

        const id = normalizeString(req.params?.id)
        if (!id) {
            res.status(400).json({error: 'Recommendation id is required.'})
            return
        }

        const denialReasonRaw = normalizeString(req.body?.reason || req.body?.comment)
        if (denialReasonRaw.length > MAX_RECOMMENDATION_COMMENT_LENGTH) {
            res.status(400).json({error: `Reason must be ${MAX_RECOMMENDATION_COMMENT_LENGTH} characters or fewer.`})
            return
        }

        try {
            const documents = await loadRecommendationDocuments()
            const target = findRecommendationDocumentById(documents, id)
            if (!target) {
                res.status(404).json({error: 'Recommendation not found.'})
                return
            }

            const recommendation = normalizeRecommendationDoc(target)
            if (isDeniedRecommendationStatus(recommendation?.status)) {
                res.status(409).json({error: 'Recommendation has already been denied.'})
                return
            }
            if (!isPendingRecommendationStatus(recommendation?.status)) {
                res.status(409).json({error: 'Recommendation is no longer pending.'})
                return
            }

            const deniedAt = new Date().toISOString()
            const deniedBy = recommendationActorFromSession(session, 'admin')
            const denialReason = denialReasonRaw || null
            const deniedTimelineEvent = createRecommendationTimelineEvent({
                type: 'denied',
                actor: deniedBy,
                body: denialReason,
                createdAt: deniedAt,
            })
            const nextTimeline = appendRecommendationTimelineEvent(target, deniedTimelineEvent)
            const updatePersisted = await persistRecommendationDocumentUpdate(target, {
                $set: {
                    status: 'denied',
                    deniedAt,
                    deniedBy: {
                        username: deniedBy.username,
                        discordId: deniedBy.discordId,
                    },
                    denialReason,
                    timeline: nextTimeline,
                },
            })
            if (!updatePersisted) {
                res.status(502).json({error: 'Vault did not persist recommendation denial.'})
                return
            }

            const refreshedDocuments = await loadRecommendationDocuments()
            const refreshedTarget = findRecommendationDocumentById(refreshedDocuments, id)
            if (!refreshedTarget) {
                res.status(502).json({error: 'Vault did not persist recommendation denial.'})
                return
            }

            const persistedRecommendation = normalizeRecommendationDoc(refreshedTarget)
            if (!isDeniedRecommendationStatus(persistedRecommendation?.status)) {
                res.status(502).json({error: 'Vault did not persist recommendation denial.'})
                return
            }

            res.json({
                ok: true,
                id,
                recommendation: persistedRecommendation,
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to deny recommendation ${id}: ${error.message}`)
            res.status(502).json({error: 'Unable to deny recommendation.'})
        }
    })

    app.post('/api/recommendations/:id/comments', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        if (!hasMoonPermission(session, 'manageRecommendations')) {
            res.status(403).json({error: 'Manage recommendations permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany || !vaultClient?.mongo?.update) {
            res.status(503).json({error: 'Vault recommendation storage is not configured.'})
            return
        }

        const id = normalizeString(req.params?.id)
        if (!id) {
            res.status(400).json({error: 'Recommendation id is required.'})
            return
        }

        const comment = normalizeString(req.body?.comment)
        if (!comment) {
            res.status(400).json({error: 'Comment text is required.'})
            return
        }
        if (comment.length > MAX_RECOMMENDATION_COMMENT_LENGTH) {
            res.status(400).json({error: `Comment must be ${MAX_RECOMMENDATION_COMMENT_LENGTH} characters or fewer.`})
            return
        }

        try {
            const documents = await loadRecommendationDocuments()
            const target = findRecommendationDocumentById(documents, id)
            if (!target) {
                res.status(404).json({error: 'Recommendation not found.'})
                return
            }

            const commentedAt = new Date().toISOString()
            const actor = recommendationActorFromSession(session, 'admin')
            const timelineEvent = createRecommendationTimelineEvent({
                type: 'comment',
                actor,
                body: comment,
                createdAt: commentedAt,
            })
            const nextTimeline = appendRecommendationTimelineEvent(target, timelineEvent)
            const updatePersisted = await persistRecommendationDocumentUpdate(target, {
                $set: {
                    timeline: nextTimeline,
                },
            })
            if (!updatePersisted) {
                res.status(502).json({error: 'Vault did not persist recommendation comment.'})
                return
            }

            const refreshedDocuments = await loadRecommendationDocuments()
            const refreshedTarget = findRecommendationDocumentById(refreshedDocuments, id)
            if (!refreshedTarget) {
                res.status(502).json({error: 'Vault did not persist recommendation comment.'})
                return
            }

            res.json({
                ok: true,
                id,
                recommendation: normalizeRecommendationDoc(refreshedTarget),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to add recommendation comment ${id}: ${error.message}`)
            res.status(502).json({error: 'Unable to add recommendation comment.'})
        }
    })

    app.post('/api/myrecommendations/:id/comments', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        const canManage = hasMoonPermission(session, 'manageRecommendations')
        if (!canManage && !hasMoonPermission(session, 'myRecommendations')) {
            res.status(403).json({error: 'My recommendations permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany || !vaultClient?.mongo?.update) {
            res.status(503).json({error: 'Vault recommendation storage is not configured.'})
            return
        }

        const id = normalizeString(req.params?.id)
        if (!id) {
            res.status(400).json({error: 'Recommendation id is required.'})
            return
        }

        const comment = normalizeString(req.body?.comment)
        if (!comment) {
            res.status(400).json({error: 'Comment text is required.'})
            return
        }
        if (comment.length > MAX_RECOMMENDATION_COMMENT_LENGTH) {
            res.status(400).json({error: `Comment must be ${MAX_RECOMMENDATION_COMMENT_LENGTH} characters or fewer.`})
            return
        }

        try {
            const documents = await loadRecommendationDocuments()
            const target = findRecommendationDocumentById(documents, id)
            if (!target) {
                res.status(404).json({error: 'Recommendation not found.'})
                return
            }

            const isOwner = recommendationBelongsToSession(target, session)
            if (!isOwner && !canManage) {
                res.status(404).json({error: 'Recommendation not found.'})
                return
            }

            const commentedAt = new Date().toISOString()
            const actor = recommendationActorFromSession(session, isOwner ? 'user' : 'admin')
            const timelineEvent = createRecommendationTimelineEvent({
                type: 'comment',
                actor,
                body: comment,
                createdAt: commentedAt,
            })
            const nextTimeline = appendRecommendationTimelineEvent(target, timelineEvent)
            const updatePersisted = await persistRecommendationDocumentUpdate(target, {
                $set: {
                    timeline: nextTimeline,
                },
            })
            if (!updatePersisted) {
                res.status(502).json({error: 'Vault did not persist recommendation comment.'})
                return
            }

            const refreshedDocuments = await loadRecommendationDocuments()
            const refreshedTarget = findRecommendationDocumentById(refreshedDocuments, id)
            if (!refreshedTarget) {
                res.status(502).json({error: 'Vault did not persist recommendation comment.'})
                return
            }

            res.json({
                ok: true,
                id,
                recommendation: normalizeRecommendationDoc(refreshedTarget),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to add my recommendation comment ${id}: ${error.message}`)
            res.status(502).json({error: 'Unable to add recommendation comment.'})
        }
    })

    app.get('/api/raven/library/latest', async (req, res) => {
        try {
            const library = await ravenClient.getLibrary()
            res.json(library ?? [])
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load latest Raven titles: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve latest Raven titles.'})
        }
    })

    app.get('/api/raven/library', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'library_management', 'Library management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'download_management', 'Download management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'library_management', 'Library management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'library_management', 'Library management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'library_management', 'Library management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'library_management', 'Library management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'library_management', 'Library management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'library_management', 'Library management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'library_management', 'Library management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'download_management', 'Download management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'download_management', 'Download management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'download_management', 'Download management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'download_management', 'Download management permission is required.')) {
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
        if (!ensureMoonPermission(req, res, 'download_management', 'Download management permission is required.')) {
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
