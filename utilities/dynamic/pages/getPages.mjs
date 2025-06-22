import redis from '../../redisClient.mjs';
import {debugMSG, errMSG} from '../../logger.mjs';

export async function getPages() {
    try {
        const slugs = await redis.smembers('noona:pages');
        debugMSG(`Redis returned ${slugs.length} registered pages.`);
        return slugs;
    } catch (err) {
        errMSG(`[getPages] Redis failed: ${err.message}`);
        return [];
    }
}
