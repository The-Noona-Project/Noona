import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
};

const parseBooleanFlag = (value) => {
    const normalized = normalizeString(value).toLowerCase();
    if (!normalized) {
        return false;
    }

    return ['1', 'true', 'yes', 'on'].includes(normalized);
};

export const resolveVaultTlsConfig = (env = process.env) => {
    const enabled = parseBooleanFlag(env?.VAULT_TLS_ENABLED);
    const certPath = normalizeString(env?.VAULT_TLS_CERT_PATH);
    const keyPath = normalizeString(env?.VAULT_TLS_KEY_PATH);
    const caCertPath = normalizeString(env?.VAULT_CA_CERT_PATH);

    return {
        enabled,
        certPath,
        keyPath,
        caCertPath,
    };
};

export const createVaultServer = ({
                                      app,
                                      env = process.env,
                                      fsModule = fs,
                                      httpModule = http,
                                      httpsModule = https,
                                  } = {}) => {
    if (!app) {
        throw new Error('An Express app is required to create the Vault server.');
    }

    const tls = resolveVaultTlsConfig(env);
    if (!tls.enabled) {
        return {
            server: httpModule.createServer(app),
            protocol: 'http',
            tls,
        };
    }

    if (!tls.certPath || !tls.keyPath) {
        throw new Error('Vault TLS is enabled, but VAULT_TLS_CERT_PATH or VAULT_TLS_KEY_PATH is missing.');
    }

    let certificate = '';
    let privateKey = '';
    try {
        certificate = fsModule.readFileSync(tls.certPath, 'utf8');
        privateKey = fsModule.readFileSync(tls.keyPath, 'utf8');
    } catch (error) {
        throw new Error(`Vault TLS files could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
        server: httpsModule.createServer({
            cert: certificate,
            key: privateKey,
        }, app),
        protocol: 'https',
        tls,
    };
};

export default createVaultServer;
