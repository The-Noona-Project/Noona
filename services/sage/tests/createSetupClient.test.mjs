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
