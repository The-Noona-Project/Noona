import fs from 'node:fs';
import https from 'node:https';
import tls from 'node:tls';

const PEM_BLOCK_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const trustedCaCache = new Map();

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
};

export const isHttpsUrl = (candidate) => {
    const normalized = normalizeString(candidate);
    if (!normalized) {
        return false;
    }

    try {
        return new URL(normalized).protocol === 'https:';
    } catch {
        return /^https:\/\//i.test(normalized);
    }
};

export const splitPemCertificates = (pemText = '') =>
    Array.from(String(pemText).match(PEM_BLOCK_PATTERN) ?? [])
        .map((entry) => `${entry.trim()}\n`)
        .filter(Boolean);

export const resolveTrustedCaPath = (env = process.env) =>
    normalizeString(env?.VAULT_CA_CERT_PATH) || null;

const supportsDynamicDefaultCa = (tlsModule = tls) =>
    typeof tlsModule?.getCACertificates === 'function'
    && typeof tlsModule?.setDefaultCACertificates === 'function';

export function loadTrustedCaBundleForUrl(url, options = {}) {
    if (!isHttpsUrl(url)) {
        return null;
    }

    const env = options?.env ?? process.env;
    const fsModule = options?.fsModule ?? fs;
    const tlsModule = options?.tlsModule ?? tls;
    const caPath = normalizeString(options?.caPath ?? resolveTrustedCaPath(env));
    if (!caPath) {
        throw new Error('VAULT_CA_CERT_PATH is required for HTTPS Vault connections.');
    }

    const cacheKey = `${caPath}`;
    const cachedRecord = trustedCaCache.get(cacheKey);
    if (cachedRecord) {
        return {
            caPath: cachedRecord.caPath,
            certificates: [...cachedRecord.certificates],
            pemBundle: cachedRecord.pemBundle,
        };
    }

    if (typeof fsModule?.readFileSync !== 'function') {
        throw new Error('The configured Vault CA file could not be read.');
    }

    let pemContents = '';
    try {
        pemContents = fsModule.readFileSync(caPath, 'utf8');
    } catch (error) {
        throw new Error(`Unable to read Vault CA certificate at ${caPath}: ${error instanceof Error ? error.message : String(error)}`);
    }

    const certificates = splitPemCertificates(pemContents);
    if (certificates.length === 0) {
        throw new Error(`Vault CA certificate file ${caPath} did not contain any PEM certificate blocks.`);
    }

    const record = {
        caPath,
        certificates,
        pemBundle: certificates.join(''),
        globalApplied: false,
        agent: null,
        dispatcher: null,
    };
    trustedCaCache.set(cacheKey, record);

    return {
        caPath: record.caPath,
        certificates: [...record.certificates],
        pemBundle: record.pemBundle,
    };
}

const applyTrustedCaToRuntime = (caPath, tlsModule = tls) => {
    if (!supportsDynamicDefaultCa(tlsModule)) {
        return false;
    }

    const record = trustedCaCache.get(`${caPath}`);
    if (!record) {
        throw new Error(`Vault CA certificate bundle ${caPath} is not loaded.`);
    }

    if (record.globalApplied === true) {
        return true;
    }

    const defaultCertificates = tlsModule.getCACertificates('default')
        .map((entry) => normalizeString(entry))
        .filter(Boolean);
    const mergedCertificates = Array.from(
        new Set([
            ...defaultCertificates,
            ...record.certificates.map((entry) => normalizeString(entry)).filter(Boolean),
        ]),
    ).map((entry) => `${entry}\n`);

    tlsModule.setDefaultCACertificates(mergedCertificates);
    record.globalApplied = true;
    trustedCaCache.set(`${caPath}`, record);

    return true;
};

export function buildTrustedFetchOptionsForUrl(url, options = {}) {
    if (!isHttpsUrl(url)) {
        return {
            caPath: null,
            fetchOptions: {},
            mode: 'none',
        };
    }

    const tlsModule = options?.tlsModule ?? tls;
    const caBundle = loadTrustedCaBundleForUrl(url, options);
    const caPath = normalizeString(caBundle?.caPath);
    if (!caPath) {
        return {
            caPath: null,
            fetchOptions: {},
            mode: 'none',
        };
    }

    if (applyTrustedCaToRuntime(caPath, tlsModule)) {
        return {
            caPath,
            fetchOptions: {},
            mode: 'global',
        };
    }

    const record = trustedCaCache.get(caPath);
    if (!record) {
        throw new Error(`Vault CA certificate bundle ${caPath} is not loaded.`);
    }

    if (typeof options?.dispatcherFactory === 'function') {
        if (!record.dispatcher) {
            record.dispatcher = options.dispatcherFactory({
                ca: record.pemBundle,
                caPath: record.caPath,
                certificates: [...record.certificates],
            });
        }

        return {
            caPath: record.caPath,
            fetchOptions: {
                dispatcher: record.dispatcher,
            },
            mode: 'dispatcher',
        };
    }

    const agentFactory =
        typeof options?.agentFactory === 'function'
            ? options.agentFactory
            : ({ca}) => new https.Agent({ca});

    if (!record.agent || typeof options?.agentFactory === 'function') {
        const nextAgent = agentFactory({
            ca: record.pemBundle,
            caPath: record.caPath,
            certificates: [...record.certificates],
        });

        if (typeof options?.agentFactory === 'function') {
            return {
                caPath: record.caPath,
                fetchOptions: {
                    agent: nextAgent,
                },
                mode: 'agent',
            };
        }

        record.agent = nextAgent;
    }

    return {
        caPath: record.caPath,
        fetchOptions: {
            agent: record.agent,
        },
        mode: 'agent',
    };
}

export function ensureTrustedCaForUrl(url, options = {}) {
    if (!isHttpsUrl(url)) {
        return null;
    }

    const caBundle = loadTrustedCaBundleForUrl(url, options);
    const caPath = normalizeString(caBundle?.caPath);
    if (!caPath) {
        return null;
    }

    applyTrustedCaToRuntime(caPath, options?.tlsModule ?? tls);
    return caPath;
}

export const __testables__ = {
    trustedCaCache,
    applyTrustedCaToRuntime,
    supportsDynamicDefaultCa,
};

export default {
    buildTrustedFetchOptionsForUrl,
    ensureTrustedCaForUrl,
    isHttpsUrl,
    loadTrustedCaBundleForUrl,
    resolveTrustedCaPath,
    splitPemCertificates,
};
