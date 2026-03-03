import test from 'node:test'
import assert from 'node:assert/strict'

import addonDockers from '../docker/addonDockers.mjs'

test('noona-kavita addon descriptor probes the Kavita API health endpoint with a longer first-boot window', () => {
    const kavita = addonDockers['noona-kavita']
    assert.ok(kavita)

    assert.equal(kavita.image, 'captainpax/noona-kavita:latest')
    assert.equal(kavita.health, 'http://noona-kavita:5000/api/Health')
    assert.equal(kavita.healthTries, 60)
    assert.equal(kavita.healthDelayMs, 1000)
})

test('noona-kavita addon descriptor exposes optional first-admin bootstrap fields', () => {
    const kavita = addonDockers['noona-kavita']
    assert.ok(kavita)

    const envKeys = new Set((Array.isArray(kavita.env) ? kavita.env : []).map((entry) => String(entry).split('=')[0]))
    const configKeys = new Set((Array.isArray(kavita.envConfig) ? kavita.envConfig : []).map((entry) => entry?.key))

    for (const key of ['KAVITA_ADMIN_USERNAME', 'KAVITA_ADMIN_EMAIL', 'KAVITA_ADMIN_PASSWORD']) {
        assert.ok(envKeys.has(key), `${key} should be exported in the managed Kavita env.`)
        assert.ok(configKeys.has(key), `${key} should be documented in managed Kavita envConfig.`)
    }
})

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
