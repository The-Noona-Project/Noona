import redis from '../../redisClient.mjs';
import {debugMSG, errMSG} from '../../logger.mjs';

export async function replyPage(slug, data) {
    const key = `noona:reply:${slug}`;
    try {
        await redis.set(key, JSON.stringify({receivedAt: Date.now(), data}));
        debugMSG(`[replyPage] Saved reply for ${slug}`);
        return {status: 'ok', saved: slug};
    } catch (err) {
        errMSG(`[replyPage] Failed to save reply: ${err.message}`);
        return {status: 'error', error: 'Failed to save reply'};
    }
}

export async function getReply(slug) {
    const key = `noona:reply:${slug}`;
    try {
        const raw = await redis.get(key);
        if (!raw) return {status: 'waiting', reply: null};

        const parsed = JSON.parse(raw);
        return {status: 'ok', reply: parsed};
    } catch (err) {
        errMSG(`[getReply] Failed to read reply: ${err.message}`);
        return {status: 'error', error: 'Failed to read reply'};
    }
}
