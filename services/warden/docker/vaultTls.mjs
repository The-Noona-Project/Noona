import {spawnSync as defaultSpawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_VAULT_FOLDER_NAME = 'vault';
const DEFAULT_CERT_LIFETIME_DAYS = 825;
const DEFAULT_CA_LIFETIME_DAYS = 3650;

export const DEFAULT_VAULT_TLS_DIRECTORY_NAME = 'tls';
export const VAULT_TLS_CONTAINER_PATH = '/var/lib/noona/vault-tls';
export const VAULT_CA_CERT_FILE_NAME = 'ca-cert.pem';
export const VAULT_CA_KEY_FILE_NAME = 'ca-key.pem';
export const VAULT_SERVER_CERT_FILE_NAME = 'vault-cert.pem';
export const VAULT_SERVER_KEY_FILE_NAME = 'vault-key.pem';
export const VAULT_TLS_EXPECTED_DNS_NAMES = Object.freeze(['noona-vault', 'localhost']);
export const VAULT_TLS_EXPECTED_IP_ADDRESSES = Object.freeze(['127.0.0.1']);

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
};

const hasReadableFile = (filePath, fsModule = fs) => {
    if (!filePath || typeof fsModule?.readFileSync !== 'function') {
        return false;
    }

    try {
        return Boolean(fsModule.readFileSync(filePath, 'utf8'));
    } catch {
        return false;
    }
};

const parseSubjectAltNames = (certificate) => {
    const values = {
        dnsNames: new Set(),
        ipAddresses: new Set(),
    };
    const subjectAltName = normalizeString(certificate?.subjectAltName);
    if (!subjectAltName) {
        return values;
    }

    for (const entry of subjectAltName.split(',')) {
        const trimmed = normalizeString(entry);
        if (!trimmed) {
            continue;
        }

        const separatorIndex = trimmed.indexOf(':');
        if (separatorIndex < 0) {
            continue;
        }

        const type = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim();
        if (!value) {
            continue;
        }

        if (type === 'DNS') {
            values.dnsNames.add(value);
            continue;
        }

        if (type === 'IP Address') {
            values.ipAddresses.add(value);
        }
    }

    return values;
};

export function resolveVaultTlsPaths({
                                         storageRoot,
                                         vaultFolderName = DEFAULT_VAULT_FOLDER_NAME,
                                     } = {}) {
    const root = normalizeString(storageRoot);
    if (!root) {
        throw new Error('A storageRoot is required to resolve Vault TLS assets.');
    }

    const directory = path.join(root, vaultFolderName || DEFAULT_VAULT_FOLDER_NAME, DEFAULT_VAULT_TLS_DIRECTORY_NAME);
    return {
        directory,
        caCertPath: path.join(directory, VAULT_CA_CERT_FILE_NAME),
        caKeyPath: path.join(directory, VAULT_CA_KEY_FILE_NAME),
        serverCertPath: path.join(directory, VAULT_SERVER_CERT_FILE_NAME),
        serverKeyPath: path.join(directory, VAULT_SERVER_KEY_FILE_NAME),
    };
}

export function isVaultTlsBundleUsable(paths = {}, options = {}) {
    const {
        fsModule = fs,
        expectedDnsNames = VAULT_TLS_EXPECTED_DNS_NAMES,
        expectedIpAddresses = VAULT_TLS_EXPECTED_IP_ADDRESSES,
        now = new Date(),
    } = options;
    const caCertPath = normalizeString(paths?.caCertPath);
    const caKeyPath = normalizeString(paths?.caKeyPath);
    const serverCertPath = normalizeString(paths?.serverCertPath);
    const serverKeyPath = normalizeString(paths?.serverKeyPath);

    if (
        !hasReadableFile(caCertPath, fsModule)
        || !hasReadableFile(caKeyPath, fsModule)
        || !hasReadableFile(serverCertPath, fsModule)
        || !hasReadableFile(serverKeyPath, fsModule)
    ) {
        return false;
    }

    try {
        const caCertificate = new crypto.X509Certificate(fsModule.readFileSync(caCertPath, 'utf8'));
        const serverCertificate = new crypto.X509Certificate(fsModule.readFileSync(serverCertPath, 'utf8'));
        if (!normalizeString(caCertificate.subject)) {
            return false;
        }

        const validFrom = Date.parse(serverCertificate.validFrom);
        const validTo = Date.parse(serverCertificate.validTo);
        const currentTime = now instanceof Date ? now.getTime() : Date.now();
        if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || currentTime < validFrom || currentTime > validTo) {
            return false;
        }

        const subjectAltNames = parseSubjectAltNames(serverCertificate);
        for (const dnsName of expectedDnsNames) {
            if (!subjectAltNames.dnsNames.has(dnsName)) {
                return false;
            }
        }

        for (const ipAddress of expectedIpAddresses) {
            if (!subjectAltNames.ipAddresses.has(ipAddress)) {
                return false;
            }
        }
    } catch {
        return false;
    }

    return true;
}

const runOpenSsl = (args, {
    spawnSync = defaultSpawnSync,
    cwd,
} = {}) => {
    const result = spawnSync('openssl', args, {
        cwd,
        encoding: 'utf8',
    });

    if (result?.error) {
        throw new Error(`openssl failed: ${result.error.message}`);
    }

    if (Number(result?.status) !== 0) {
        const stderr = normalizeString(result?.stderr);
        const stdout = normalizeString(result?.stdout);
        throw new Error(stderr || stdout || `openssl exited with status ${result?.status}`);
    }
};

const buildOpenSslConfig = () => [
    '[req]',
    'default_bits = 2048',
    'distinguished_name = req_distinguished_name',
    'req_extensions = v3_req',
    'prompt = no',
    '',
    '[req_distinguished_name]',
    'CN = noona-vault',
    '',
    '[v3_req]',
    'keyUsage = critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage = serverAuth',
    'subjectAltName = @alt_names',
    '',
    '[alt_names]',
    'DNS.1 = noona-vault',
    'DNS.2 = localhost',
    'IP.1 = 127.0.0.1',
    '',
].join('\n');

const removeIfPresent = (targetPath, fsModule = fs) => {
    if (!targetPath || typeof fsModule?.unlinkSync !== 'function') {
        return;
    }

    try {
        fsModule.unlinkSync(targetPath);
    } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
            throw error;
        }
    }
};

export function ensureVaultTlsAssets(options = {}) {
    const {
        storageRoot,
        vaultFolderName = DEFAULT_VAULT_FOLDER_NAME,
        fsModule = fs,
        spawnSync = defaultSpawnSync,
        validateBundle = isVaultTlsBundleUsable,
    } = options;
    const paths = resolveVaultTlsPaths({storageRoot, vaultFolderName});

    if (typeof fsModule?.mkdirSync === 'function') {
        fsModule.mkdirSync(paths.directory, {recursive: true});
    }

    if (validateBundle(paths, options)) {
        return {
            ...paths,
            reused: true,
        };
    }

    const configPath = path.join(paths.directory, 'vault-openssl.cnf');
    const csrPath = path.join(paths.directory, 'vault.csr');
    const serialPath = path.join(paths.directory, 'vault-ca.srl');

    if (typeof fsModule?.writeFileSync !== 'function') {
        throw new Error('Vault TLS assets could not be created because writeFileSync is unavailable.');
    }

    fsModule.writeFileSync(configPath, buildOpenSslConfig(), 'utf8');

    try {
        runOpenSsl(['genrsa', '-out', paths.caKeyPath, '4096'], {spawnSync, cwd: paths.directory});
        runOpenSsl([
            'req',
            '-x509',
            '-new',
            '-nodes',
            '-key',
            paths.caKeyPath,
            '-sha256',
            '-days',
            String(DEFAULT_CA_LIFETIME_DAYS),
            '-out',
            paths.caCertPath,
            '-subj',
            '/CN=Noona Vault Internal CA',
        ], {spawnSync, cwd: paths.directory});
        runOpenSsl(['genrsa', '-out', paths.serverKeyPath, '2048'], {spawnSync, cwd: paths.directory});
        runOpenSsl([
            'req',
            '-new',
            '-key',
            paths.serverKeyPath,
            '-out',
            csrPath,
            '-config',
            configPath,
        ], {spawnSync, cwd: paths.directory});
        runOpenSsl([
            'x509',
            '-req',
            '-in',
            csrPath,
            '-CA',
            paths.caCertPath,
            '-CAkey',
            paths.caKeyPath,
            '-CAcreateserial',
            '-CAserial',
            serialPath,
            '-out',
            paths.serverCertPath,
            '-days',
            String(DEFAULT_CERT_LIFETIME_DAYS),
            '-sha256',
            '-extensions',
            'v3_req',
            '-extfile',
            configPath,
        ], {spawnSync, cwd: paths.directory});
    } finally {
        removeIfPresent(configPath, fsModule);
        removeIfPresent(csrPath, fsModule);
        removeIfPresent(serialPath, fsModule);
    }

    if (!validateBundle(paths, options)) {
        throw new Error('Generated Vault TLS assets were invalid or incomplete.');
    }

    return {
        ...paths,
        reused: false,
    };
}

export default {
    DEFAULT_VAULT_TLS_DIRECTORY_NAME,
    VAULT_TLS_CONTAINER_PATH,
    VAULT_CA_CERT_FILE_NAME,
    VAULT_CA_KEY_FILE_NAME,
    VAULT_SERVER_CERT_FILE_NAME,
    VAULT_SERVER_KEY_FILE_NAME,
    VAULT_TLS_EXPECTED_DNS_NAMES,
    VAULT_TLS_EXPECTED_IP_ADDRESSES,
    ensureVaultTlsAssets,
    isVaultTlsBundleUsable,
    resolveVaultTlsPaths,
};
