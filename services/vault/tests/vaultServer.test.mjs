import test from 'node:test';
import assert from 'node:assert/strict';

import {createVaultServer, resolveVaultTlsConfig} from '../app/createVaultServer.mjs';

test('resolveVaultTlsConfig parses managed TLS settings', () => {
    const config = resolveVaultTlsConfig({
        VAULT_TLS_ENABLED: 'true',
        VAULT_TLS_CERT_PATH: '/tls/vault-cert.pem',
        VAULT_TLS_KEY_PATH: '/tls/vault-key.pem',
        VAULT_CA_CERT_PATH: '/tls/ca-cert.pem',
    });

    assert.equal(config.enabled, true);
    assert.equal(config.certPath, '/tls/vault-cert.pem');
    assert.equal(config.keyPath, '/tls/vault-key.pem');
    assert.equal(config.caCertPath, '/tls/ca-cert.pem');
});

test('createVaultServer returns an HTTP server when TLS is disabled', () => {
    const server = {};
    const result = createVaultServer({
        app: () => {
        },
        env: {},
        httpModule: {
            createServer: () => server,
        },
    });

    assert.equal(result.protocol, 'http');
    assert.equal(result.server, server);
});

test('createVaultServer creates an HTTPS server when TLS files are present', () => {
    const server = {};
    let receivedOptions = null;
    const result = createVaultServer({
        app: () => {
        },
        env: {
            VAULT_TLS_ENABLED: 'true',
            VAULT_TLS_CERT_PATH: '/tls/vault-cert.pem',
            VAULT_TLS_KEY_PATH: '/tls/vault-key.pem',
        },
        fsModule: {
            readFileSync(path) {
                return path.endsWith('cert.pem') ? 'CERTIFICATE' : 'PRIVATE KEY';
            },
        },
        httpsModule: {
            createServer: (options) => {
                receivedOptions = options;
                return server;
            },
        },
    });

    assert.equal(result.protocol, 'https');
    assert.equal(result.server, server);
    assert.deepEqual(receivedOptions, {
        cert: 'CERTIFICATE',
        key: 'PRIVATE KEY',
    });
});

test('createVaultServer fails closed when TLS is enabled without cert material', () => {
    assert.throws(
        () => createVaultServer({
            app: () => {
            },
            env: {
                VAULT_TLS_ENABLED: 'true',
            },
        }),
        /VAULT_TLS_CERT_PATH|VAULT_TLS_KEY_PATH/i,
    );
});
