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
        const [rpushRes, saddRes] = await Promise.all([
            redis.rpush('noona:pagePackets', JSON.stringify(packet)),
            redis.sadd('noona:pages', route)
        ]);

        debugMSG(`[sendPage] '${route}' sent to Redis (rpush=${rpushRes}, sadd=${saddRes})`);
        return {status: 'ok', slug: route};
    } catch (err) {
        errMSG(`[sendPage] Failed to queue '${route}': ${err.message}`);
        return {status: 'error', error: err.message};
    }
}
