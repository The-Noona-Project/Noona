// services/sage/shared/ravenClient.mjs

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
    } catch (error) {
        return null
    }
}

const resolveDefaultRavenUrls = (env = process.env) => {
    const candidates = [
        env?.RAVEN_BASE_URL,
        env?.RAVEN_INTERNAL_BASE_URL,
        env?.RAVEN_DOCKER_URL,
    ]

    const hostCandidates = [
        env?.RAVEN_HOST,
        env?.RAVEN_SERVICE_HOST,
    ]

    for (const host of hostCandidates) {
        if (typeof host === 'string' && host.trim()) {
            const port = env?.RAVEN_PORT || '8080'
            const normalizedHost = host.trim()
            candidates.push(`${normalizedHost}:${port}`)
        }
    }

    candidates.push(
        'http://noona-raven:8080',
        'http://raven:8080',
        'http://host.docker.internal:8080',
        'http://127.0.0.1:8080',
        'http://localhost:8080',
    )

    const normalized = candidates
        .map(normalizeUrl)
        .filter(Boolean)

    return Array.from(new Set(normalized))
}

const resolveServiceUrls = (services = []) => {
    const urls = []

    for (const service of services) {
        if (!service || service.name !== 'noona-raven') {
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

    if (contentType.includes('application/json')) {
        return await response.json()
    }

    try {
        return await response.json()
    } catch (_) {
        return await response.text()
    }
}

export const createRavenClient = ({
    serviceName = process.env.SERVICE_NAME || 'noona-sage',
    logger = {},
    setupClient,
    fetchImpl = fetch,
    baseUrl,
    baseUrls = [],
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
                const services = await setupClient.listServices({ includeInstalled: true })
                discovered = resolveServiceUrls(Array.isArray(services) ? services : [])
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logger.warn?.(
                    `[${serviceName}] ⚠️ Unable to resolve Raven host from Warden: ${message}`,
                )
            }
        }

        const combined = [
            normalizeUrl(baseUrl),
            ...baseUrls.map(normalizeUrl),
            ...discovered,
            ...resolveDefaultRavenUrls(env),
        ].filter(Boolean)

        const deduped = Array.from(new Set(combined))

        cachedCandidates = deduped.length > 0 ? deduped : ['http://localhost:8080']
        return cachedCandidates
    }

    const promoteCandidate = (preferred, candidates) => {
        cachedCandidates = [preferred, ...candidates.filter((entry) => entry !== preferred)]
    }

    const fetchFromRaven = async (path, options) => {
        const candidates = await buildCandidates()
        const errors = []

        for (const candidate of candidates) {
            try {
                const requestUrl = new URL(path, candidate)
                const response = await fetchImpl(requestUrl.toString(), options)

                if (!response.ok) {
                    throw new Error(`Raven responded with status ${response.status}`)
                }

                promoteCandidate(candidate, candidates)
                logger.debug?.(
                    `[${serviceName}] 🪶 Raven request to ${requestUrl.toString()} succeeded via ${candidate}`,
                )
                return response
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                errors.push(`${candidate} (${message})`)
            }
        }

        cachedCandidates = null
        throw new Error(`All Raven endpoints failed: ${errors.join(' | ')}`)
    }

    return {
        async getLibrary() {
            const response = await fetchFromRaven('/v1/library/getall')
            return await parseResponsePayload(response)
        },

        async searchTitle(query) {
            if (!query || typeof query !== 'string') {
                throw new Error('Search query must be a non-empty string.')
            }

            const encodedQuery = encodeURIComponent(query)
            const response = await fetchFromRaven(`/v1/download/search/${encodedQuery}`)
            return await parseResponsePayload(response)
        },

        async queueDownload({ searchId, optionIndex } = {}) {
            if (!searchId || typeof searchId !== 'string') {
                throw new Error('searchId must be provided.')
            }

            const normalizedIndex = Number(optionIndex)
            if (!Number.isFinite(normalizedIndex)) {
                throw new Error('optionIndex must be a number.')
            }

            const encodedSearchId = encodeURIComponent(searchId)
            const response = await fetchFromRaven(
                `/v1/download/select/${encodedSearchId}/${normalizedIndex}`,
            )
            return await parseResponsePayload(response)
        },

        async getDownloadStatus() {
            const response = await fetchFromRaven('/v1/download/status')
            return await parseResponsePayload(response)
        },
    }
}

export default createRavenClient
