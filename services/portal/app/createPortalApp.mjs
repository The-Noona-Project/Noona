/**
 * @fileoverview Builds the Express app and HTTP server wrapper used by Portal.
 * Related files:
 * - app/portalRuntime.mjs
 * - routes/registerPortalRoutes.mjs
 * - tests/portalApp.test.mjs
 * Times this file has been edited: 4
 */

import express from 'express';

import {log} from '../../../utilities/etc/logger.mjs';
import {registerPortalRoutes} from '../routes/registerPortalRoutes.mjs';

/**
 * Creates the Express application used by Portal.
 *
 * @param {object} options - Named function inputs.
 * @returns {*} The function result.
 */
export const createPortalApp = ({
                                    config,
                                    discord,
                                    kavita,
                                    komf,
                                    raven,
                                    vault,
                                    onboardingStore,
                                    fetchImpl,
                                } = {}) => {
    if (!config) {
        throw new Error('Portal configuration is required.');
    }

    const app = express();
    app.disable('x-powered-by');
    app.use(express.json());

    registerPortalRoutes({
        app,
        config,
        discord,
        kavita,
        komf,
        raven,
        onboardingStore,
        vault,
        fetchImpl,
    });

    return app;
};

/**
 * Starts portal server.
 *
 * @param {object} options - Named function inputs.
 * @returns {Promise<*>} The asynchronous result.
 */
export const startPortalServer = async ({
                                            config,
                                            discord,
                                            kavita,
                                            komf,
                                            raven,
                                            vault,
                                            onboardingStore,
                                            fetchImpl,
                                        } = {}) => {
    const app = createPortalApp({config, discord, kavita, komf, raven, vault, onboardingStore, fetchImpl});

    const server = app.listen(config.port, () => {
        log(`[Portal] Service listening on port ${config.port}`);
    });

    const close = () => new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });

    return {
        app,
        server,
        close,
    };
};

export default startPortalServer;
