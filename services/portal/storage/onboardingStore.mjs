/**
 * @fileoverview Persists onboarding tokens through Vault-backed Redis helpers with TTL support.
 * Related files:
 * - app/portalRuntime.mjs
 * - routes/registerPortalRoutes.mjs
 * - tests/portalApp.test.mjs
 * Times this file has been edited: 4
 */

import crypto from 'node:crypto';
import {errMSG, log} from '../../../utilities/etc/logger.mjs';

const buildKey = (namespace, id) => `${namespace}:${id}`;

/**
 * Resolves the Vault Redis helpers required by the onboarding store.
 *
 * @param {object} vaultClient - Portal's Vault client.
 * @returns {{redisDel: Function, redisGet: Function, redisSet: Function}} The Redis helper interface.
 */
const resolveVaultRedisHelpers = (vaultClient) => {
    if (
        typeof vaultClient?.redisSet !== 'function'
        || typeof vaultClient?.redisGet !== 'function'
        || typeof vaultClient?.redisDel !== 'function'
    ) {
        throw new Error('Vault Redis helpers are required when creating the Portal onboarding store.');
    }

    return {
        redisSet: vaultClient.redisSet.bind(vaultClient),
        redisGet: vaultClient.redisGet.bind(vaultClient),
        redisDel: vaultClient.redisDel.bind(vaultClient),
    };
};

/**
 * Creates onboarding store.
 *
 * @param {object} options - Named function inputs.
 * @param {string} [options.namespace] - Redis namespace for onboarding tokens.
 * @param {number} [options.ttlSeconds] - Token time-to-live in seconds.
 * @param {object} options.vaultClient - Vault client exposing Redis helpers.
 * @returns {{consumeToken: Function, getToken: Function, namespace: string, setToken: Function, ttlSeconds: number}}
 * The onboarding token store.
 */
export const createOnboardingStore = ({
                                          namespace = 'portal:onboarding',
                                          ttlSeconds = 900,
                                          vaultClient,
                                      } = {}) => {
    const {redisSet, redisGet, redisDel} = resolveVaultRedisHelpers(vaultClient);
    const generateToken = () => crypto.randomUUID();

    const setToken = async (discordId, payload = {}) => {
        if (!discordId) {
            throw new Error('Discord id is required when creating onboarding token.');
        }

        const token = payload?.token || generateToken();
        const record = {...payload, token, discordId, createdAt: new Date().toISOString()};
        const key = buildKey(namespace, token);

        try {
            await redisSet(key, record, {ttl: ttlSeconds});
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
            return await redisGet(key);
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
            await redisDel(buildKey(namespace, token));
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
