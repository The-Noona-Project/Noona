import test from 'node:test'
import assert from 'node:assert/strict'

import addonDockers from '../docker/addonDockers.mjs'

test('noona-kavita addon descriptor probes the Kavita API health endpoint with a longer first-boot window', () => {
    const kavita = addonDockers['noona-kavita']
    assert.ok(kavita)

    assert.equal(kavita.image, 'docker.darkmatterservers.com/the-noona-project/noona-kavita:latest')
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

test('noona-kavita addon descriptor exposes Noona login bridge URLs and social-login-only mode', () => {
    const kavita = addonDockers['noona-kavita']
    assert.ok(kavita)

    const envKeys = new Set((Array.isArray(kavita.env) ? kavita.env : []).map((entry) => String(entry).split('=')[0]))
    const configKeys = new Set((Array.isArray(kavita.envConfig) ? kavita.envConfig : []).map((entry) => entry?.key))

    for (const key of ['NOONA_MOON_BASE_URL', 'NOONA_PORTAL_BASE_URL', 'NOONA_SOCIAL_LOGIN_ONLY']) {
        assert.ok(envKeys.has(key), `${key} should be exported in the managed Kavita env.`)
        assert.ok(configKeys.has(key), `${key} should be documented in managed Kavita envConfig.`)
    }
})

test('noona-komf addon descriptor only exposes Kavita-specific configuration fields', () => {
    const komf = addonDockers['noona-komf']
    assert.ok(komf)
    assert.equal(komf.image, 'docker.darkmatterservers.com/the-noona-project/noona-komf:latest')

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
    assert.ok(configKeys.has('KOMF_APPLICATION_YML'))

    assert.ok(!configKeys.has('KOMF_KOMGA_BASE_URI'))
    assert.ok(!configKeys.has('KOMF_KOMGA_USER'))
    assert.ok(!configKeys.has('KOMF_KOMGA_PASSWORD'))
})

test('managed redis and mongo descriptors are internal-only and use Docker health checks', () => {
    const redis = addonDockers['noona-redis']
    const mongo = addonDockers['noona-mongo']

    assert.ok(redis)
    assert.ok(mongo)

    assert.equal(redis.port, null)
    assert.deepEqual(redis.ports, {})
    assert.equal(redis.hostServiceUrl, null)
    assert.equal(redis.health, null)
    assert.equal(redis.healthCheck?.type, 'docker')

    assert.equal(mongo.port, null)
    assert.deepEqual(mongo.ports, {})
    assert.equal(mongo.hostServiceUrl, null)
    assert.equal(mongo.health, null)
    assert.equal(mongo.healthCheck?.type, 'docker')

    const mongoPasswordField = mongo.envConfig.find((entry) => entry?.key === 'MONGO_INITDB_ROOT_PASSWORD')
    assert.ok(mongoPasswordField)
    assert.equal(mongoPasswordField.readOnly, true)
    assert.equal(mongoPasswordField.serverManaged, true)
    assert.equal(mongoPasswordField.sensitive, true)
})
