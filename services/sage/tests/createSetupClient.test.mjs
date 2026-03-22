import assert from 'node:assert/strict'
import test from 'node:test'

import {createSetupClient, WardenUpstreamHttpError} from '../app/createSetupClient.mjs'

const jsonResponse = (status, payload) => ({
    ok: status >= 200 && status < 300,
    status,
    async json() {
        return payload
    },
    async text() {
        return JSON.stringify(payload)
    },
})

test('listServices retries through Warden cold start while /health reports ready false', async () => {
    let serviceCalls = 0
    let healthCalls = 0
    const client = createSetupClient({
        baseUrl: 'http://noona-warden:4001',
        coldStartRetryWindowMs: 50,
        coldStartRetryDelayMs: 1,
        fetchImpl: async (url) => {
            const requestUrl = new URL(url)
            if (requestUrl.hostname === 'noona-warden' && requestUrl.pathname === '/api/services') {
                serviceCalls += 1
                if (serviceCalls === 1) {
                    return jsonResponse(502, {error: 'booting'})
                }

                return jsonResponse(200, {
                    services: [{name: 'noona-sage'}],
                })
            }

            if (requestUrl.hostname === 'noona-warden' && requestUrl.pathname === '/health') {
                healthCalls += 1
                return jsonResponse(200, {
                    status: 'starting',
                    ready: false,
                })
            }

            throw new Error(`Unexpected request: ${requestUrl.toString()}`)
        },
        logger: {
            debug() {
            },
        },
        serviceName: 'test-sage',
    })

    assert.deepEqual(await client.listServices(), [{name: 'noona-sage'}])
    assert.equal(serviceCalls, 2)
    assert.equal(healthCalls, 1)
})

test('getSetupConfig preserves terminal upstream HTTP errors after the retry window closes', async () => {
    const client = createSetupClient({
        baseUrl: 'http://noona-warden:4001',
        coldStartRetryWindowMs: 0,
        coldStartRetryDelayMs: 0,
        fetchImpl: async (url) => {
            const requestUrl = new URL(url)
            if (requestUrl.pathname === '/api/setup/config') {
                return jsonResponse(503, {error: 'Warden still booting'})
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`)
        },
        serviceName: 'test-sage',
    })

    await assert.rejects(
        client.getSetupConfig(),
        (error) =>
            error instanceof WardenUpstreamHttpError &&
            error.status === 503 &&
            error.message === 'Warden still booting',
    )
})

test('updateServiceConfig preserves upstream status and payload for Warden validation failures', async () => {
    const client = createSetupClient({
        baseUrl: 'http://noona-warden:4001',
        fetchImpl: async (url) => {
            const requestUrl = new URL(url)
            if (requestUrl.pathname === '/api/services/noona-moon/config') {
                return jsonResponse(400, {
                    error: 'SERVICE_NAME is managed by Warden and cannot be changed.',
                    key: 'SERVICE_NAME',
                })
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`)
        },
        serviceName: 'test-sage',
    })

    await assert.rejects(
        client.updateServiceConfig('noona-moon', {env: {SERVICE_NAME: 'noona-moon'}}),
        (error) =>
            error instanceof WardenUpstreamHttpError
            && error.status === 400
            && error.message === 'SERVICE_NAME is managed by Warden and cannot be changed.'
            && error.payload?.key === 'SERVICE_NAME',
    )
})

test('getServiceConfig can request unredacted service env for trusted summary sync flows', async () => {
    const client = createSetupClient({
        baseUrl: 'http://noona-warden:4001',
        fetchImpl: async (url) => {
            const requestUrl = new URL(url)
            if (requestUrl.pathname === '/api/services/noona-portal/config') {
                assert.equal(requestUrl.searchParams.get('includeSecrets'), 'true')
                return jsonResponse(200, {
                    env: {
                        KAVITA_API_KEY: 'existing-service-key',
                    },
                })
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`)
        },
        serviceName: 'test-sage',
    })

    assert.deepEqual(
        await client.getServiceConfig('noona-portal', {includeSecrets: true}),
        {
            env: {
                KAVITA_API_KEY: 'existing-service-key',
            },
        },
    )
})

test('restartService preserves upstream status and payload for Warden restart conflicts', async () => {
    const client = createSetupClient({
        baseUrl: 'http://noona-warden:4001',
        fetchImpl: async (url) => {
            const requestUrl = new URL(url)
            if (requestUrl.pathname === '/api/services/noona-moon/restart') {
                return jsonResponse(409, {
                    message: 'Restart already queued for noona-moon.',
                    service: 'noona-moon',
                })
            }

            throw new Error(`Unexpected request: ${requestUrl.pathname}`)
        },
        serviceName: 'test-sage',
    })

    await assert.rejects(
        client.restartService('noona-moon'),
        (error) =>
            error instanceof WardenUpstreamHttpError
            && error.status === 409
            && error.message === 'Restart already queued for noona-moon.'
            && error.payload?.service === 'noona-moon',
    )
})
