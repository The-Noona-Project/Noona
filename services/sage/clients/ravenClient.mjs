// services/sage/clients/ravenClient.mjs

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
    const text = await response.text().catch(() => '')
    if (!text) {
        return contentType.includes('application/json') ? {} : ''
    }

    const trimmed = text.trim()
    const shouldParseJson =
        contentType.includes('application/json') ||
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))

    if (!shouldParseJson) {
        return text
    }

    try {
        return JSON.parse(trimmed)
    } catch (_) {
        return text
    }
}

const extractQueueMessage = (payload, fallback) => {
    if (payload && typeof payload === 'object' && typeof payload.message === 'string' && payload.message.trim()) {
        return payload.message.trim()
    }
    return fallback
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

    const fetchFromRaven = async (path, options, {acceptStatuses = []} = {}) => {
        const candidates = await buildCandidates()
        const errors = []

        for (const candidate of candidates) {
            try {
                const requestUrl = new URL(path, candidate)
                const response = await fetchImpl(requestUrl.toString(), options)

                const accept = new Set([200, 201, 202, 204, ...acceptStatuses])
                if (!accept.has(response.status)) {
                    errors.push(`${candidate} (Raven responded with status ${response.status})`)
                    continue
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

        async checkLibraryForNewChapters() {
            const response = await fetchFromRaven('/v1/library/checkForNew', {
                method: 'POST',
                headers: {Accept: 'application/json'},
            })
            return await parseResponsePayload(response)
        },

        async checkAvailableLibraryImports() {
            const response = await fetchFromRaven('/v1/library/imports/check', {
                method: 'POST',
                headers: {Accept: 'application/json'},
            })
            return await parseResponsePayload(response)
        },

        async getTitle(uuid) {
            const normalized = typeof uuid === 'string' ? uuid.trim() : ''
            if (!normalized) {
                throw new Error('uuid is required.')
            }

            const encoded = encodeURIComponent(normalized)
            const response = await fetchFromRaven(`/v1/library/title/${encoded}`, undefined, {acceptStatuses: [404]})
            if (response.status === 404) {
                return null
            }

            return await parseResponsePayload(response)
        },

        async checkTitleForNewChapters(uuid) {
            const normalized = typeof uuid === 'string' ? uuid.trim() : ''
            if (!normalized) {
                throw new Error('uuid is required.')
            }

            const encoded = encodeURIComponent(normalized)
            const response = await fetchFromRaven(`/v1/library/title/${encoded}/checkForNew`, {
                method: 'POST',
                headers: {Accept: 'application/json'},
            }, {acceptStatuses: [404]})

            if (response.status === 404) {
                return null
            }

            return await parseResponsePayload(response)
        },

        async createTitle({title, sourceUrl} = {}) {
            const normalizedTitle = typeof title === 'string' ? title.trim() : ''
            if (!normalizedTitle) {
                throw new Error('title is required.')
            }

            const response = await fetchFromRaven('/v1/library/title', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: JSON.stringify({title: normalizedTitle, sourceUrl}),
            })

            return await parseResponsePayload(response)
        },

        async updateTitle(uuid, {title, sourceUrl} = {}) {
            const normalized = typeof uuid === 'string' ? uuid.trim() : ''
            if (!normalized) {
                throw new Error('uuid is required.')
            }

            const payload = {}
            if (typeof title === 'string' && title.trim()) {
                payload.title = title.trim()
            }
            if (typeof sourceUrl === 'string' && sourceUrl.trim()) {
                payload.sourceUrl = sourceUrl.trim()
            }

            if (!Object.keys(payload).length) {
                throw new Error('At least one of title/sourceUrl must be provided.')
            }

            const encoded = encodeURIComponent(normalized)
            const response = await fetchFromRaven(`/v1/library/title/${encoded}`, {
                method: 'PATCH',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: JSON.stringify(payload),
            }, {acceptStatuses: [404]})

            if (response.status === 404) {
                return null
            }

            return await parseResponsePayload(response)
        },

        async deleteTitle(uuid) {
            const normalized = typeof uuid === 'string' ? uuid.trim() : ''
            if (!normalized) {
                throw new Error('uuid is required.')
            }

            const encoded = encodeURIComponent(normalized)
            const response = await fetchFromRaven(`/v1/library/title/${encoded}`, {
                method: 'DELETE',
                headers: {Accept: 'application/json'},
            }, {acceptStatuses: [404]})

            if (response.status === 404) {
                return null
            }

            return await parseResponsePayload(response)
        },

        async listTitleFiles(uuid, {limit} = {}) {
            const normalized = typeof uuid === 'string' ? uuid.trim() : ''
            if (!normalized) {
                throw new Error('uuid is required.')
            }

            const encoded = encodeURIComponent(normalized)
            const normalizedLimit =
                typeof limit === 'number'
                    ? limit
                    : typeof limit === 'string' && limit.trim()
                        ? Number(limit)
                        : NaN
            const suffix = Number.isFinite(normalizedLimit)
                ? `?limit=${encodeURIComponent(String(normalizedLimit))}`
                : ''

            const response = await fetchFromRaven(`/v1/library/title/${encoded}/files${suffix}`, undefined, {
                acceptStatuses: [404],
            })

            if (response.status === 404) {
                return null
            }

            return await parseResponsePayload(response)
        },

        async deleteTitleFiles(uuid, names = []) {
            const normalized = typeof uuid === 'string' ? uuid.trim() : ''
            if (!normalized) {
                throw new Error('uuid is required.')
            }

            const encoded = encodeURIComponent(normalized)
            const payload = Array.isArray(names)
                ? names
                    .filter((entry) => typeof entry === 'string')
                    .map((entry) => entry.trim())
                    .filter(Boolean)
                : []

            if (payload.length === 0) {
                throw new Error('names must include at least one file name.')
            }

            const response = await fetchFromRaven(`/v1/library/title/${encoded}/files`, {
                method: 'DELETE',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: JSON.stringify({names: payload}),
            }, {acceptStatuses: [404]})

            if (response.status === 404) {
                return null
            }

            return await parseResponsePayload(response)
        },

        async searchTitle(query) {
            if (!query || typeof query !== 'string') {
                throw new Error('Search query must be a non-empty string.')
            }

            const response = await fetchFromRaven('/v1/download/search', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: JSON.stringify({query}),
            })
            return await parseResponsePayload(response)
        },

        async getTitleDetails(sourceUrl) {
            const normalized = typeof sourceUrl === 'string' ? sourceUrl.trim() : ''
            if (!normalized) {
                throw new Error('sourceUrl is required.')
            }

            const encodedSourceUrl = encodeURIComponent(normalized)
            const response = await fetchFromRaven(`/v1/download/title-details?url=${encodedSourceUrl}`)
            return await parseResponsePayload(response)
        },

        async queueDownloadDetailed({searchId, optionIndex} = {}) {
            if (!searchId || typeof searchId !== 'string') {
                throw new Error('searchId must be provided.')
            }

            const normalizedIndex = Number(optionIndex)
            if (!Number.isFinite(normalizedIndex)) {
                throw new Error('optionIndex must be a number.')
            }

            const response = await fetchFromRaven(
                '/v1/download/select',
                {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                    body: JSON.stringify({searchId, optionIndex: normalizedIndex}),
                },
                {acceptStatuses: [400, 409, 410]},
            )
            return {
                status: response.status,
                payload: await parseResponsePayload(response),
            }
        },

        async queueDownload({searchId, optionIndex} = {}) {
            const result = await this.queueDownloadDetailed({searchId, optionIndex})
            if (result.status === 202) {
                return result.payload
            }

            throw new Error(extractQueueMessage(result.payload, `Queue failed (HTTP ${result.status}).`))
        },

        async getDownloadStatus() {
            const response = await fetchFromRaven('/v1/download/status')
            return await parseResponsePayload(response)
        },

        async getDownloadHistory() {
            const response = await fetchFromRaven('/v1/download/status/history')
            return await parseResponsePayload(response)
        },

        async getDownloadSummary() {
            const response = await fetchFromRaven('/v1/download/status/summary')
            return await parseResponsePayload(response)
        },

        async pauseDownloads() {
            const response = await fetchFromRaven('/v1/download/pause', {
                method: 'POST',
                headers: {Accept: 'application/json'},
            })
            return await parseResponsePayload(response)
        },
        async getVpnStatus() {
            const response = await fetchFromRaven('/v1/vpn/status')
            return await parseResponsePayload(response)
        },
        async getVpnRegions() {
            const response = await fetchFromRaven('/v1/vpn/regions')
            const payload = await parseResponsePayload(response)
            if (payload && typeof payload === 'object' && Array.isArray(payload.regions)) {
                return payload.regions
            }
            return []
        },
        async rotateVpnNow(triggeredBy = 'manual') {
            const response = await fetchFromRaven('/v1/vpn/rotate', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: JSON.stringify({triggeredBy}),
            })
            return await parseResponsePayload(response)
        },
        async testVpnLogin({
                               triggeredBy = 'manual',
                               region = '',
                               piaUsername = '',
                               piaPassword = '',
                           } = {}) {
            const response = await fetchFromRaven('/v1/vpn/test-login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json', Accept: 'application/json'},
                body: JSON.stringify({
                    triggeredBy,
                    region,
                    piaUsername,
                    piaPassword,
                }),
            })
            return await parseResponsePayload(response)
        },
        async setDebug(enabled) {
            const response = await fetchFromRaven('/v1/debug', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({enabled: !!enabled}),
            })
            return await parseResponsePayload(response)
        },
    }
}

export default createRavenClient
