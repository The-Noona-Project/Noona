// services/sage/clients/vaultPacketClient.mjs

import {resolveDefaultVaultUrls} from '../wizard/wizardStateClient.mjs'
import {ensureTrustedCaForUrl} from '../../../utilities/etc/tlsTrust.mjs'

const normalizeUrl = (candidate) => {
    if (!candidate || typeof candidate !== 'string') {
        return null
    }

    const trimmed = candidate.trim()
    if (!trimmed) {
        return null
    }

    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed
    }

    return `https://${trimmed}`
}

const parseJson = async (response) => {
    const text = await response.text().catch(() => '')
    if (!text) {
        return {}
    }

    try {
        return JSON.parse(text)
    } catch {
        return {}
    }
}

const looksLikeNotFound = (message) =>
    typeof message === 'string' && /no document found|key not found/i.test(message)

const createVaultClientError = (message, status, payload = null) => {
    const error = new Error(message)
    error.name = 'VaultClientError'
    error.status = Number.isFinite(Number(status)) ? Number(status) : null
    error.payload = payload
    return error
}

const isVaultClientErrorStatus = (error, ...statuses) => {
    const status = Number(error?.status)
    if (!Number.isFinite(status)) {
        return false
    }

    if (statuses.length === 0) {
        return true
    }

    return statuses.some((entry) => Number(entry) === status)
}

export const createVaultPacketClient = ({
                                            baseUrl,
                                            baseUrls = [],
                                            token,
                                            fetchImpl = fetch,
                                            env = process.env,
                                            logger = {},
                                            serviceName = env?.SERVICE_NAME || 'noona-sage',
                                            timeoutMs = 10000,
                                            trustVaultUrl = ensureTrustedCaForUrl,
                                        } = {}) => {
    if (!token || typeof token !== 'string' || !token.trim()) {
        throw new Error('Vault API token is required to use the packet client.')
    }

    const defaults = resolveDefaultVaultUrls(env)
    const deduped = Array.from(
        new Set(
            [
                normalizeUrl(baseUrl),
                ...baseUrls.map(normalizeUrl),
                ...defaults,
            ].filter(Boolean),
        ),
    )

    if (deduped.length === 0) {
        throw new Error('Unable to resolve Vault base URL for packet client.')
    }

    let preferredBaseUrl = deduped[0]

    const requestJson = async ({path, method = 'GET', body = undefined, headers = {}}) => {
        const endpointPath = typeof path === 'string' && path.trim() ? path.trim() : '/'
        const errors = []
        let firstClientError = null
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        try {
            const candidates = preferredBaseUrl
                ? [preferredBaseUrl, ...deduped.filter((url) => url !== preferredBaseUrl)]
                : deduped

            for (const candidate of candidates) {
                try {
                    const requestUrl = new URL(endpointPath, candidate).toString()
                    trustVaultUrl(requestUrl, {env})
                    const response = await fetchImpl(requestUrl, {
                        method,
                        headers: {
                            Accept: 'application/json',
                            Authorization: `Bearer ${token}`,
                            ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
                            ...(headers ?? {}),
                        },
                        ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
                        signal: controller.signal,
                    })

                    const payload = await parseJson(response)
                    if (!response.ok) {
                        const error = createVaultClientError(
                            payload?.error || `Vault responded with status ${response.status}`,
                            response.status,
                            payload,
                        )

                        if (response.status >= 400 && response.status < 500) {
                            firstClientError = firstClientError || error
                        } else {
                            const message = error instanceof Error ? error.message : String(error)
                            errors.push(`${candidate} (${message})`)
                        }
                        continue
                    }

                    if (payload?.error) {
                        firstClientError = firstClientError || createVaultClientError(payload.error, 400, payload)
                        continue
                    }

                    preferredBaseUrl = candidate
                    return payload
                } catch (error) {
                    if (isVaultClientErrorStatus(error, 500, 502, 503, 504)) {
                        const message = error instanceof Error ? error.message : String(error)
                        errors.push(`${candidate} (${message})`)
                        continue
                    }

                    if (isVaultClientErrorStatus(error, 400, 401, 403, 404, 409, 422)) {
                        firstClientError = firstClientError || error
                        continue
                    }

                    const message = error instanceof Error ? error.message : String(error)
                    errors.push(`${candidate} (${message})`)
                }
            }

            if (firstClientError) {
                throw firstClientError
            }

            throw new Error(`All Vault endpoints failed: ${errors.join(' | ')}`)
        } finally {
            clearTimeout(timer)
        }
    }

    const request = async (packet) =>
        requestJson({
            path: '/v1/vault/handle',
            method: 'POST',
            body: packet,
        })

    const mongoFindOne = async (collection, query) => {
        try {
            const payload = await request({
                storageType: 'mongo',
                operation: 'find',
                payload: {collection, query: query ?? {}},
            })
            return payload?.data ?? null
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (looksLikeNotFound(message)) {
                return null
            }
            logger?.error?.(`[${serviceName}] ❌ Vault mongo.find failed: ${message}`)
            throw error
        }
    }

    const mongoFindMany = async (collection, query) => {
        const payload = await request({
            storageType: 'mongo',
            operation: 'findMany',
            payload: {collection, query: query ?? {}},
        })
        return Array.isArray(payload?.data) ? payload.data : []
    }

    const mongoInsert = async (collection, data) =>
        request({
            storageType: 'mongo',
            operation: 'insert',
            payload: {collection, data: data ?? {}},
        })

    const mongoUpdate = async (collection, query, update, {upsert = false} = {}) =>
        request({
            storageType: 'mongo',
            operation: 'update',
            payload: {collection, query: query ?? {}, update: update ?? {}, upsert: upsert === true},
        })

    const mongoDelete = async (collection, query) =>
        request({
            storageType: 'mongo',
            operation: 'delete',
            payload: {collection, query: query ?? {}},
        })

    const mongoListCollections = async () => {
        const payload = await request({
            storageType: 'mongo',
            operation: 'listCollections',
            payload: {},
        })
        return Array.isArray(payload?.collections) ? payload.collections : []
    }

    const mongoWipe = async () =>
        request({
            storageType: 'mongo',
            operation: 'wipe',
            payload: {},
        })

    const redisSet = async (key, value, {ttl} = {}) =>
        request({
            storageType: 'redis',
            operation: 'set',
            payload: {key, value, ttl},
        })

    const redisGet = async (key) => {
        try {
            const payload = await request({
                storageType: 'redis',
                operation: 'get',
                payload: {key},
            })

            return payload?.data ?? null
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (looksLikeNotFound(message)) {
                return null
            }
            throw error
        }
    }

    const redisDel = async (key) =>
        request({
            storageType: 'redis',
            operation: 'del',
            payload: {key},
        })

    const redisWipe = async () =>
        request({
            storageType: 'redis',
            operation: 'wipe',
            payload: {},
        })

    const usersList = async ({role} = {}) => {
        const suffix = typeof role === 'string' && role.trim()
            ? `?role=${encodeURIComponent(role.trim())}`
            : ''
        const payload = await requestJson({
            path: `/api/users${suffix}`,
        })
        return Array.isArray(payload?.users) ? payload.users : []
    }

    const usersGet = async (username) => {
        try {
            const payload = await requestJson({
                path: `/api/users/${encodeURIComponent(String(username ?? ''))}`,
            })
            return payload?.user ?? null
        } catch (error) {
            if (isVaultClientErrorStatus(error, 404)) {
                return null
            }
            throw error
        }
    }

    const usersCreate = async ({username, password, role} = {}) =>
        requestJson({
            path: '/api/users',
            method: 'POST',
            body: {username, password, role},
        })

    const usersUpdate = async (username, updates = {}) =>
        requestJson({
            path: `/api/users/${encodeURIComponent(String(username ?? ''))}`,
            method: 'PUT',
            body: updates,
        })

    const usersDelete = async (username) =>
        requestJson({
            path: `/api/users/${encodeURIComponent(String(username ?? ''))}`,
            method: 'DELETE',
        })

    const usersAuthenticate = async ({username, password} = {}) => {
        try {
            const payload = await requestJson({
                path: '/api/users/authenticate',
                method: 'POST',
                body: {username, password},
            })
            return {
                authenticated: payload?.authenticated === true,
                user: payload?.user ?? null,
            }
        } catch (error) {
            if (isVaultClientErrorStatus(error, 401)) {
                return {authenticated: false, user: null}
            }
            throw error
        }
    }

    return {
        request,
        requestJson,
        baseUrls: deduped,
        mongo: {
            findOne: mongoFindOne,
            findMany: mongoFindMany,
            insert: mongoInsert,
            update: mongoUpdate,
            delete: mongoDelete,
            listCollections: mongoListCollections,
            wipe: mongoWipe,
        },
        redis: {
            set: redisSet,
            get: redisGet,
            del: redisDel,
            wipe: redisWipe,
        },
        users: {
            list: usersList,
            get: usersGet,
            create: usersCreate,
            update: usersUpdate,
            delete: usersDelete,
            authenticate: usersAuthenticate,
        },
        setDebug: async (enabled) =>
            requestJson({
                path: '/v1/vault/debug',
                method: 'POST',
                body: {enabled: !!enabled},
            }),
    }
}

export default {
    createVaultPacketClient,
}

export {isVaultClientErrorStatus}
