// services/portal/shared/onboardingStore.mjs

import crypto from 'node:crypto';
import redis from '../../../utilities/database/redis/redisClient.mjs';
import { errMSG, log } from '../../../utilities/etc/logger.mjs';

const buildKey = (namespace, id) => `${namespace}:${id}`;

export const createOnboardingStore = ({
    namespace = 'portal:onboarding',
    ttlSeconds = 900,
} = {}) => {
    const generateToken = () => crypto.randomUUID();

    const setToken = async (discordId, payload = {}) => {
        if (!discordId) {
            throw new Error('Discord id is required when creating onboarding token.');
        }

        const token = payload?.token || generateToken();
        const record = { ...payload, token, discordId, createdAt: new Date().toISOString() };
        const key = buildKey(namespace, token);

        try {
            await redis.set(key, JSON.stringify(record), 'EX', ttlSeconds);
            log(`[Portal/Onboarding] Stored onboarding token for ${discordId}.`);
            return record;
        } catch (error) {
            errMSG(`[Portal/Onboarding] Failed to store token for ${discordId}: ${error.message}`);
            throw error;
        }
    };

    const getToken = async (token) => {
        if (!token) {
            return null;
        }

        const key = buildKey(namespace, token);
        try {
            const raw = await redis.get(key);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            errMSG(`[Portal/Onboarding] Failed to load token ${token}: ${error.message}`);
            throw error;
        }
    };

    const consumeToken = async (token) => {
        if (!token) {
            return null;
        }

        const record = await getToken(token);
        if (!record) {
            return null;
        }

        try {
            await redis.del(buildKey(namespace, token));
            log(`[Portal/Onboarding] Consumed onboarding token ${token}.`);
        } catch (error) {
            errMSG(`[Portal/Onboarding] Failed to consume token ${token}: ${error.message}`);
            throw error;
        }

        return record;
    };

    return {
        namespace,
        ttlSeconds,
        setToken,
        getToken,
        consumeToken,
    };
};

export default createOnboardingStore;
