// utilities/dynamic/pages/sendPage.mjs
import redis from '../../redisClient.mjs';
import {debugMSG, errMSG} from '../../logger.mjs';

/**
 * Sends a page packet to Redis for Moon to receive and store.
 * @param {string} route - Page slug (e.g. 'setupwizard')
 * @param {string} html - HTML content of the page
 * @returns {Promise<{status: string, slug?: string, error?: string}>}
 */
export async function sendPage(route, html) {
    const packet = {
        type: 'pagePacket',
        slug: route,
        html,
        sentAt: Date.now()
    };

    try {
        await redis.rpush('noona:pagePackets', JSON.stringify(packet));
        debugMSG(`[sendPage] Queued page '${route}' to Redis.`);
        return {status: 'ok', slug: route};
    } catch (err) {
        errMSG(`[sendPage] Failed to queue page '${route}': ${err.message}`);
        return {status: 'error', error: err.message};
    }
}
