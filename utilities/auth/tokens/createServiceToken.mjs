// noona/jwt/createServiceToken.mjs
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { printResult, printDebug, printError } from '../../logger/logUtils.mjs';

/**
 * Creates a JWT service token but DOES NOT store it in Redis.
 * Caller is responsible for delivering or using it.
 */
export const createServiceToken = async (serviceName, expiresIn = '365d') => {
    printDebug(`[JWT] Generating service token for: ${serviceName}`);

    let privateKeyPath;
    if (process.env.JWT_PRIVATE_KEY_PATH && fs.existsSync(process.env.JWT_PRIVATE_KEY_PATH)) {
        privateKeyPath = process.env.JWT_PRIVATE_KEY_PATH;
        printDebug(`[JWT] Using JWT_PRIVATE_KEY_PATH from env: ${privateKeyPath}`);
    } else {
        privateKeyPath = path.join('/noona/family/noona-warden/files/keys', 'private.pem');
        printDebug(`[JWT] Using fallback private key path: ${privateKeyPath}`);
    }

    let privateKey;
    try {
        privateKey = fs.readFileSync(privateKeyPath, 'utf8');
        printDebug(`[JWT] Private key loaded successfully`);
    } catch (err) {
        printError(`[JWT] ❌ Failed to read private key: ${err.message}`);
        throw err;
    }

    const payload = {
        sub: serviceName,
        scope: 'service',
        iss: 'noona-warden'
    };

    const token = jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn });
    printResult(`[JWT] ✅ Token generated for ${serviceName}, expires in ${expiresIn}`);
    return token;
};
