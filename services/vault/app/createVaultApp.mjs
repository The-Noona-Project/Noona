// services/vault/app/createVaultApp.mjs

import express from 'express';

import {getDefaultHandlePacket} from './defaultHandlePacket.mjs';
import {createVaultPolicyAuthorizer} from '../auth/servicePolicy.mjs';
import {createRequireAuth, extractBearerToken, parseTokenMap} from '../auth/tokenAuth.mjs';
import {registerSecretRoutes} from '../routes/registerSecretRoutes.mjs';
import {registerSystemRoutes} from '../routes/registerSystemRoutes.mjs';
import {registerUserRoutes} from '../routes/registerUserRoutes.mjs';
import {parseBooleanInput} from '../users/userAuth.mjs';

const fallbackLogger = {
    log: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    debug: (...args) => (console.debug ? console.debug(...args) : console.log(...args)),
};

export function createVaultApp(options = {}) {
    const {
        env = process.env,
        handlePacket,
        expressFactory = express,
        logger: loggerOption = {},
        log,
        warn,
        debug,
        isDebugEnabled,
        servicePolicies,
        setDebug,
    } = options;

    const logger = {
        ...fallbackLogger,
        ...loggerOption,
    };

    if (typeof log === 'function') {
        logger.log = log;
    }

    if (typeof warn === 'function') {
        logger.warn = warn;
    }

    if (typeof debug === 'function') {
        logger.debug = debug;
    }

    const {tokenPairs, tokensByService, serviceByToken} = parseTokenMap(env.VAULT_TOKEN_MAP || '');

    if (!tokenPairs.length) {
        logger.warn('[Vault] No service tokens were loaded. Protected routes will reject all requests.');
    } else {
        const serviceList = tokenPairs.map(([service]) => service).join(', ');
        logger.log(`[Vault] Loaded API tokens for: ${serviceList}`);
    }

    const app = expressFactory();
    app.use(express.json());

    const requireAuth = createRequireAuth({serviceByToken, debug: logger.debug});
    const authorizer = createVaultPolicyAuthorizer({servicePolicies});
    const getDebugState =
        typeof isDebugEnabled === 'function'
            ? isDebugEnabled
            : typeof loggerOption?.isDebugEnabled === 'function'
                ? loggerOption.isDebugEnabled
                : () => false;
    const applyDebugState =
        typeof setDebug === 'function'
            ? setDebug
            : typeof loggerOption?.setDebug === 'function'
                ? loggerOption.setDebug
                : () => {
                };

    const resolvePacketHandler = async () => {
        if (handlePacket) {
            return handlePacket;
        }

        return await getDefaultHandlePacket();
    };

    const secretsCollection = env.VAULT_SECRETS_COLLECTION || 'vault_secrets';
    const usersCollection = env.VAULT_USERS_COLLECTION || 'noona_users';

    registerSystemRoutes({
        app,
        applyDebugState,
        getDebugState,
        logger,
        authorizer,
        parseBooleanInput,
        requireAuth,
        resolvePacketHandler,
    });
    registerUserRoutes({
        app,
        authorizer,
        requireAuth,
        resolvePacketHandler,
        usersCollection,
    });
    registerSecretRoutes({
        app,
        authorizer,
        requireAuth,
        resolvePacketHandler,
        secretsCollection,
    });

    const port = env.PORT || 3005;

    return {
        app,
        port,
        requireAuth,
        tokensByService,
        serviceByToken,
        logger,
    };
}

export {createRequireAuth, extractBearerToken, parseTokenMap};
export default createVaultApp;
