// utilities/redisClient.mjs
import Redis from 'ioredis';

const redis = new Redis({host: 'noona-redis', port: 6379});

redis.on('error', err => {
    console.error('[redisClient.mjs] Redis error:', err.message);
});

redis.on('connect', () => {
    console.log('[redisClient.mjs] Connected to Redis');
});

export default redis;
