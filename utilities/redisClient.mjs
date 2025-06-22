import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://noona-redis:6379', {
    retryStrategy: times => Math.min(times * 100, 2000),
});

redis.on('connect', () => console.log('[redis] Connected'));
redis.on('error', err => console.error('[redis] Error:', err.message));

export default redis;
