// services/sage/tests/sageApp.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'

import { createSageApp, startSage } from '../shared/sageApp.mjs'

const listen = (app) => new Promise((resolve) => {
    const server = app.listen(0, () => {
        const address = server.address()
        if (!address || typeof address !== 'object') {
            throw new Error('Expected numeric address info')
        }

        const port = address.port
        resolve({
            server,
            baseUrl: `http://127.0.0.1:${port}`,
        })
    })
})

const closeServer = (server) => new Promise((resolve, reject) => {
    server.close((error) => {
        if (error) {
            reject(error)
        } else {
            resolve()
        }
    })
})

test('GET /health responds with success message', async (t) => {
    const debugMessages = []
    const app = createSageApp({
        serviceName: 'test-sage',
        logger: {
            debug: (message) => debugMessages.push(message),
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/health`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'Sage is live!')
    assert.ok(debugMessages.some((line) => line.includes('Healthcheck OK')))
})

test('GET /api/pages returns static page definitions', async (t) => {
    const debugMessages = []
    const app = createSageApp({
        serviceName: 'test-sage',
        logger: {
            debug: (message) => debugMessages.push(message),
        },
    })

    const { server, baseUrl } = await listen(app)
    t.after(() => closeServer(server))

    const response = await fetch(`${baseUrl}/api/pages`)
    assert.equal(response.status, 200)
    const payload = await response.json()

    assert.deepEqual(payload, [
        { name: 'Setup', path: '/setup' },
        { name: 'Dashboard', path: '/dashboard' },
    ])
    assert.ok(debugMessages.some((line) => line.includes('Serving 2 static page entries')))
})

test('startSage starts server on provided port and logs startup message', async (t) => {
    const infoMessages = []
    const debugMessages = []

    const { server } = startSage({
        port: 0,
        serviceName: 'test-sage',
        logger: {
            debug: (message) => debugMessages.push(message),
            info: (message) => infoMessages.push(message),
        },
    })

    t.after(() => closeServer(server))
    await once(server, 'listening')

    const address = server.address()
    if (!address || typeof address !== 'object') {
        throw new Error('Expected numeric address info')
    }

    assert.ok(address.port > 0)
    assert.ok(infoMessages.some((line) => line.includes('test-sage')))
    assert.equal(debugMessages.length, 0)
})
