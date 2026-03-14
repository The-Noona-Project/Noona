import assert from 'node:assert/strict'
import test from 'node:test'

import {createVaultPacketClient} from '../clients/vaultPacketClient.mjs'

test('createVaultPacketClient trusts HTTPS Vault URLs before sending requests', async () => {
    let trustedUrl = null
    const client = createVaultPacketClient({
        token: 'test-token',
        baseUrl: 'https://noona-vault:3005',
        env: {VAULT_CA_CERT_PATH: '/srv/noona/vault/tls/ca-cert.pem'},
        trustVaultUrl: (url) => {
            trustedUrl = url
        },
        fetchImpl: async () =>
            new Response(JSON.stringify({status: 'ok', data: []}), {
                status: 200,
                headers: {'Content-Type': 'application/json'},
            }),
    })

    const documents = await client.mongo.findMany('wizard_state', {})
    assert.deepEqual(documents, [])
    assert.ok(trustedUrl?.startsWith('https://noona-vault:3005/'))
})

test('createVaultPacketClient surfaces CA trust failures for HTTPS endpoints', async () => {
    const client = createVaultPacketClient({
        token: 'test-token',
        baseUrl: 'https://noona-vault:3005',
        env: {},
        trustVaultUrl: () => {
            throw new Error('missing CA bundle')
        },
        fetchImpl: async () => {
            throw new Error('fetch should not run when CA trust fails')
        },
    })

    await assert.rejects(
        () => client.mongo.findMany('wizard_state', {}),
        /missing CA bundle/i,
    )
})
