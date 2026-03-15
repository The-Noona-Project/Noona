// services/sage/routes/registerRavenRoutes.mjs

export function registerRavenRoutes(context = {}) {
    const {
        app,
        ensureMoonPermission,
        hasMoonPermission,
        logger,
        portalClient,
        ravenClient,
        vaultClient,
        requireSessionIfSetupCompleted,
        serviceName,
    } = context

    const RECOMMENDATIONS_COLLECTION = 'portal_recommendations'
    const SUBSCRIPTIONS_COLLECTION = 'portal_subscriptions'
    const SAVED_FOR_LATER_MESSAGE = 'Noona could not find a matching Raven source yet. We are working to expand our content reach, and this will be saved for later.'
    const APPROVED_RECOMMENDATION_STATUSES = new Set(['approved', 'accepted'])
    const DENIED_RECOMMENDATION_STATUSES = new Set(['denied', 'rejected', 'declined'])
    const PENDING_RECOMMENDATION_STATUSES = new Set(['pending', 'new', 'requested'])
    const RECOMMENDATION_TIMELINE_EVENT_TYPES = new Set([
        'created',
        'approved',
        'denied',
        'comment',
        'download-started',
        'download-progress',
        'download-completed',
    ])
    const MAX_RECOMMENDATION_COMMENT_LENGTH = 2000

    const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '')
    const normalizeDistinctStrings = (...values) => {
        const out = []
        const seen = new Set()

        for (const value of values) {
            if (Array.isArray(value)) {
                for (const nestedValue of value) {
                    const normalizedNested = normalizeString(nestedValue)
                    if (!normalizedNested) {
                        continue
                    }

                    const nestedKey = normalizedNested.toLowerCase()
                    if (seen.has(nestedKey)) {
                        continue
                    }

                    seen.add(nestedKey)
                    out.push(normalizedNested)
                }
                continue
            }

            const normalized = normalizeString(value)
            if (!normalized) {
                continue
            }

            const key = normalized.toLowerCase()
            if (seen.has(key)) {
                continue
            }

            seen.add(key)
            out.push(normalized)
        }

        return out
    }
    const normalizeRecommendationTitleKey = (value) =>
        normalizeString(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
    const normalizePositiveInteger = (value) => {
        const parsed = Number.parseInt(String(value), 10)
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null
    }
    const normalizeComparableUrl = (value) => {
        const normalized = normalizeString(value)
        if (!normalized) {
            return null
        }

        try {
            const parsed = new URL(normalized)
            parsed.hash = ''
            return parsed.toString()
        } catch {
            return null
        }
    }
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
    const normalizeMetadataIdentifier = (value) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return String(value)
        }

        const normalized = normalizeString(value)
        return normalized || null
    }
    const normalizeRecommendationMetadataStatus = (value) => {
        const normalized = normalizeString(value).toLowerCase()
        if (normalized === 'applied' || normalized === 'failed') {
            return normalized
        }

        return 'pending'
    }
    const normalizeRecommendationMetadataAdultContent = (value) => {
        if (typeof value === 'boolean') {
            return value
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            if (value === 1) return true
            if (value === 0) return false
        }

        const normalized = normalizeString(value).toLowerCase()
        if (!normalized) {
            return null
        }

        if (normalized === 'true' || normalized === 'yes' || normalized === 'y' || normalized === '1') {
            return true
        }

        if (normalized === 'false' || normalized === 'no' || normalized === 'n' || normalized === '0') {
            return false
        }

        return null
    }
    const normalizeRecommendationSourceAdultContent = (value) =>
        normalizeRecommendationMetadataAdultContent(value)
    const normalizeRecommendationMetadataSelection = (value = {}) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null
        }

        const selectedBySource = value?.selectedBy && typeof value.selectedBy === 'object' ? value.selectedBy : {}
        const query = normalizeString(value?.query) || null
        const title = normalizeString(value?.title ?? value?.name) || null
        const aliases = normalizeDistinctStrings(
            value?.aliases,
            value?.Aliases,
            value?.alternativeTitles,
            value?.AlternativeTitles,
            value?.alternateTitles,
            value?.AlternateTitles,
        ).filter((alias) => normalizeRecommendationTitleKey(alias) !== normalizeRecommendationTitleKey(title))
        const provider = normalizeString(value?.provider) || null
        const providerSeriesId = normalizeMetadataIdentifier(value?.providerSeriesId ?? value?.resultId)
        const aniListId = normalizeMetadataIdentifier(value?.aniListId ?? value?.AniListId)
        const malId = normalizeMetadataIdentifier(value?.malId ?? value?.MALId ?? value?.MalId)
        const cbrId = normalizeMetadataIdentifier(value?.cbrId ?? value?.CbrId)
        const summary = normalizeString(value?.summary) || null
        const sourceUrl = normalizeString(value?.sourceUrl) || null
        const coverImageUrl = normalizeString(value?.coverImageUrl) || null
        const adultContent = normalizeRecommendationMetadataAdultContent(
            value?.adultContent ?? value?.adult_content ?? value?.['Adult Content'],
        )
        const hasUsefulData = Boolean(
            query
            || title
            || aliases.length > 0
            || provider
            || providerSeriesId
            || aniListId
            || malId
            || cbrId
            || summary
            || sourceUrl
            || coverImageUrl
            || adultContent != null
        )
        if (!hasUsefulData) {
            return null
        }

        return {
            status: normalizeRecommendationMetadataStatus(value?.status),
            query,
            title,
            aliases,
            provider,
            providerSeriesId,
            aniListId,
            malId,
            cbrId,
            summary,
            sourceUrl,
            coverImageUrl,
            adultContent,
            selectedAt: normalizeRecommendationIsoTimestamp(value?.selectedAt) || null,
            selectedBy: {
                username: normalizeString(selectedBySource?.username) || null,
                discordId: normalizeString(selectedBySource?.discordId) || null,
            },
            queuedAt: normalizeRecommendationIsoTimestamp(value?.queuedAt) || null,
            titleUuid: normalizeString(value?.titleUuid) || null,
            appliedAt: normalizeRecommendationIsoTimestamp(value?.appliedAt) || null,
            appliedSeriesId: normalizePositiveInteger(value?.appliedSeriesId),
            appliedLibraryId: normalizePositiveInteger(value?.appliedLibraryId),
            appliedTitle: normalizeString(value?.appliedTitle) || null,
            lastAttemptedAt: normalizeRecommendationIsoTimestamp(value?.lastAttemptedAt) || null,
            lastError: normalizeString(value?.lastError) || null,
        }
    }
    const recommendationMetadataHasIdentifiers = (selection = {}) => {
        const provider = normalizeString(selection?.provider)
        const providerSeriesId = normalizeMetadataIdentifier(selection?.providerSeriesId)
        if (provider && providerSeriesId) {
            return true
        }

        return Boolean(
            normalizeMetadataIdentifier(selection?.aniListId)
            || normalizeMetadataIdentifier(selection?.malId)
            || normalizeMetadataIdentifier(selection?.cbrId),
        )
    }
    const createRecommendationMetadataSelectionTimelineEvent = (selection = {}) => {
        const metadataSelection = normalizeRecommendationMetadataSelection(selection)
        if (!metadataSelection || !recommendationMetadataHasIdentifiers(metadataSelection)) {
            return null
        }

        const providerLabel = normalizeString(metadataSelection?.provider).toUpperCase()
        const providerSeriesId = normalizeString(metadataSelection?.providerSeriesId)
        const selectedTitle = normalizeString(metadataSelection?.title)
        const selectionLabel = selectedTitle || normalizeString(metadataSelection?.query) || 'the selected metadata match'
        const providerDetail = providerLabel && providerSeriesId
            ? `${providerLabel} (${providerSeriesId})`
            : providerLabel
                ? providerLabel
                : normalizeString(metadataSelection?.aniListId)
                    ? `AniList ${normalizeString(metadataSelection?.aniListId)}`
                    : normalizeString(metadataSelection?.malId)
                        ? `MyAnimeList ${normalizeString(metadataSelection?.malId)}`
                        : normalizeString(metadataSelection?.cbrId)
                            ? `ComicBookResources ${normalizeString(metadataSelection?.cbrId)}`
                            : 'the saved provider ids'

        return createRecommendationTimelineEvent({
            type: 'comment',
            actor: {
                role: 'system',
                username: 'Moon',
            },
            body: `Queued metadata plan for ${selectionLabel} using ${providerDetail}. Noona will apply it after Raven finishes downloading and Kavita has scanned the title.`,
        })
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
        const metadataSelection = normalizeRecommendationMetadataSelection(entry?.metadataSelection)
        const sourceAdultContent = normalizeRecommendationSourceAdultContent(
            entry?.sourceAdultContent ?? entry?.source_adult_content ?? entry?.adultContent ?? entry?.['Adult Content'],
        )

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
            sourceAdultContent,
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
            metadataSelection,
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
    const normalizeSubscriptionIsoTimestamp = (value) => {
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
    const resolveSubscriptionTimestamp = (value) => {
        const iso = normalizeSubscriptionIsoTimestamp(value)
        if (!iso) {
            return 0
        }

        const parsed = Date.parse(iso)
        return Number.isFinite(parsed) ? parsed : 0
    }
    const resolveSubscriptionStatus = (value) => normalizeString(value).toLowerCase()
    const isActiveSubscriptionStatus = (value) => resolveSubscriptionStatus(value) === 'active'
    const normalizeSubscriptionDoc = (entry = {}) => {
        const subscriber = entry?.subscriber && typeof entry.subscriber === 'object' ? entry.subscriber : {}
        const notifications = entry?.notifications && typeof entry.notifications === 'object' ? entry.notifications : {}
        const chapterDmCountRaw = Number(notifications?.chapterDmCount)

        return {
            id: resolveRecommendationId(entry?._id),
            source: normalizeString(entry?.source) || 'discord',
            status: normalizeString(entry?.status) || 'active',
            active: isActiveSubscriptionStatus(entry?.status),
            subscribedAt: normalizeSubscriptionIsoTimestamp(entry?.subscribedAt) || null,
            unsubscribedAt: normalizeSubscriptionIsoTimestamp(entry?.unsubscribedAt) || null,
            title: normalizeString(entry?.title) || null,
            titleQuery: normalizeString(entry?.titleQuery) || null,
            titleKey: normalizeString(entry?.titleKey) || null,
            titleUuid: normalizeString(entry?.titleUuid) || null,
            sourceUrl: normalizeString(entry?.sourceUrl) || null,
            subscriber: {
                discordId: normalizeString(subscriber?.discordId) || null,
                tag: normalizeString(subscriber?.tag) || null,
            },
            notifications: {
                chapterDmCount: Number.isFinite(chapterDmCountRaw) ? chapterDmCountRaw : 0,
                lastChapterDmAt: normalizeSubscriptionIsoTimestamp(notifications?.lastChapterDmAt) || null,
            },
        }
    }
    const buildSubscriptionDocumentQueries = (entry = {}) => {
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
        const subscriberDiscordId = normalizeString(entry?.subscriber?.discordId)
        if (subscriberDiscordId) {
            fallbackQuery['subscriber.discordId'] = subscriberDiscordId
        }

        const titleUuid = normalizeString(entry?.titleUuid)
        if (titleUuid) {
            fallbackQuery.titleUuid = titleUuid
        }

        const sourceUrl = normalizeString(entry?.sourceUrl)
        if (sourceUrl) {
            fallbackQuery.sourceUrl = sourceUrl
        }

        const titleKey = normalizeString(entry?.titleKey)
        if (titleKey) {
            fallbackQuery.titleKey = titleKey
        }

        const title = normalizeString(entry?.title)
        if (title) {
            fallbackQuery.title = title
        }

        const titleQuery = normalizeString(entry?.titleQuery)
        if (titleQuery) {
            fallbackQuery.titleQuery = titleQuery
        }

        pushQuery(fallbackQuery)
        return queries
    }
    const subscriptionBelongsToSession = (entry = {}, session = {}) => {
        const sessionDiscordUserId = normalizeString(session?.discordUserId)
        if (!sessionDiscordUserId) {
            return false
        }

        return normalizeString(entry?.subscriber?.discordId) === sessionDiscordUserId
    }
    const sortSubscriptions = (entries = []) =>
        [...entries].sort((left, right) => {
            const leftActive = isActiveSubscriptionStatus(left?.status)
            const rightActive = isActiveSubscriptionStatus(right?.status)
            if (leftActive !== rightActive) {
                return leftActive ? -1 : 1
            }

            const leftTimestamp = resolveSubscriptionTimestamp(left?.subscribedAt)
            const rightTimestamp = resolveSubscriptionTimestamp(right?.subscribedAt)
            if (leftTimestamp !== rightTimestamp) {
                return rightTimestamp - leftTimestamp
            }

            const leftTitle = normalizeString(left?.title) || normalizeString(left?.titleQuery)
            const rightTitle = normalizeString(right?.title) || normalizeString(right?.titleQuery)
            return leftTitle.localeCompare(rightTitle)
        })
    const findSubscriptionDocumentById = (documents = [], id = '') =>
        documents.find((entry) => resolveRecommendationId(entry?._id) === id) ?? null
    const loadSubscriptionDocuments = async () => {
        const documents = await vaultClient.mongo.findMany(SUBSCRIPTIONS_COLLECTION, {})
        return Array.isArray(documents) ? documents : []
    }
    const persistSubscriptionDocumentUpdate = async (entry = {}, update = {}) => {
        const queries = buildSubscriptionDocumentQueries(entry)
        if (!queries.length) {
            return false
        }

        for (const query of queries) {
            const result = await vaultClient.mongo.update(
                SUBSCRIPTIONS_COLLECTION,
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
    const resolveRecommendationMetadataQuery = (entry = {}) =>
        normalizeString(entry?.title) || normalizeString(entry?.query) || null
    const resolveQueuedRecommendationTitleUuid = (queueResult = {}) => {
        if (!queueResult || typeof queueResult !== 'object') {
            return null
        }

        const candidates = [
            queueResult?.titleUuid,
            queueResult?.uuid,
            queueResult?.title?.uuid,
            queueResult?.title?.titleUuid,
            queueResult?.task?.titleUuid,
        ]
        for (const candidate of candidates) {
            const normalized = normalizeString(candidate)
            if (normalized) {
                return normalized
            }
        }

        return null
    }
    const normalizeRavenSearchOptionIndex = (value, fallbackIndex) => {
        const parsed = Number.parseInt(String(value), 10)
        return Number.isInteger(parsed) && parsed > 0 ? parsed : fallbackIndex
    }
    const normalizeRavenSearchPayload = (payload = {}) => {
        const searchId = normalizeString(payload?.searchId)
        const rawOptions = Array.isArray(payload?.options) ? payload.options : []

        return {
            searchId,
            options: rawOptions
                .map((entry, index) => {
                    const title = normalizeString(entry?.title)
                    if (!title) {
                        return null
                    }

                    return {
                        title,
                        href: normalizeString(entry?.href) || null,
                        optionIndex: normalizeRavenSearchOptionIndex(
                            entry?.optionIndex ?? entry?.option_number ?? entry?.index,
                            index + 1,
                        ),
                    }
                })
                .filter(Boolean),
        }
    }
    const buildRecommendationSourceSearchCandidates = ({
                                                           recommendation = {},
                                                           metadataSelection = null,
                                                           metadataQuery = '',
                                                       } = {}) =>
        normalizeDistinctStrings(
            normalizeString(metadataSelection?.title),
            metadataSelection?.aliases,
            normalizeString(metadataSelection?.query),
            normalizeString(metadataQuery),
            normalizeString(recommendation?.title),
            normalizeString(recommendation?.query),
        )
    const optionMatchesRecommendationCandidates = (option = {}, candidateKeys = new Set(), recommendationHref = null) => {
        const titleKey = normalizeRecommendationTitleKey(option?.title)
        if (titleKey && candidateKeys.has(titleKey)) {
            return true
        }

        const optionHref = normalizeComparableUrl(option?.href)
        return Boolean(recommendationHref && optionHref && optionHref === recommendationHref)
    }
    const resolveRavenRecommendationQueueTarget = async ({
                                                             recommendation = {},
                                                             metadataSelection = null,
                                                             metadataQuery = '',
                                                         } = {}) => {
        if (typeof ravenClient?.searchTitle !== 'function') {
            return null
        }

        const candidates = buildRecommendationSourceSearchCandidates({
            recommendation,
            metadataSelection,
            metadataQuery,
        })
        if (candidates.length === 0) {
            return null
        }

        const candidateKeys = new Set(
            candidates
                .map((value) => normalizeRecommendationTitleKey(value))
                .filter(Boolean),
        )
        const recommendationHref = normalizeComparableUrl(recommendation?.href)

        for (const query of candidates) {
            let searchPayload = null
            try {
                searchPayload = await ravenClient.searchTitle(query)
            } catch (error) {
                logger.warn?.(`[${serviceName}] Failed to search Raven for recommendation recovery "${query}": ${error.message}`)
                continue
            }

            const normalizedPayload = normalizeRavenSearchPayload(searchPayload)
            if (!normalizedPayload.searchId || normalizedPayload.options.length === 0) {
                continue
            }

            for (const option of normalizedPayload.options) {
                if (optionMatchesRecommendationCandidates(option, candidateKeys, recommendationHref)) {
                    let sourceAdultContent = null
                    if (option.href && typeof ravenClient?.getTitleDetails === 'function') {
                        try {
                            const details = await ravenClient.getTitleDetails(option.href)
                            sourceAdultContent = normalizeRecommendationSourceAdultContent(details?.adultContent)
                        } catch (error) {
                            logger.warn?.(`[${serviceName}] Failed to inspect Raven title details for recommendation recovery "${option.title}": ${error.message}`)
                        }
                    }

                    return {
                        searchId: normalizedPayload.searchId,
                        optionIndex: option.optionIndex,
                        title: option.title,
                        href: option.href,
                        sourceAdultContent,
                    }
                }
            }

            if (typeof ravenClient?.getTitleDetails !== 'function') {
                continue
            }

            for (const option of normalizedPayload.options) {
                if (!option?.href) {
                    continue
                }

                try {
                    const details = await ravenClient.getTitleDetails(option.href)
                    const associatedNames = normalizeDistinctStrings(details?.associatedNames)
                    const associatedNameKeys = new Set(
                        associatedNames
                            .map((value) => normalizeRecommendationTitleKey(value))
                            .filter(Boolean),
                    )
                    const matchesAlias = [...associatedNameKeys].some((key) => candidateKeys.has(key))
                    if (!matchesAlias) {
                        continue
                    }

                    return {
                        searchId: normalizedPayload.searchId,
                        optionIndex: option.optionIndex,
                        title: option.title,
                        href: option.href,
                        sourceAdultContent: normalizeRecommendationSourceAdultContent(details?.adultContent),
                    }
                } catch (error) {
                    logger.warn?.(`[${serviceName}] Failed to inspect Raven aliases for recommendation recovery "${option.title}": ${error.message}`)
                }
            }
        }

        return null
    }
    const createSavedForLaterTimelineEvent = () =>
        createRecommendationTimelineEvent({
            type: 'comment',
            actor: {
                role: 'system',
                username: 'Moon',
            },
            body: SAVED_FOR_LATER_MESSAGE,
        })

    app.use('/api/raven', requireSessionIfSetupCompleted)
    app.use('/api/recommendations', requireSessionIfSetupCompleted)
    app.use('/api/myrecommendations', requireSessionIfSetupCompleted)
    app.use('/api/mysubscriptions', requireSessionIfSetupCompleted)

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

    app.get('/api/mysubscriptions', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        if (!hasMoonPermission(session, 'mySubscriptions')) {
            res.status(403).json({error: 'My subscriptions permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany) {
            res.status(503).json({error: 'Vault subscription storage is not configured.'})
            return
        }

        const limit = parseRecommendationLimit(req.query?.limit)

        try {
            const documents = await loadSubscriptionDocuments()
            const subscriptions = sortSubscriptions(
                documents
                    .filter((entry) => subscriptionBelongsToSession(entry, session))
                    .map((entry) => normalizeSubscriptionDoc(entry)),
            )

            res.json({
                collection: SUBSCRIPTIONS_COLLECTION,
                limit,
                total: subscriptions.length,
                subscriptions: subscriptions.slice(0, limit),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to load my subscriptions: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve subscription records.'})
        }
    })

    app.delete('/api/mysubscriptions/:id', async (req, res) => {
        const session = req.user
        if (!session) {
            res.status(401).json({error: 'Unauthorized.'})
            return
        }

        if (!hasMoonPermission(session, 'mySubscriptions')) {
            res.status(403).json({error: 'My subscriptions permission is required.'})
            return
        }

        if (!vaultClient?.mongo?.findMany || !vaultClient?.mongo?.update) {
            res.status(503).json({error: 'Vault subscription storage is not configured.'})
            return
        }

        const id = normalizeString(req.params?.id)
        if (!id) {
            res.status(400).json({error: 'Subscription id is required.'})
            return
        }

        try {
            const documents = await loadSubscriptionDocuments()
            const target = findSubscriptionDocumentById(documents, id)
            if (!target) {
                res.status(404).json({error: 'Subscription not found.'})
                return
            }

            if (!subscriptionBelongsToSession(target, session)) {
                res.status(404).json({error: 'Subscription not found.'})
                return
            }

            if (!isActiveSubscriptionStatus(target?.status)) {
                res.json({
                    ok: true,
                    id,
                    subscription: normalizeSubscriptionDoc(target),
                })
                return
            }

            const unsubscribedAt = new Date().toISOString()
            const updatePersisted = await persistSubscriptionDocumentUpdate(target, {
                $set: {
                    status: 'inactive',
                    unsubscribedAt,
                },
            })
            if (!updatePersisted) {
                res.status(502).json({error: 'Vault did not persist subscription update.'})
                return
            }

            const refreshedDocuments = await loadSubscriptionDocuments()
            const refreshedTarget = findSubscriptionDocumentById(refreshedDocuments, id)
            if (!refreshedTarget) {
                res.status(502).json({error: 'Vault did not persist subscription update.'})
                return
            }

            res.json({
                ok: true,
                id,
                subscription: normalizeSubscriptionDoc(refreshedTarget),
            })
        } catch (error) {
            logger.error(`[${serviceName}] Failed to unsubscribe subscription ${id}: ${error.message}`)
            res.status(502).json({error: 'Unable to update subscription.'})
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

            const requestBody =
                req.body && typeof req.body === 'object' && !Array.isArray(req.body)
                    ? req.body
                    : {}
            const approvedAt = new Date().toISOString()
            const approvedBy = recommendationActorFromSession(session, 'admin')
            const metadataQuery = normalizeString(requestBody?.metadataQuery) || resolveRecommendationMetadataQuery(recommendation)
            const metadataSelectionInput =
                requestBody?.metadataSelection && typeof requestBody.metadataSelection === 'object'
                    ? requestBody.metadataSelection
                    : null
            const requestedMetadataSelection = metadataSelectionInput
                ? normalizeRecommendationMetadataSelection({
                    ...metadataSelectionInput,
                    status: 'pending',
                    query: normalizeString(metadataSelectionInput?.query) || metadataQuery,
                    selectedAt: approvedAt,
                    selectedBy: {
                        username: approvedBy.username,
                        discordId: approvedBy.discordId,
                    },
                })
                : null
            if (metadataSelectionInput && (!requestedMetadataSelection || !recommendationMetadataHasIdentifiers(requestedMetadataSelection))) {
                res.status(400).json({error: 'A valid metadata selection is required when approving with metadata.'})
                return
            }

            const storedSearchId = normalizeString(recommendation?.searchId)
            const storedSelectedOptionIndexRaw = target?.selectedOptionIndex ?? recommendation?.selectedOptionIndex
            const storedSelectedOptionIndex =
                typeof storedSelectedOptionIndexRaw === 'number'
                    ? storedSelectedOptionIndexRaw
                    : typeof storedSelectedOptionIndexRaw === 'string' && storedSelectedOptionIndexRaw.trim()
                        ? Number(storedSelectedOptionIndexRaw)
                        : Number.NaN
            if ((!storedSearchId || !Number.isFinite(storedSelectedOptionIndex)) && !requestedMetadataSelection) {
                res.status(409).json({error: 'Recommendation needs a saved metadata match before Noona can search alternate Raven titles.'})
                return
            }

            let resolvedQueueTarget = null
            let queueResult = null
            let usedRecoveredQueueTarget = false
            let preseededTitleUuid = null
            const preseedRecommendationVolumeMap = async ({title, sourceUrl} = {}) => {
                if (!requestedMetadataSelection?.provider || !requestedMetadataSelection?.providerSeriesId) {
                    return
                }

                if (!ravenClient?.createTitle || !portalClient?.applyRavenTitleVolumeMap) {
                    return
                }

                const normalizedTitle = normalizeString(title)
                if (!normalizedTitle) {
                    return
                }

                try {
                    const ravenTitle = await ravenClient.createTitle({
                        title: normalizedTitle,
                        sourceUrl: normalizeString(sourceUrl) || null,
                    })
                    const titleUuid = normalizeString(ravenTitle?.uuid)
                    if (!titleUuid) {
                        return
                    }

                    preseededTitleUuid = titleUuid
                    await portalClient.applyRavenTitleVolumeMap({
                        titleUuid,
                        provider: requestedMetadataSelection.provider,
                        providerSeriesId: requestedMetadataSelection.providerSeriesId,
                        autoRename: false,
                    })
                } catch (error) {
                    logger.warn?.(`[${serviceName}] Failed to pre-seed Raven volume mapping for recommendation ${id}: ${error.message}`)
                }
            }
            const tryRecoveredQueueTarget = async () => {
                if (!requestedMetadataSelection) {
                    return false
                }

                resolvedQueueTarget = await resolveRavenRecommendationQueueTarget({
                    recommendation,
                    metadataSelection: requestedMetadataSelection,
                    metadataQuery,
                })
                if (!resolvedQueueTarget?.searchId || !Number.isFinite(resolvedQueueTarget?.optionIndex)) {
                    return false
                }

                usedRecoveredQueueTarget = true
                await preseedRecommendationVolumeMap({
                    title: resolvedQueueTarget?.title || recommendation?.title || requestedMetadataSelection?.title,
                    sourceUrl: resolvedQueueTarget?.href || recommendation?.href || null,
                })
                queueResult = await ravenClient.queueDownload({
                    searchId: resolvedQueueTarget.searchId,
                    optionIndex: resolvedQueueTarget.optionIndex,
                })
                return true
            }

            if (storedSearchId && Number.isFinite(storedSelectedOptionIndex)) {
                try {
                    await preseedRecommendationVolumeMap({
                        title: recommendation?.title || requestedMetadataSelection?.title,
                        sourceUrl: recommendation?.href || null,
                    })
                    queueResult = await ravenClient.queueDownload({
                        searchId: storedSearchId,
                        optionIndex: storedSelectedOptionIndex,
                    })
                } catch (error) {
                    if (!requestedMetadataSelection) {
                        logger.error(`[${serviceName}] Failed to queue approved recommendation ${id}: ${error.message}`)
                        res.status(502).json({error: 'Unable to queue Raven download for this recommendation.'})
                        return
                    }

                    logger.warn?.(`[${serviceName}] Failed to queue stored Raven target for recommendation ${id}; retrying through metadata recovery: ${error.message}`)
                }
            }

            if (!queueResult) {
                try {
                    const recovered = await tryRecoveredQueueTarget()
                    if (!recovered) {
                        const savedMetadataSelection = requestedMetadataSelection
                            ? normalizeRecommendationMetadataSelection({
                                ...requestedMetadataSelection,
                                lastAttemptedAt: approvedAt,
                                lastError: SAVED_FOR_LATER_MESSAGE,
                            })
                            : null
                        const metadataTimelineEvent = createRecommendationMetadataSelectionTimelineEvent(savedMetadataSelection)
                        const savedForLaterTimelineEvent = createSavedForLaterTimelineEvent()
                        const nextTimeline = [
                            ...appendRecommendationTimelineEvent(target, savedForLaterTimelineEvent),
                            ...(metadataTimelineEvent ? [metadataTimelineEvent] : []),
                        ]

                        const updatePersisted = await persistRecommendationDocumentUpdate(target, {
                            $set: {
                                metadataSelection: savedMetadataSelection,
                                timeline: nextTimeline,
                            },
                        })
                        if (!updatePersisted) {
                            res.status(502).json({error: 'Vault did not persist the saved recommendation state.'})
                            return
                        }

                        const refreshedDocuments = await loadRecommendationDocuments()
                        const refreshedTarget = findRecommendationDocumentById(refreshedDocuments, id)
                        if (!refreshedTarget) {
                            res.status(502).json({error: 'Vault did not persist the saved recommendation state.'})
                            return
                        }

                        res.status(202).json({
                            ok: true,
                            id,
                            savedForLater: true,
                            message: SAVED_FOR_LATER_MESSAGE,
                            metadataSelection: savedMetadataSelection,
                            recommendation: normalizeRecommendationDoc(refreshedTarget),
                        })
                        return
                    }
                } catch (error) {
                    logger.error(`[${serviceName}] Failed to recover Raven queue details for recommendation ${id}: ${error.message}`)
                    res.status(502).json({error: 'Unable to queue Raven download for this recommendation.'})
                    return
                }
            }

            const metadataSelection = requestedMetadataSelection
                ? normalizeRecommendationMetadataSelection({
                    ...requestedMetadataSelection,
                    queuedAt: approvedAt,
                    titleUuid: resolveQueuedRecommendationTitleUuid(queueResult) || preseededTitleUuid,
                    lastAttemptedAt: null,
                    lastError: null,
                })
                : null

            const approvedTimelineEvent = createRecommendationTimelineEvent({
                type: 'approved',
                actor: approvedBy,
                createdAt: approvedAt,
            })
            const metadataTimelineEvent = createRecommendationMetadataSelectionTimelineEvent(metadataSelection)
            const nextTimeline = [
                ...appendRecommendationTimelineEvent(target, approvedTimelineEvent),
                ...(metadataTimelineEvent ? [metadataTimelineEvent] : []),
            ]
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
                    searchId: usedRecoveredQueueTarget
                        ? resolvedQueueTarget?.searchId ?? null
                        : storedSearchId,
                    selectedOptionIndex: usedRecoveredQueueTarget
                        ? resolvedQueueTarget?.optionIndex ?? null
                        : storedSelectedOptionIndex,
                    title: usedRecoveredQueueTarget
                        ? resolvedQueueTarget?.title ?? recommendation?.title ?? null
                        : recommendation?.title ?? null,
                    href: usedRecoveredQueueTarget
                        ? resolvedQueueTarget?.href ?? recommendation?.href ?? null
                        : recommendation?.href ?? null,
                    sourceAdultContent: usedRecoveredQueueTarget
                        ? (
                            resolvedQueueTarget?.sourceAdultContent != null
                                ? resolvedQueueTarget.sourceAdultContent
                                : recommendation?.sourceAdultContent ?? null
                        )
                        : recommendation?.sourceAdultContent ?? null,
                    timeline: nextTimeline,
                    metadataSelection,
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
                metadataSelection,
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

    app.post('/api/raven/library/imports/check', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'library_management', 'Library management permission is required.')) {
            return
        }

        try {
            const result = await ravenClient.checkAvailableLibraryImports()
            res.status(202).json(result ?? {})
        } catch (error) {
            logger.error(`[${serviceName}] Failed to check Raven library imports: ${error.message}`)
            res.status(502).json({error: 'Unable to check Raven library imports.'})
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

    app.get('/api/raven/title-details', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'library_management', 'Library management permission is required.')) {
            return
        }
        const sourceUrl = typeof req.query?.url === 'string' ? req.query.url.trim() : ''

        if (!sourceUrl) {
            res.status(400).json({error: 'url is required.'})
            return
        }

        try {
            const details = await ravenClient.getTitleDetails(sourceUrl)
            res.json(details ?? {sourceUrl})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to load Raven title details for ${sourceUrl}: ${error.message}`)
            res.status(502).json({error: 'Unable to retrieve Raven title details.'})
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
            const queueResponse = await ravenClient.queueDownloadDetailed({searchId, optionIndex})
            res.status(queueResponse?.status ?? 202).json(queueResponse?.payload ?? {})
        } catch (error) {
            logger.error(
                `[${serviceName}] ❌ Failed to queue Raven download for ${searchId}: ${error.message}`,
            )
            res.status(502).json({error: 'Unable to queue Raven download.'})
        }
    })

    app.post('/api/raven/downloads/pause', async (req, res) => {
        if (!ensureMoonPermission(req, res, 'download_management', 'Download management permission is required.')) {
            return
        }
        try {
            const result = await ravenClient.pauseDownloads()
            res.status(202).json(result ?? {})
        } catch (error) {
            logger.error(`[${serviceName}] ⚠️ Failed to pause Raven downloads: ${error.message}`)
            res.status(502).json({error: 'Unable to pause Raven downloads.'})
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
