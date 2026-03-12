// services/vault/routes/registerSystemRoutes.mjs

export function registerSystemRoutes(context = {}) {
    const {
        app,
        applyDebugState,
        authorizer,
        getDebugState,
        logger,
        parseBooleanInput,
        requireAuth,
        resolvePacketHandler,
    } = context;

    app.get('/v1/vault/health', (_req, res) => {
        res.send('Vault is up and running');
    });

    app.get('/v1/vault/debug', requireAuth, (_req, res) => {
        const access = authorizer?.canAccessDebug?.(_req.serviceName) ?? {ok: true};
        if (access.ok !== true) {
            res.status(access.status ?? 403).json({error: access.error || 'Forbidden'});
            return;
        }

        res.json({enabled: getDebugState() === true});
    });

    app.post('/v1/vault/debug', requireAuth, (req, res) => {
        const access = authorizer?.canAccessDebug?.(req.serviceName) ?? {ok: true};
        if (access.ok !== true) {
            res.status(access.status ?? 403).json({error: access.error || 'Forbidden'});
            return;
        }

        const enabled = parseBooleanInput(req.body?.enabled);
        if (enabled == null) {
            res.status(400).json({error: 'enabled must be a boolean value.'});
            return;
        }

        applyDebugState(enabled);
        logger.debug(`[Vault] Debug mode set to ${enabled} by ${req.serviceName}`);
        res.json({enabled: getDebugState() === true});
    });

    app.post('/v1/vault/handle', requireAuth, async (req, res) => {
        try {
            const packet = req.body;
            const access = authorizer?.canHandlePacket?.(req.serviceName, packet) ?? {ok: true};
            if (access.ok !== true) {
                res.status(access.status ?? 403).json({error: access.error || 'Forbidden'});
                return;
            }

            logger.debug(`[Vault] Handling packet from ${req.serviceName}`);
            const handler = await resolvePacketHandler();
            const result = await handler(packet);

            if (result?.error) {
                return res.status(400).json({error: result.error});
            }

            res.json(result ?? {});
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`[Vault] Packet handler failed for ${req.serviceName}: ${message}`);
            res.status(500).json({error: message || 'Unable to handle packet.'});
        }
    });
}

export default registerSystemRoutes;
