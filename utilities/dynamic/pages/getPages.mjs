// utilities/dynamic/pages/getPages.mjs
import redis from '../../database/redis/redisClient.mjs';
import {debugMSG, errMSG} from '../../etc/logger.mjs';

/**
 * Retrieves all rendered pagePackets from Redis.
 * @returns {Promise<Array<{slug: string, from: string, time: string}>>}
 */
export async function getPages() {
    try {
        const slugs = await redis.smembers('noona:pages');
        if (!slugs.length) return [];

        const pipeline = redis.pipeline();
        slugs.forEach(slug => pipeline.get(`noona:packet:${slug}`));
        const results = await pipeline.exec();

        const packets = results.map(([err, data]) => {
            if (err || !data) return null;
            try {
                const parsed = JSON.parse(data);
                return parsed.rendered ? {
                    slug: parsed.slug,
                    from: parsed.from,
                    time: parsed.time
                } : null;
            } catch {
                return null;
            }
        }).filter(Boolean);

        debugMSG(`[getPages] Loaded ${packets.length} rendered page packets`);
        return packets;
    } catch (err) {
        errMSG(`[getPages] Redis error: ${err.message}`);
        return [];
    }
}
