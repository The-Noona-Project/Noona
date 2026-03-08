// services/portal/app/createPortalApp.mjs

import express from 'express';

import {log} from '../../../utilities/etc/logger.mjs';
import {registerPortalRoutes} from '../routes/registerPortalRoutes.mjs';

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
