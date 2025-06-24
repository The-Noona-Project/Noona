// utilities/dynamic/pages/sendPage.mjs
import redis from '../../database/redis/redisClient.mjs';
import {debugMSG, errMSG} from '../../etc/logger.mjs';

/**
 * Sends a structured page packet to Redis for Moon to receive and store.
 * @param {string} slug - Page slug (e.g. 'setupwizard')
 * @param {string} html - Full HTML content of the page
 * @returns {Promise<{status: string, slug?: string, error?: string}>}
 */
export async function sendPage(slug, html) {
    // Attempt to split the HTML cleanly into parts
    let header = '';
    let body = '';
    let fooder = '';

    try {
        const splitStart = html.split('<body>');
        const splitEnd = splitStart[1]?.split('</body>');

        header = splitStart[0] + '<body>';
        body = splitEnd[0] || '';
        fooder = '</body>' + (html.includes('</html>') ? '</html>' : '');
    } catch {
        // fallback: treat all as body
        body = html;
    }

    const packet = {
        type: 'pagePacket',
        slug,
        time: new Date().toISOString(),
        from: process.env.SERVICE_NAME || 'unknown',
        header,
        body,
        fooder,
        rendered: false
    };

    try {
        const [rpushRes, saddRes] = await Promise.all([
            redis.rpush('noona:pagePackets', JSON.stringify(packet)),
            redis.sadd('noona:pages', slug)
        ]);

        debugMSG(`[sendPage] '${slug}' sent to Redis (rpush=${rpushRes}, sadd=${saddRes})`);
        return {status: 'ok', slug};
    } catch (err) {
        errMSG(`[sendPage] Failed to send '${slug}': ${err.message}`);
        return {status: 'error', error: err.message};
    }
}
