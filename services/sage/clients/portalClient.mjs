const normalizeUrl = (candidate) => {
    if (!candidate || typeof candidate !== 'string') {
        return null
    }

    const trimmed = candidate.trim()
    if (!trimmed) {
        return null
    }

    const ensured = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`

    try {
        const url = new URL(ensured)
        return `${url.protocol}//${url.host}`
    } catch {
        return null
    }
}

const resolveDefaultPortalUrls = (env = process.env) => {
    const candidates = [
        env?.PORTAL_BASE_URL,
        env?.PORTAL_INTERNAL_BASE_URL,
        env?.PORTAL_DOCKER_URL,
    ]

    const hostCandidates = [
        env?.PORTAL_HOST,
        env?.PORTAL_SERVICE_HOST,
    ]

    for (const host of hostCandidates) {
        if (typeof host === 'string' && host.trim()) {
            const port = env?.PORTAL_PORT || '3003'
            candidates.push(`${host.trim()}:${port}`)
        }
    }

    candidates.push(
        'http://noona-portal:3003',
        'http://portal:3003',
        'http://host.docker.internal:3003',
        'http://127.0.0.1:3003',
        'http://localhost:3003',
    )

    const normalized = candidates
        .map(normalizeUrl)
        .filter(Boolean)

    return Array.from(new Set(normalized))
}

const resolveServiceUrls = (services = []) => {
    const urls = []
    for (const service of services) {
        if (!service) {
            continue
        }

        const serviceName = typeof service?.name === 'string' ? service.name.trim().toLowerCase() : ''
        if (serviceName !== 'noona-portal' && serviceName !== 'portal') {
            continue
        }

        const hostServiceUrl = normalizeUrl(service.hostServiceUrl)
        if (hostServiceUrl) {
            urls.push(hostServiceUrl)
        }

        const healthUrl = normalizeUrl(service.health)
        if (healthUrl) {
            urls.push(healthUrl)
        }
    }

    return urls
}

const parseResponsePayload = async (response) => {
    if (response.status === 204) {
        return null
    }

    const contentType = response.headers?.get?.('content-type') ?? ''
    const text = await response.text().catch(() => '')
    if (!text) {
        return contentType.includes('application/json') ? {} : ''
    }

    const trimmed = text.trim()
    const shouldParseJson =
        contentType.includes('application/json')
        || (trimmed.startsWith('{') && trimmed.endsWith('}'))
        || (trimmed.startsWith('[') && trimmed.endsWith(']'))
        || (trimmed.startsWith('"') && trimmed.endsWith('"'))

    if (!shouldParseJson) {
        return text
    }

    try {
        return JSON.parse(trimmed)
    } catch {
        return text
    }
}

const buildAbortController = (timeoutMs = 8000) => {
    const normalizedTimeout = Number(timeoutMs)
    if (!Number.isFinite(normalizedTimeout) || normalizedTimeout <= 0) {
        return {
            controller: null, cleanup: () => {
            }
        }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), normalizedTimeout)
    return {
        controller,
        cleanup: () => clearTimeout(timer),
    }
}

export const createPortalClient = ({
                                       serviceName = process.env.SERVICE_NAME || 'noona-sage',
                                       logger = {},
                                       setupClient,
                                       fetchImpl = fetch,
                                       baseUrl,
                                       baseUrls = [],
                                       timeoutMs = 8000,
                                       env = process.env,
                                   } = {}) => {
    let cachedCandidates = null

    const buildCandidates = async () => {
        if (cachedCandidates) {
            return cachedCandidates
        }

        let discovered = []
        if (setupClient?.listServices) {
            try {
                const services = await setupClient.listServices({includeInstalled: true})
                discovered = resolveServiceUrls(Array.isArray(services) ? services : [])
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logger.warn?.(`[${serviceName}] ⚠️ Unable to resolve Portal host from Warden: ${message}`)
            }
        }

        const combined = [
            normalizeUrl(baseUrl),
            ...baseUrls.map(normalizeUrl),
            ...discovered,
            ...resolveDefaultPortalUrls(env),
        ].filter(Boolean)
        const deduped = Array.from(new Set(combined))
        cachedCandidates = deduped.length > 0 ? deduped : ['http://localhost:3003']
        return cachedCandidates
    }

    const promoteCandidate = (preferred, candidates) => {
        cachedCandidates = [preferred, ...candidates.filter((entry) => entry !== preferred)]
    }

    const requestPortal = async (path, options = {}, {acceptStatuses = []} = {}) => {
        const candidates = await buildCandidates()
        const errors = []

        for (const candidate of candidates) {
            const {controller, cleanup} = buildAbortController(timeoutMs)
            try {
                const requestUrl = new URL(path, candidate)
                const response = await fetchImpl(requestUrl.toString(), {
                    ...options,
                    signal: controller?.signal,
                })

                const accept = new Set([200, 201, 202, 204, ...acceptStatuses])
                if (!accept.has(response.status)) {
                    const payload = await parseResponsePayload(response).catch(() => null)
                    const message = typeof payload?.error === 'string' && payload.error.trim()
                        ? payload.error.trim()
                        : `Portal responded with status ${response.status}`
                    errors.push(`${candidate} (${message})`)
                    continue
                }

                promoteCandidate(candidate, candidates)
                logger.debug?.(
                    `[${serviceName}] 🌙 Portal request to ${requestUrl.toString()} succeeded via ${candidate}`,
                )
                return response
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                errors.push(`${candidate} (${message})`)
            } finally {
                cleanup()
            }
        }

        cachedCandidates = null
        throw new Error(`All Portal endpoints failed: ${errors.join(' | ')}`)
    }

    return {
        async searchKavitaTitles(query) {
            const normalizedQuery = typeof query === 'string' ? query.trim() : ''
            if (!normalizedQuery) {
                throw new Error('query is required.')
            }

            const suffix = `?query=${encodeURIComponent(normalizedQuery)}`
            const response = await requestPortal(`/api/portal/kavita/title-search${suffix}`)
            return await parseResponsePayload(response)
        },

        async fetchTitleMetadataMatches({seriesId, query} = {}) {
            const parsedSeriesId = Number(seriesId)
            if (!Number.isInteger(parsedSeriesId) || parsedSeriesId < 1) {
                throw new Error('seriesId is required.')
            }

            const normalizedQuery = typeof query === 'string' ? query.trim() : ''
            if (!normalizedQuery) {
                throw new Error('query is required.')
            }

            const response = await requestPortal('/api/portal/kavita/title-match', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: JSON.stringify({
                    seriesId: parsedSeriesId,
                    query: normalizedQuery,
                }),
            })
            return await parseResponsePayload(response)
        },

        async applyTitleMetadataMatch(payload = {}) {
            const parsedSeriesId = Number(payload?.seriesId)
            if (!Number.isInteger(parsedSeriesId) || parsedSeriesId < 1) {
                throw new Error('seriesId is required.')
            }

            const response = await requestPortal('/api/portal/kavita/title-match/apply', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: JSON.stringify(payload),
            })
            return await parseResponsePayload(response)
        },

        async applyRavenTitleVolumeMap(payload = {}) {
            const titleUuid = typeof payload?.titleUuid === 'string' ? payload.titleUuid.trim() : ''
            if (!titleUuid) {
                throw new Error('titleUuid is required.')
            }

            const provider = typeof payload?.provider === 'string' ? payload.provider.trim() : ''
            if (!provider) {
                throw new Error('provider is required.')
            }

            const providerSeriesId = typeof payload?.providerSeriesId === 'string' ? payload.providerSeriesId.trim() : ''
            if (!providerSeriesId) {
                throw new Error('providerSeriesId is required.')
            }

            const response = await requestPortal('/api/portal/raven/title-volume-map', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: JSON.stringify(payload),
            })
            return await parseResponsePayload(response)
        },
    }
}

export default createPortalClient
