/**
 * @fileoverview
 * Middleware to enforce JWT-based authentication using per-service public keys stored in Redis.
 * Verifies RS256 tokens by dynamically fetching the appropriate public key based on the `iss` field.
 *
 * On success:
 * - `req.user` is populated with the decoded JWT payload.
 *
 * On failure:
 * - Responds with 401 if no token is provided.
 * - Responds with 403 for invalid or unverified tokens.
 *
 * @module authLock
 */

import jwt from 'jsonwebtoken';
import { getFromRedis } from '../../../database/redis/getFromRedis.mjs';
import { printDebug, printError } from '../../logger/logUtils.mjs';

/**
 * Express middleware that validates JWTs using per-service public keys from Redis.
 *
 * @async
 * @function authLock
 * @param {import('express').Request} req - Incoming HTTP request
 * @param {import('express').Response} res - HTTP response object
 * @param {import('express').NextFunction} next - Express next() function to proceed
 * @returns {Promise<void>} If token is valid, continues to next middleware. Otherwise sends 401/403 response.
 *
 * @example
 * app.use('/v2/protected/route', authLock, myRouteHandler);
 */
export default async function authLock(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Authorization token missing'
        });
    }

    try {
        const client = global.noonaRedisClient;
        if (!client) throw new Error('Redis client not initialized');

        // Decode the token header/payload (without verifying) to get the issuer
        const decodedUnverified = jwt.decode(token, { complete: true });
        const issuer = decodedUnverified?.payload?.iss;

        if (!issuer) {
            throw new Error('Missing issuer (iss) in token');
        }

        const redisKey = `NOONA:TOKEN:${issuer}`;
        const publicKey = await getFromRedis(client, redisKey);

        if (!publicKey) {
            throw new Error(`Public key not found for issuer: ${issuer}`);
        }

        // Verify the token using the public key (RS256)
        const decoded = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
        req.user = decoded;

        printDebug(`🔐 Verified token for ${issuer} — user: ${decoded.sub || 'anonymous'}`);
        next();
    } catch (err) {
        printError(`🔒 Auth failed: ${err.message}`);
        return res.status(403).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
}
