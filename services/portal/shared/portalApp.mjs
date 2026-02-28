// services/portal/shared/portalApp.mjs

import express from 'express';
import {errMSG, log} from '../../../utilities/etc/logger.mjs';

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

const KAVITA_ROLE_DESCRIPTIONS = new Map([
    ['admin', 'Full administrative access to Kavita, including server and user management.'],
    ['pleb', 'Baseline non-admin role. Pair this with other roles to grant day-to-day access.'],
    ['download', 'Allows the user to download supported files from Kavita.'],
    ['change password', 'Allows the user to change their own Kavita password.'],
    ['bookmark', 'Allows the user to save personal bookmarks and related reader markers.'],
    ['change restriction', 'Allows the user to adjust their own content restriction settings.'],
    ['login', 'Allows the user to sign in to Kavita.'],
    ['read only', 'Keeps the account in read-only mode inside Kavita.'],
    ['promote', 'Allows the user to access Kavita promotion actions for supported entities.'],
]);

const describeKavitaRole = role => {
    const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
    return KAVITA_ROLE_DESCRIPTIONS.get(normalizedRole) || 'Role is available from Kavita, but Moon does not have a built-in description for it yet.';
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

    app.get('/api/portal/join-options', async (_req, res) => {
        try {
            const [roles, libraries] = await Promise.all([
                kavita?.fetchRoles?.() ?? [],
                kavita?.fetchLibraries?.() ?? [],
            ]);
            const normalizedRoles = Array.isArray(roles) ? roles : [];

            res.json({
                roles: normalizedRoles,
                roleDetails: normalizedRoles.map(role => ({
                    name: role,
                    description: describeKavitaRole(role),
                })),
                libraries: Array.isArray(libraries)
                    ? libraries
                        .filter(library => library?.id != null)
                        .map(library => ({
                            id: library.id,
                            name: library.name ?? `Library ${library.id}`,
                        }))
                    : [],
            });
        } catch (error) {
            const normalised = normalizeError(error);
            errMSG(`[Portal] Failed to load join options: ${normalised.message}`);
            res.status(normalised.status).json({error: normalised.message, details: normalised.details});
        }
    });

    app.post('/api/portal/onboard', async (req, res) => {
        const { discordId, email, username, password, displayName, libraries = [] } = req.body ?? {};

        if (!discordId || !email || !username || !password) {
            res.status(400).json({error: 'discordId, email, username, and password are required.'});
            return;
        }

        try {
            const onboardingToken = await onboardingStore?.setToken(discordId, {
                email,
                username,
                libraries,
            });

            await kavita?.createUser?.({
                username,
                email,
                password,
                roles: config.join?.defaultRoles ?? [],
                libraries: Array.isArray(libraries) && libraries.length > 0
                    ? libraries
                    : config.join?.defaultLibraries ?? [],
                displayName,
            });

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
