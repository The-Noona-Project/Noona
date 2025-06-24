// utilities/dynamic/pages/replyPage.mjs
import redis from '../../database/redis/redisClient.mjs';
import {debugMSG, errMSG} from '../../etc/logger.mjs';

/**
 * Save a reply object for a specific page slug.
 * @param {string} slug - Page identifier
 * @param {any} data - Arbitrary data from user/service
 * @returns {Promise<{status: string, saved?: string, error?: string}>}
 */
export async function replyPage(slug, data) {
    const key = `noona:reply:${slug}`;
    try {
        await redis.set(key, JSON.stringify({
            receivedAt: Date.now(),
            data
        }));
        debugMSG(`[replyPage] Stored reply for '${slug}'`);
        return {status: 'ok', saved: slug};
    } catch (err) {
        errMSG(`[replyPage] Failed to store reply for '${slug}': ${err.message}`);
        return {status: 'error', error: 'Failed to save reply'};
    }
}

/**
 * Retrieve a stored reply for a specific page slug.
 * @param {string} slug - Page identifier
 * @returns {Promise<{status: string, reply?: any, error?: string}>}
 */
export async function getReply(slug) {
    const key = `noona:reply:${slug}`;
    try {
        const raw = await redis.get(key);
        if (!raw) return {status: 'waiting', reply: null};

        const parsed = JSON.parse(raw);
        return {status: 'ok', reply: parsed};
    } catch (err) {
        errMSG(`[getReply] Failed to retrieve reply for '${slug}': ${err.message}`);
        return {status: 'error', error: 'Failed to read reply'};
    }
}
