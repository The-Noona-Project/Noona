import assert from 'node:assert/strict';
import test from 'node:test';

import {
    __testables__,
    ensureTrustedCaForUrl,
    splitPemCertificates,
} from '../etc/tlsTrust.mjs';

const SAMPLE_PEM = [
    '-----BEGIN CERTIFICATE-----',
    'MIIBdzCCAR2gAwIBAgIUeVJHcXNhbXBsZWNlcnRpZmljYXRlMB4XDTI2MDMxMzAwMDAw',
    'MFoXDTI3MDMxMzAwMDAwMFowEjEQMA4GA1UEAwwHc2FtcGxlMIGfMA0GCSqGSIb3DQEB',
    'AQUAA4GNADCBiQKBgQDO6h3gP7Yjv4z0aWh4nE9D0qVd5l6dS4c3XyW4A4c6Lf+Qb2gh',
    'l1x8TYtqFz9xP5JzjM1g4+u+eD8qvI5rj9y7p8eRrT3pM2dGx8T1M6x8y2mV9k8vVhX3',
    '3mF4b0R3a3Y5YlJ4c3B3Q0FjZ0x3b2h2b2R0a2JkY2N3bG9mZ2lyQIDAQABo1MwUTAd',
    'BgNVHQ4EFgQUG4x7T1J0eVh6eXo0R2ZkYXd6dDAfBgNVHSMEGDAWgBQbjHtPUnR5WHp5',
    'ejRHZmRhd3p0MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADgYEAhY+1sQ==',
    '-----END CERTIFICATE-----',
].join('\n');

test('splitPemCertificates returns individual PEM blocks', () => {
    assert.deepEqual(splitPemCertificates(`${SAMPLE_PEM}\n${SAMPLE_PEM}`).length, 2);
});

test('ensureTrustedCaForUrl requires a CA path for HTTPS Vault endpoints', () => {
    __testables__.trustedCaCache.clear();
    assert.throws(
        () => ensureTrustedCaForUrl('https://noona-vault:3005', {env: {}}),
        /VAULT_CA_CERT_PATH is required/i,
    );
});

test('ensureTrustedCaForUrl loads the configured CA exactly once', () => {
    __testables__.trustedCaCache.clear();
    const calls = [];
    const tlsModule = {
        getCACertificates: () => [],
        setDefaultCACertificates: (certificates) => calls.push(certificates),
    };

    ensureTrustedCaForUrl('https://noona-vault:3005', {
        env: {VAULT_CA_CERT_PATH: '/srv/noona/vault/tls/ca-cert.pem'},
        fsModule: {
            readFileSync: () => SAMPLE_PEM,
        },
        tlsModule,
    });
    ensureTrustedCaForUrl('https://noona-vault:3005', {
        env: {VAULT_CA_CERT_PATH: '/srv/noona/vault/tls/ca-cert.pem'},
        fsModule: {
            readFileSync: () => {
                throw new Error('should not be called again');
            },
        },
        tlsModule,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 1);
});
