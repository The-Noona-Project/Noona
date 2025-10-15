// services/sage/tests/wizardStateClient.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'

import { createWizardStatePublisher } from '../shared/wizardStateClient.mjs'
import { createDefaultWizardState } from '../shared/wizardStateSchema.mjs'

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
