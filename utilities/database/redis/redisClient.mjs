// utilities/redisClient.mjs
import Redis from 'ioredis';
import {errMSG, log, warn} from '../../etc/logger.mjs';

const REDIS_HOST = process.env.REDIS_HOST || 'noona-redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const SERVICE_NAME = process.env.SERVICE_NAME || 'noona';

const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    retryStrategy: times => {
        warn(`[${SERVICE_NAME}] Redis retry #${times}`);
        return Math.min(times * 50, 2000); // cap retry delay at 2s
    }
});

redis.on('connect', () => {
    log(`[${SERVICE_NAME}] Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
});

redis.on('error', err => {
    errMSG(`[${SERVICE_NAME}] Redis error: ${err.message}`);
});

redis.on('reconnecting', () => {
    warn(`[${SERVICE_NAME}] Redis reconnecting...`);
});

export {redis};
export default redis;
