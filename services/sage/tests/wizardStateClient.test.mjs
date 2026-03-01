// services/sage/tests/wizardStateClient.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

import {createWizardStateClient, createWizardStatePublisher} from '../wizard/wizardStateClient.mjs'
import {createDefaultWizardState} from '../wizard/wizardStateSchema.mjs'

test('trackServiceStatus prefers layer-aware messages for step detail', async () => {
    const updates = []
    const stateStore = { current: createDefaultWizardState() }
    const client = {
        async loadState() {
            return stateStore.current
        },
        async writeState(nextState) {
            stateStore.current = nextState
            return nextState
        },
        async applyUpdates(nextUpdates) {
            updates.push(...nextUpdates)
            return { state: stateStore.current, changed: true }
        },
    }

    const publisher = createWizardStatePublisher({ client })
    await publisher.reset(['noona-sage'])

    await publisher.trackServiceStatus('noona-sage', 'installing', {
        status: 'installing',
        detail: '10/100',
        meta: { layerId: 'layer-456', phase: 'Downloading' },
    })

    assert.ok(updates.length > 0, 'Expected wizard updates to be applied')
    const detailUpdate = updates.find((entry) => entry.step === 'foundation')
    assert.ok(detailUpdate, 'Expected foundation step update')
    assert.ok(
        detailUpdate.detail?.includes('[layer-456]'),
        `Detail should include layer identifier, received: ${detailUpdate.detail}`,
    )
    assert.ok(detailUpdate.detail?.includes('Downloading'))
})

test('reset activates the library-services step for managed Kavita and Komf selections', async () => {
    const writes = []
    const stateStore = {current: createDefaultWizardState()}
    const client = {
        async loadState() {
            return stateStore.current
        },
        async writeState(nextState) {
            writes.push(nextState)
            stateStore.current = nextState
            return nextState
        },
        async applyUpdates(nextUpdates) {
            return {state: stateStore.current, changed: Array.isArray(nextUpdates) && nextUpdates.length > 0}
        },
    }

    const publisher = createWizardStatePublisher({client})
    await publisher.reset(['kavita', 'komf'])

    assert.ok(writes.length > 0, 'Expected the reset to persist wizard state')
    const latest = writes[writes.length - 1]
    assert.equal(latest.foundation.status, 'skipped')
    assert.equal(latest.portal.status, 'skipped')
    assert.equal(latest.raven.status, 'in-progress')
    assert.equal(latest.verification.status, 'pending')
})

test('createWizardStateClient retries the next Vault endpoint after a timeout', async () => {
    const state = createDefaultWizardState()
    const calls = []

    const fetchImpl = (url, options) => {
        calls.push(url)
        if (String(url).includes('vault-primary.local')) {
            return new Promise((_, reject) => {
                options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {once: true})
            })
        }

        return Promise.resolve(
            new Response(
                JSON.stringify({data: state}),
                {
                    status: 200,
                    headers: {'Content-Type': 'application/json'},
                },
            ),
        )
    }

    const client = createWizardStateClient({
        token: 'test-token',
        baseUrls: ['http://vault-primary.local:3005', 'http://vault-secondary.local:3005'],
        fetchImpl,
        timeoutMs: 5,
        env: {},
    })

    const loaded = await client.loadState({fallbackToDefault: true})
    assert.equal(loaded?.foundation?.status, 'pending')
    assert.equal(calls.length, 2)
    assert.ok(calls[0].includes('vault-primary.local'))
    assert.ok(calls[1].includes('vault-secondary.local'))
})
