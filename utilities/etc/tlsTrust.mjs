import fs from 'node:fs';
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

export function ensureTrustedCaForUrl(url, options = {}) {
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
    if (trustedCaCache.get(cacheKey) === true) {
        return caPath;
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

    if (
        typeof tlsModule?.getCACertificates !== 'function'
        || typeof tlsModule?.setDefaultCACertificates !== 'function'
    ) {
        throw new Error('This Node runtime cannot load Vault CA certificates dynamically.');
    }

    const defaultCertificates = tlsModule.getCACertificates('default')
        .map((entry) => normalizeString(entry))
        .filter(Boolean);
    const mergedCertificates = Array.from(
        new Set([
            ...defaultCertificates,
            ...certificates.map((entry) => normalizeString(entry)).filter(Boolean),
        ]),
    ).map((entry) => `${entry}\n`);

    tlsModule.setDefaultCACertificates(mergedCertificates);
    trustedCaCache.set(cacheKey, true);

    return caPath;
}

export const __testables__ = {
    trustedCaCache,
};

export default {
    ensureTrustedCaForUrl,
    isHttpsUrl,
    resolveTrustedCaPath,
    splitPemCertificates,
};
