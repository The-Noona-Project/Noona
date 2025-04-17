// noona/jwt/sendToRedis.mjs
import fs from 'fs';
import path from 'path';
import { createClient } from 'redis';
import { printResult, printDebug } from '../logger/logUtils.mjs';

/**
 * Sends a given public key to Redis under a service-specific key.
 * If no public key is provided, it loads it from disk.
 *
 * The Redis key will be in the format: NOONA:KEY:<serviceName>:PUBLIC
 *
 * @param {string} [publicKey] - PEM format public key.
 * @param {string} [serviceName='noona-vault'] - The service name to use in the Redis key.
 */
export const sendPublicKeyToRedis = async (publicKey, serviceName = 'noona-vault') => {
    if (!publicKey) {
        let publicKeyPath;
        if (process.env.JWT_PUBLIC_KEY_PATH && fs.existsSync(process.env.JWT_PUBLIC_KEY_PATH)) {
            publicKeyPath = process.env.JWT_PUBLIC_KEY_PATH;
            printDebug(`Using JWT_PUBLIC_KEY_PATH from env: ${publicKeyPath}`);
        } else {
            publicKeyPath = path.join('/noona/family/noona-warden/files/keys', 'public.pem');
            printDebug(`JWT_PUBLIC_KEY_PATH not set or file not found. Falling back to: ${publicKeyPath}`);
        }
        try {
            publicKey = fs.readFileSync(publicKeyPath, 'utf8');
        } catch (err) {
            console.error('❌ Error reading public key from disk:', err.message);
            throw err;
        }
    }

    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
        throw new Error('REDIS_URL environment variable is not defined');
    }
    const redisClient = createClient({ url: redisUrl });

    // Updated Redis key format
    const redisKey = `NOONA:KEY:${serviceName}:PUBLIC`;

    try {
        await redisClient.connect();
        await redisClient.set(redisKey, publicKey);
        printResult(`✔ Public key written to Redis under key: ${redisKey}`);
    } catch (err) {
        console.error('❌ Redis error:', err.message);
        throw err;
    } finally {
        await redisClient.disconnect();
    }
};
