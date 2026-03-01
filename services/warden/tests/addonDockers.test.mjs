import test from 'node:test'
import assert from 'node:assert/strict'

import addonDockers from '../docker/addonDockers.mjs'

test('noona-komf addon descriptor only exposes Kavita-specific configuration fields', () => {
    const komf = addonDockers['noona-komf']
    assert.ok(komf)

    const envKeys = new Set((Array.isArray(komf.env) ? komf.env : []).map((entry) => String(entry).split('=')[0]))
    const configKeys = new Set((Array.isArray(komf.envConfig) ? komf.envConfig : []).map((entry) => entry?.key))

    assert.ok(envKeys.has('KOMF_KAVITA_BASE_URI'))
    assert.ok(envKeys.has('KOMF_KAVITA_API_KEY'))
    assert.ok(envKeys.has('KOMF_CONFIG_HOST_MOUNT_PATH'))

    assert.ok(!envKeys.has('KOMF_KOMGA_BASE_URI'))
    assert.ok(!envKeys.has('KOMF_KOMGA_USER'))
    assert.ok(!envKeys.has('KOMF_KOMGA_PASSWORD'))

    assert.ok(configKeys.has('KOMF_KAVITA_BASE_URI'))
    assert.ok(configKeys.has('KOMF_KAVITA_API_KEY'))
    assert.ok(configKeys.has('KOMF_CONFIG_HOST_MOUNT_PATH'))

    assert.ok(!configKeys.has('KOMF_KOMGA_BASE_URI'))
    assert.ok(!configKeys.has('KOMF_KOMGA_USER'))
    assert.ok(!configKeys.has('KOMF_KOMGA_PASSWORD'))
})
