/**
 * @fileoverview
 * Utility function that generates a fresh RSA key pair (2048-bit) in PEM format.
 * Used for signing JWTs in Vault and issuing public keys to other Noona services.
 *
 * @module generateKeyPair
 */

import { generateKeyPair as generate } from 'crypto';
import { promisify } from 'util';

const asyncGenerateKeyPair = promisify(generate);

/**
 * Generates a new RSA key pair using 2048-bit encryption.
 *
 * @async
 * @function
 * @returns {Promise<{ publicKey: string, privateKey: string }>} The PEM-encoded RSA key pair
 *
 * @example
 * const { publicKey, privateKey } = await generateKeyPair();
 */
export async function generateKeyPair() {
    const { publicKey, privateKey } = await asyncGenerateKeyPair('rsa', {
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

    return { publicKey, privateKey };
}
