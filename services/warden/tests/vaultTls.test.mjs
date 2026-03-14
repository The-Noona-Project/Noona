import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
    ensureVaultTlsAssets,
    isVaultTlsBundleUsable,
    resolveVaultTlsPaths,
} from '../docker/vaultTls.mjs';

test('resolveVaultTlsPaths places assets under the Vault tls folder', () => {
    const paths = resolveVaultTlsPaths({
        storageRoot: '/srv/noona',
        vaultFolderName: 'vault-secure',
    });

    assert.equal(paths.directory, path.join('/srv/noona', 'vault-secure', 'tls'));
    assert.equal(paths.caCertPath, path.join('/srv/noona', 'vault-secure', 'tls', 'ca-cert.pem'));
    assert.equal(paths.serverCertPath, path.join('/srv/noona', 'vault-secure', 'tls', 'vault-cert.pem'));
});

test('ensureVaultTlsAssets reuses an existing valid bundle', () => {
    const result = ensureVaultTlsAssets({
        storageRoot: '/srv/noona',
        vaultFolderName: 'vault',
        fsModule: {
            mkdirSync() {
            },
        },
        validateBundle: () => true,
    });

    assert.equal(result.reused, true);
    assert.equal(result.caCertPath, path.join('/srv/noona', 'vault', 'tls', 'ca-cert.pem'));
});

test('ensureVaultTlsAssets generates assets when the bundle is missing or invalid', () => {
    const writes = [];
    let validateCalls = 0;
    const result = ensureVaultTlsAssets({
        storageRoot: '/srv/noona',
        vaultFolderName: 'vault',
        fsModule: {
            mkdirSync() {
            },
            writeFileSync(path, content) {
                writes.push({path, content});
            },
            unlinkSync() {
            },
        },
        spawnSync: (_command, args) => ({
            status: 0,
            stdout: '',
            stderr: '',
            args,
        }),
        validateBundle: () => {
            validateCalls += 1;
            return validateCalls > 1;
        },
    });

    assert.equal(result.reused, false);
    assert.ok(writes.some((entry) => entry.path.endsWith('vault-openssl.cnf')));
});

test('isVaultTlsBundleUsable returns false when files are missing', () => {
    assert.equal(
        isVaultTlsBundleUsable({
            caCertPath: '/missing/ca.pem',
            caKeyPath: '/missing/ca-key.pem',
            serverCertPath: '/missing/server.pem',
            serverKeyPath: '/missing/server-key.pem',
        }, {
            fsModule: {
                readFileSync() {
                    throw Object.assign(new Error('missing'), {code: 'ENOENT'});
                },
            },
        }),
        false,
    );
});
