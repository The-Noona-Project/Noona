// noona/jwt/generateKeys.mjs
import fs from 'fs';
import path from 'path';
import { generateKeyPairSync } from 'crypto';
import { printResult, printDebug } from '../logger/logUtils.mjs';

// Use the absolute destination for keys in the Warden folder.
const KEY_DESTINATION = '/noona/family/noona-warden/files/keys';

export async function generateKeys() {
    const privateKeyPath = path.join(KEY_DESTINATION, 'private.pem');
    const publicKeyPath = path.join(KEY_DESTINATION, 'public.pem');

    try {
        // Ensure the keys directory exists
        if (!fs.existsSync(KEY_DESTINATION)) {
            fs.mkdirSync(KEY_DESTINATION, { recursive: true });
            printDebug(`Created keys directory at ${KEY_DESTINATION}`);
        } else {
            printDebug(`Keys directory already exists at ${KEY_DESTINATION}`);
        }

        printDebug('Starting RSA key pair generation...');
        const { privateKey, publicKey } = generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });
        printDebug('RSA key pair generated.');

        // Save the keys to disk
        fs.writeFileSync(privateKeyPath, privateKey);
        fs.writeFileSync(publicKeyPath, publicKey);

        // Verify that the keys exist
        if (fs.existsSync(privateKeyPath)) {
            printDebug(`Private key exists at ${privateKeyPath}`);
        } else {
            printDebug(`Private key NOT found at ${privateKeyPath}`);
        }

        if (fs.existsSync(publicKeyPath)) {
            printDebug(`Public key exists at ${publicKeyPath}`);
        } else {
            printDebug(`Public key NOT found at ${publicKeyPath}`);
        }

        printResult('✔ JWT Key Pair generated and stored');
    } catch (err) {
        console.error('❌ Failed to generate JWT keys:', err.message);
        throw err;
    }
}
