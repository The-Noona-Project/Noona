// services/portal/shared/portalApp.mjs

import express from 'express';
import { errMSG, log } from '../../../utilities/etc/logger.mjs';

const buildError = (status, message, details) => ({ status, message, details });

const normalizeError = (error, fallbackStatus = 500) => {
    if (!error) {
        return buildError(fallbackStatus, 'Unknown error.');
    }

    if (typeof error === 'string') {
        return buildError(fallbackStatus, error);
    }

    const status = error.status || fallbackStatus;
    const message = error.message || 'Unexpected error.';

    return buildError(status, message, error.body ?? error.details ?? null);
};

export const createPortalApp = ({
    config,
    discord,
    kavita,
    vault,
    onboardingStore,
} = {}) => {
    if (!config) {
        throw new Error('Portal configuration is required.');
    }

    const app = express();
    app.disable('x-powered-by');
    app.use(express.json());

    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            service: config.serviceName,
            guildId: config.discord.guildId,
            version: config.version ?? '2.0.0',
        });
    });

    app.post('/api/portal/onboard', async (req, res) => {
        const { discordId, email, username, password, displayName, libraries = [] } = req.body ?? {};

        if (!discordId || !email || !username) {
            res.status(400).json({ error: 'discordId, email and username are required.' });
            return;
        }

        try {
            const onboardingToken = await onboardingStore?.setToken(discordId, {
                email,
                username,
                libraries,
            });

            await kavita?.createOrUpdateUser({ username, email, password, displayName, libraries });

            if (vault) {
                await vault.storePortalCredential(discordId, {
                    username,
                    email,
                    libraries,
                    issuedAt: new Date().toISOString(),
                });
            }

            if (discord) {
                await discord.assignDefaultRole(discordId).catch(error => {
                    errMSG(`[Portal] Failed to assign default Discord role: ${error.message}`);
                });
            }

            res.status(201).json({ token: onboardingToken?.token });
        } catch (error) {
            const normalised = normalizeError(error);
            errMSG(`[Portal] Failed to onboard member ${discordId}: ${normalised.message}`);
            res.status(normalised.status).json({ error: normalised.message, details: normalised.details });
        }
    });

    app.post('/api/portal/tokens/consume', async (req, res) => {
        const { token } = req.body ?? {};
        if (!token) {
            res.status(400).json({ error: 'token is required.' });
            return;
        }

        try {
            const record = await onboardingStore?.consumeToken(token);
            if (!record) {
                res.status(404).json({ error: 'Token not found or expired.' });
                return;
            }

            res.json({ success: true, record });
        } catch (error) {
            const normalised = normalizeError(error);
            errMSG(`[Portal] Failed to consume token ${token}: ${normalised.message}`);
            res.status(normalised.status).json({ error: normalised.message, details: normalised.details });
        }
    });

    app.use((err, _req, res, _next) => {
        const normalised = normalizeError(err);
        errMSG(`[Portal] Unhandled error: ${normalised.message}`);
        res.status(normalised.status).json({ error: normalised.message, details: normalised.details });
    });

    return app;
};

export const startPortalServer = async ({ config, discord, kavita, vault, onboardingStore } = {}) => {
    const app = createPortalApp({ config, discord, kavita, vault, onboardingStore });

    const server = app.listen(config.port, () => {
        log(`[Portal] Service listening on port ${config.port}`);
    });

    const close = () => new Promise((resolve, reject) => {
        server.close(err => {
            if (err) {
                reject(err);
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
