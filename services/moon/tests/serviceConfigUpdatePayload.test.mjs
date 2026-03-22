import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildEditableServiceConfigEnvPayload,
    buildServiceConfigUpdatePayload,
} from '../src/components/noona/settings/serviceConfigUpdatePayload.mjs'

test('buildEditableServiceConfigEnvPayload keeps only editable modeled keys and preserves masks or blank clears', () => {
    const envConfig = [
        {key: 'MOON_EXTERNAL_URL'},
        {key: 'SAGE_BASE_URL'},
        {key: 'DISCORD_CLIENT_SECRET'},
        {key: 'SERVICE_NAME', readOnly: true, serverManaged: true},
        {key: 'VAULT_API_TOKEN', readOnly: true, serverManaged: true},
        {key: 'VAULT_CA_CERT_PATH', readOnly: true, serverManaged: true},
    ]

    const envDraft = {
        MOON_EXTERNAL_URL: 'https://moon.example.com',
        SAGE_BASE_URL: '',
        DISCORD_CLIENT_SECRET: '********',
        SERVICE_NAME: 'noona-moon',
        VAULT_API_TOKEN: '********',
        VAULT_CA_CERT_PATH: '/vault/tls/ca-cert.pem',
        SERVER_IP: '203.0.113.10',
    }

    assert.deepEqual(buildEditableServiceConfigEnvPayload(envConfig, envDraft), {
        MOON_EXTERNAL_URL: 'https://moon.example.com',
        SAGE_BASE_URL: '',
        DISCORD_CLIENT_SECRET: '********',
    })
})

test('buildServiceConfigUpdatePayload keeps hostPort and restart while filtering env to editable modeled keys', () => {
    assert.deepEqual(buildServiceConfigUpdatePayload({
        envConfig: [
            {key: 'MOON_EXTERNAL_URL'},
            {key: 'SERVICE_NAME', readOnly: true, serverManaged: true},
        ],
        envDraft: {
            MOON_EXTERNAL_URL: '',
            SERVICE_NAME: 'noona-moon',
        },
        hostPort: 3002,
        restart: true,
    }), {
        env: {
            MOON_EXTERNAL_URL: '',
        },
        hostPort: 3002,
        restart: true,
    })
})
