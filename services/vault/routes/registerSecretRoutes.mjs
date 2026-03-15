// services/vault/routes/registerSecretRoutes.mjs

export function registerSecretRoutes(context = {}) {
    const {
        app,
        authorizer,
        requireAuth,
        resolvePacketHandler,
        secretsCollection,
    } = context;

    app.get('/api/secrets/:path', requireAuth, async (req, res) => {
        const rawPath = typeof req.params?.path === 'string' ? req.params.path.trim() : '';
        if (!rawPath) {
            res.status(400).json({error: 'path is required.'});
            return;
        }

        const access = authorizer?.canAccessSecretPath?.(req.serviceName, rawPath) ?? {ok: true};
        if (access.ok !== true) {
            res.status(access.status ?? 403).json({error: access.error || 'Forbidden'});
            return;
        }

        const handler = await resolvePacketHandler();
        const packet = {
            storageType: 'mongo',
            operation: 'find',
            payload: {
                collection: secretsCollection,
                query: {path: rawPath},
            },
        };

        const result = await handler(packet);
        if (result?.error) {
            const message = String(result.error || '');
            if (message.toLowerCase().includes('no document found')) {
                res.status(404).json({error: 'Secret not found.'});
                return;
            }

            res.status(500).json({error: message || 'Unable to read secret.'});
            return;
        }

        const doc = result?.data;
        if (!doc || typeof doc !== 'object' || !Object.prototype.hasOwnProperty.call(doc, 'secret')) {
            res.status(404).json({error: 'Secret not found.'});
            return;
        }

        res.json(doc.secret ?? null);
    });

    app.put('/api/secrets/:path', requireAuth, async (req, res) => {
        const rawPath = typeof req.params?.path === 'string' ? req.params.path.trim() : '';
        if (!rawPath) {
            res.status(400).json({error: 'path is required.'});
            return;
        }

        const access = authorizer?.canAccessSecretPath?.(req.serviceName, rawPath) ?? {ok: true};
        if (access.ok !== true) {
            res.status(access.status ?? 403).json({error: access.error || 'Forbidden'});
            return;
        }

        if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'secret')) {
            res.status(400).json({error: 'secret is required.'});
            return;
        }

        const now = new Date().toISOString();
        const secret = req.body.secret;
        const handler = await resolvePacketHandler();
        const packet = {
            storageType: 'mongo',
            operation: 'update',
            payload: {
                collection: secretsCollection,
                query: {path: rawPath},
                update: {
                    $set: {
                        path: rawPath,
                        secret,
                        updatedAt: now,
                        updatedBy: req.serviceName,
                    },
                    $setOnInsert: {
                        createdAt: now,
                        createdBy: req.serviceName,
                    },
                },
                upsert: true,
            },
        };

        const result = await handler(packet);
        if (result?.error) {
            res.status(500).json({error: String(result.error || 'Unable to write secret.')});
            return;
        }

        res.json({ok: true});
    });

    app.delete('/api/secrets/:path', requireAuth, async (req, res) => {
        const rawPath = typeof req.params?.path === 'string' ? req.params.path.trim() : '';
        if (!rawPath) {
            res.status(400).json({error: 'path is required.'});
            return;
        }

        const access = authorizer?.canAccessSecretPath?.(req.serviceName, rawPath) ?? {ok: true};
        if (access.ok !== true) {
            res.status(access.status ?? 403).json({error: access.error || 'Forbidden'});
            return;
        }

        const handler = await resolvePacketHandler();
        const packet = {
            storageType: 'mongo',
            operation: 'delete',
            payload: {
                collection: secretsCollection,
                query: {path: rawPath},
            },
        };

        const result = await handler(packet);
        if (result?.error) {
            res.status(500).json({error: String(result.error || 'Unable to delete secret.')});
            return;
        }

        res.json({deleted: Number(result?.deleted) > 0});
    });
}

export default registerSecretRoutes;
