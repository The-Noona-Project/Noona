// services/warden/core/registerDiagnosticsApi.mjs

export function registerDiagnosticsApi(context = {}) {
    const {
        api,
        appendHistoryEntry,
        buildEffectiveServiceDescriptor,
        checkServiceUpdate,
        detectKavitaDataMount,
        dockerUtils,
        ensureDockerConnection,
        fetchDockerHubDigest,
        fetchImpl,
        getLocalImageDigests,
        invokeWizard,
        listRegisteredServiceNames,
        logger,
        markDockerConnectionStale,
        parseImageReference,
        serviceCatalog,
        serviceName,
        serviceUpdateSnapshots,
        timestamp,
        wizardStateClient,
    } = context;

    api.isSetupCompleted = async function isSetupCompleted() {
        if (!wizardStateClient || typeof wizardStateClient.loadState !== 'function') {
            return false;
        }

        try {
            const state = await wizardStateClient.loadState({fallbackToDefault: false});
            return state?.completed === true;
        } catch {
            return false;
        }
    };

    api.refreshServiceUpdates = async function refreshServiceUpdates(options = {}) {
        const requestedServices = Array.isArray(options?.services)
            ? options.services
            : listRegisteredServiceNames();

        let dockerClient = null;
        try {
            dockerClient = await ensureDockerConnection();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn?.(`[${serviceName}] âš ï¸ Unable to connect to Docker for update check: ${message}`);
        }

        const results = [];
        for (const candidate of requestedServices) {
            const name = typeof candidate === 'string' ? candidate.trim() : '';
            if (!name) {
                continue;
            }

            if (!serviceCatalog.has(name)) {
                results.push({
                    service: name,
                    checkedAt: timestamp(),
                    supported: false,
                    updateAvailable: false,
                    error: 'Service is not registered with Warden.',
                });
                continue;
            }

            try {
                const snapshot = await checkServiceUpdate(name, {dockerClient});
                results.push(snapshot);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const snapshot = {
                    service: name,
                    image: buildEffectiveServiceDescriptor(name).descriptor.image ?? null,
                    checkedAt: timestamp(),
                    updateAvailable: false,
                    remoteDigest: null,
                    localDigests: [],
                    supported: true,
                    error: message,
                };
                serviceUpdateSnapshots.set(name, snapshot);
                results.push(snapshot);
            }
        }

        return results;
    };

    api.listServiceUpdates = function listServiceUpdates() {
        const snapshots = [];
        for (const name of listRegisteredServiceNames()) {
            const current = serviceUpdateSnapshots.get(name);
            if (current) {
                snapshots.push({...current});
            } else {
                snapshots.push({
                    service: name,
                    image: buildEffectiveServiceDescriptor(name).descriptor.image ?? null,
                    checkedAt: null,
                    updateAvailable: false,
                    remoteDigest: null,
                    localDigests: [],
                    installed: false,
                    supported: true,
                    error: null,
                });
            }
        }

        return snapshots;
    };

    api.updateServiceImage = async function updateServiceImage(name, options = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const {descriptor} = buildEffectiveServiceDescriptor(trimmedName);
        const image = typeof descriptor.image === 'string' ? descriptor.image.trim() : '';
        if (!image) {
            throw new Error(`Service ${trimmedName} does not define an image.`);
        }
        const resolvedImage = parseImageReference(image);
        const supportsDigestChecks = Boolean(resolvedImage && resolvedImage.registry === 'docker.io');

        const dockerClient = await ensureDockerConnection();
        const installed = await dockerUtils.containerExists(trimmedName, {dockerInstance: dockerClient});
        const getImageId = async () => {
            try {
                const inspected = await dockerClient.getImage(image).inspect();
                return typeof inspected?.Id === 'string' ? inspected.Id : null;
            } catch (error) {
                const statusCode = Number(error?.statusCode);
                if (statusCode === 404) {
                    return null;
                }
                throw error;
            }
        };

        const beforeImageId = await getImageId();
        const beforeLocalDigests = await getLocalImageDigests(dockerClient, image);
        await new Promise((resolve, reject) => {
            dockerClient.pull(image, (error, stream) => {
                if (error) {
                    reject(error);
                    return;
                }

                dockerClient.modem.followProgress(stream, (progressError) => {
                    if (progressError) {
                        reject(progressError);
                        return;
                    }
                    resolve();
                });
            });
        });
        const afterImageId = await getImageId();
        const afterLocalDigests = await getLocalImageDigests(dockerClient, image);
        const updated =
            beforeImageId !== afterImageId ||
            beforeLocalDigests.join('|') !== afterLocalDigests.join('|');

        const restart = options?.restart !== false;
        let restarted = false;
        if (restart && updated && installed) {
            await api.restartService(trimmedName);
            restarted = true;
        }

        let snapshot = null;
        if (supportsDigestChecks) {
            let remoteDigest = null;
            try {
                remoteDigest = await fetchDockerHubDigest(resolvedImage);
            } catch (error) {
                remoteDigest = serviceUpdateSnapshots.get(trimmedName)?.remoteDigest ?? null;
            }

            snapshot = {
                service: trimmedName,
                image,
                checkedAt: timestamp(),
                updateAvailable: false,
                remoteDigest,
                localDigests: afterLocalDigests,
                installed,
                supported: true,
                error: null,
            };
        } else {
            snapshot = {
                service: trimmedName,
                image,
                checkedAt: timestamp(),
                updateAvailable: false,
                remoteDigest: null,
                localDigests: afterLocalDigests,
                installed,
                supported: false,
                error: 'Update check currently supports Docker Hub images only.',
            };
        }

        serviceUpdateSnapshots.set(trimmedName, snapshot);
        await api.refreshServiceUpdates({services: [trimmedName]}).catch(() => null);

        const currentSnapshot = serviceUpdateSnapshots.get(trimmedName);
        if (
            currentSnapshot?.service !== trimmedName ||
            currentSnapshot?.updateAvailable === true ||
            (typeof currentSnapshot?.error === 'string' && currentSnapshot.error.trim().length > 0)
        ) {
            serviceUpdateSnapshots.set(trimmedName, snapshot);
        }

        return {
            service: trimmedName,
            image,
            beforeImageId,
            afterImageId,
            updated,
            restarted,
            installed,
            snapshot,
        };
    };

    api.detectKavitaMount = async function detectKavitaMount() {
        const detectionStartedAt = timestamp();
        appendHistoryEntry('noona-raven', {
            type: 'status',
            status: 'detecting',
            message: 'Detecting Kavita data mount',
            detail: null,
        });
        invokeWizard(
            'recordRavenDetail',
            {
                detection: {
                    status: 'detecting',
                    message: 'Detecting Kavita data mount…',
                    mountPath: null,
                    updatedAt: detectionStartedAt,
                },
                message: 'Detecting Kavita data mount…',
            },
            {status: 'in-progress', error: null},
        );

        try {
            const detection = await detectKavitaDataMount();

            if (detection?.mountPath) {
                appendHistoryEntry('noona-raven', {
                    type: 'status',
                    status: 'detected',
                    message: `Kavita data mount detected at ${detection.mountPath}`,
                    detail: detection.mountPath,
                });
                invokeWizard(
                    'recordRavenDetail',
                    {
                        detection: {
                            status: 'detected',
                            message: `Kavita data mount detected at ${detection.mountPath}`,
                            mountPath: detection.mountPath,
                            updatedAt: timestamp(),
                        },
                        message: `Kavita data mount detected at ${detection.mountPath}`,
                    },
                    {status: 'in-progress', error: null},
                );
            } else {
                appendHistoryEntry('noona-raven', {
                    type: 'status',
                    status: 'not-found',
                    message: 'Kavita data mount not detected automatically',
                    detail: null,
                });
                invokeWizard(
                    'recordRavenDetail',
                    {
                        detection: {
                            status: 'not-found',
                            message: 'Kavita data mount not detected automatically',
                            mountPath: null,
                            updatedAt: timestamp(),
                        },
                        message: 'Kavita data mount not detected automatically',
                    },
                    {status: 'in-progress', error: null},
                );
            }

            return detection;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendHistoryEntry('noona-raven', {
                type: 'status',
                status: 'error',
                message: 'Failed to detect Kavita data mount',
                detail: message,
                error: message,
            });
            invokeWizard(
                'recordRavenDetail',
                {
                    detection: {
                        status: 'error',
                        message,
                        mountPath: null,
                        updatedAt: timestamp(),
                    },
                    message,
                },
                {status: 'error', error: message},
            );
            throw error;
        }
    };

    api.getServiceHealth = async function getServiceHealth(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const entry = serviceCatalog.get(trimmedName);
        if (!entry) {
            throw new Error(`Service ${trimmedName} is not registered with Warden.`);
        }

        const descriptor = entry.descriptor;
        const candidateUrls = [];
        const seen = new Set();
        const addCandidate = (candidate) => {
            if (typeof candidate !== 'string') {
                return;
            }

            const trimmed = candidate.trim();
            if (!trimmed || seen.has(trimmed)) {
                return;
            }

            seen.add(trimmed);
            candidateUrls.push(trimmed);
        };

        const resolveHealthFromHostBase = (baseUrl) => {
            if (typeof baseUrl !== 'string') {
                return null;
            }

            const trimmed = baseUrl.trim();
            if (!trimmed) {
                return null;
            }

            if (/\/health\/?$/i.test(trimmed)) {
                return trimmed;
            }

            try {
                const parsed = new URL(trimmed);
                const pathName = parsed.pathname ?? '';
                if (!pathName || pathName === '/' || pathName === '//') {
                    parsed.pathname = '/health';
                } else {
                    parsed.pathname = `${pathName.replace(/\/$/, '')}/health`;
                }
                return parsed.toString();
            } catch {
                return `${trimmed.replace(/\/$/, '')}/health`;
            }
        };

        const hostBase = api.resolveHostServiceUrl(descriptor);
        const hostHealth = resolveHealthFromHostBase(hostBase);
        if (hostHealth) {
            addCandidate(hostHealth);
        }

        if (typeof descriptor.health === 'string' && descriptor.health.trim()) {
            addCandidate(descriptor.health.trim());
        }

        if (candidateUrls.length === 0) {
            throw new Error(`Health endpoint is not defined for ${trimmedName}.`);
        }

        const attemptErrors = [];

        for (const url of candidateUrls) {
            try {
                const response = await fetchImpl(url, {method: 'GET'});
                const rawBody = await response.text();
                let detailMessage = rawBody ? rawBody.trim() : '';
                let normalizedStatus = response.ok ? 'healthy' : 'error';

                if (detailMessage) {
                    try {
                        const parsed = JSON.parse(detailMessage);
                        if (parsed && typeof parsed === 'object') {
                            const record = parsed;
                            if (typeof record.status === 'string' && record.status.trim()) {
                                normalizedStatus = record.status.trim().toLowerCase();
                            }
                            if (typeof record.message === 'string' && record.message.trim()) {
                                detailMessage = record.message.trim();
                            } else if (typeof record.detail === 'string' && record.detail.trim()) {
                                detailMessage = record.detail.trim();
                            }
                        }
                    } catch {
                        // keep raw body as detail
                    }
                }

                if (!detailMessage) {
                    detailMessage = response.ok
                        ? 'Health check succeeded.'
                        : `Health check failed with status ${response.status}`;
                }

                if (!response.ok) {
                    throw new Error(detailMessage);
                }

                if (trimmedName === 'noona-raven') {
                    invokeWizard(
                        'recordRavenDetail',
                        {
                            health: {
                                status: normalizedStatus,
                                message: detailMessage,
                                updatedAt: timestamp(),
                            },
                            message: detailMessage,
                        },
                        {status: 'in-progress', error: null},
                    );
                }

                return {status: normalizedStatus, detail: detailMessage, url};
            } catch (error) {
                attemptErrors.push({url, error});
            }
        }

        const errorMessage = attemptErrors
            .map((entry) => {
                const reason = entry.error instanceof Error ? entry.error.message : String(entry.error);
                return `${entry.url}: ${reason}`;
            })
            .join(' | ') || 'Unable to verify service health.';

        if (trimmedName === 'noona-raven') {
            invokeWizard(
                'recordRavenDetail',
                {
                    health: {
                        status: 'error',
                        message: errorMessage,
                        updatedAt: timestamp(),
                    },
                    message: errorMessage,
                },
                {status: 'error', error: errorMessage},
            );
        }

        throw new Error(errorMessage);
    };

    api.testService = async function testService(name, options = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const entry = serviceCatalog.get(trimmedName);
        if (!entry) {
            throw new Error(`Service ${trimmedName} is not registered with Warden.`);
        }

        const descriptor = entry.descriptor;
        const formatServiceLabel = (service) =>
            service
                .replace(/^noona-/, '')
                .split('-')
                .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
                .join(' ');

        const httpTestConfig = {
            'noona-portal': {
                displayName: formatServiceLabel('noona-portal'),
                defaultPath: '/health',
                successMessage: 'Portal health check succeeded',
                failurePrefix: 'Portal',
            },
            'noona-vault': {
                displayName: formatServiceLabel('noona-vault'),
                defaultPath: '/v1/vault/health',
                successMessage: 'Vault health check succeeded',
                failurePrefix: 'Vault',
            },
            'noona-redis': {
                displayName: formatServiceLabel('noona-redis'),
                defaultPath: '/',
                successMessage: 'Redis health check succeeded',
                failurePrefix: 'Redis',
            },
            'noona-raven': {
                displayName: formatServiceLabel('noona-raven'),
                defaultPath: '/v1/library/health',
                successMessage: 'Raven health check succeeded',
                failurePrefix: 'Raven',
            },
        }[trimmedName];

        const ensurePath = (path) => {
            if (!path) {
                return '/health';
            }
            if (path === '/') {
                return '/';
            }
            return path.startsWith('/') ? path : `/${path}`;
        };

        const resolveHealthFromHostBase = (baseUrl, fallbackPath) => {
            if (typeof baseUrl !== 'string') {
                return null;
            }

            const trimmed = baseUrl.trim();
            if (!trimmed) {
                return null;
            }

            const normalizedPath = ensurePath(fallbackPath);

            if (!fallbackPath && /\/health\/?$/i.test(trimmed)) {
                return trimmed;
            }

            if (fallbackPath && trimmed.toLowerCase().endsWith(normalizedPath.toLowerCase())) {
                return trimmed;
            }

            try {
                return new URL(normalizedPath, trimmed).toString();
            } catch {
                const base = trimmed.replace(/\/$/, '');
                if (normalizedPath === '/') {
                    return `${base}/`;
                }
                return `${base}${normalizedPath}`;
            }
        };

        if (httpTestConfig) {
            const {
                path: pathOverride,
                url: urlOverride,
                method = 'GET',
                headers = {},
                body: requestBody = null,
            } = options ?? {};
            const candidateUrls = [];
            const seenCandidates = new Set();

            const addCandidate = (candidate) => {
                if (typeof candidate !== 'string') {
                    return;
                }

                const trimmedCandidate = candidate.trim();
                if (!trimmedCandidate || seenCandidates.has(trimmedCandidate)) {
                    return;
                }

                seenCandidates.add(trimmedCandidate);
                candidateUrls.push(trimmedCandidate);
            };

            const hostBase = api.resolveHostServiceUrl(descriptor);
            const hostHealthUrl = hostBase
                ? resolveHealthFromHostBase(hostBase, httpTestConfig.defaultPath)
                : null;

            if (typeof urlOverride === 'string' && urlOverride.trim()) {
                addCandidate(urlOverride);
            }

            if (!urlOverride && typeof pathOverride === 'string' && pathOverride.trim()) {
                if (hostBase) {
                    try {
                        addCandidate(new URL(pathOverride, hostBase).toString());
                    } catch {
                        const normalizedPath = ensurePath(pathOverride);
                        const base = hostBase.replace(/\/$/, '');
                        addCandidate(
                            normalizedPath === '/'
                                ? `${base}/`
                                : `${base}${normalizedPath}`,
                        );
                    }
                }
            }

            addCandidate(hostHealthUrl);

            if (typeof descriptor.health === 'string' && descriptor.health.trim()) {
                addCandidate(descriptor.health.trim());
            }

            if (!candidateUrls.length) {
                const errorMessage = `${httpTestConfig.displayName} health endpoint is not defined.`;
                appendHistoryEntry(trimmedName, {
                    type: 'error',
                    status: 'error',
                    message: errorMessage,
                    detail: errorMessage,
                    error: errorMessage,
                });

                return {
                    service: trimmedName,
                    success: false,
                    supported: true,
                    error: errorMessage,
                };
            }

            const attemptErrors = [];

            for (const targetUrl of candidateUrls) {
                appendHistoryEntry(trimmedName, {
                    type: 'status',
                    status: 'testing',
                    message: `Testing ${httpTestConfig.displayName} via ${targetUrl}`,
                    detail: targetUrl,
                });

                const start = Date.now();

                try {
                    const response = await fetchImpl(targetUrl, {
                        method,
                        headers,
                        body: requestBody,
                    });

                    const duration = Date.now() - start;
                    const rawBody = await response.text();
                    let parsedBody = rawBody;

                    try {
                        parsedBody = rawBody ? JSON.parse(rawBody) : null;
                    } catch {
                        // Ignore JSON parse failures and preserve raw body.
                    }

                    if (!response.ok) {
                        const errorMessage = `${httpTestConfig.displayName} responded with status ${response.status}`;
                        appendHistoryEntry(trimmedName, {
                            type: 'error',
                            status: 'error',
                            message: errorMessage,
                            detail: typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody),
                            error: errorMessage,
                        });

                        return {
                            service: trimmedName,
                            success: false,
                            supported: true,
                            status: response.status,
                            duration,
                            error: errorMessage,
                            body: parsedBody,
                        };
                    }

                    appendHistoryEntry(trimmedName, {
                        type: 'status',
                        status: 'tested',
                        message: httpTestConfig.successMessage,
                        detail: targetUrl,
                    });

                    return {
                        service: trimmedName,
                        success: true,
                        supported: true,
                        status: response.status,
                        duration,
                        body: parsedBody,
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    attemptErrors.push({url: targetUrl, message});

                    appendHistoryEntry(trimmedName, {
                        type: 'error',
                        status: 'error',
                        message: `${httpTestConfig.failurePrefix} test failed`,
                        detail: message,
                        error: message,
                    });
                }
            }

            const formattedErrors = attemptErrors.map(({url, message}) => `${url} (${message})`);
            const aggregatedMessage = attemptErrors.length
                ? `${httpTestConfig.failurePrefix} test failed for all candidates: ${formattedErrors.join('; ')}`
                : `${httpTestConfig.failurePrefix} test failed for all candidates.`;

            return {
                service: trimmedName,
                success: false,
                supported: true,
                error: aggregatedMessage,
            };
        }

        if (trimmedName === 'noona-mongo') {
            appendHistoryEntry(trimmedName, {
                type: 'status',
                status: 'testing',
                message: 'Inspecting Mongo container status',
                detail: null,
            });

            try {
                const dockerClient = await ensureDockerConnection();
                const container = dockerClient.getContainer(trimmedName);
                const inspection = await container.inspect();
                const state = inspection?.State || {};
                const running = state.Running === true;
                const status = state.Status || (running ? 'running' : 'stopped');
                const healthStatus = state.Health?.Status || null;
                const detailMessage = running
                    ? `Mongo container is ${status}${healthStatus ? ` (health: ${healthStatus})` : ''}.`
                    : `Mongo container is not running (status: ${status}).`;

                appendHistoryEntry(trimmedName, {
                    type: running ? 'status' : 'error',
                    status: running ? 'tested' : 'error',
                    message: running ? 'Mongo container inspection succeeded' : 'Mongo container reported inactive',
                    detail: detailMessage,
                    error: running ? null : detailMessage,
                });

                return {
                    service: trimmedName,
                    success: running,
                    supported: true,
                    status,
                    detail: detailMessage,
                    body: {
                        state,
                    },
                    error: running ? undefined : detailMessage,
                };
            } catch (error) {
                markDockerConnectionStale(error);
                const message = error instanceof Error ? error.message : String(error);
                appendHistoryEntry(trimmedName, {
                    type: 'error',
                    status: 'error',
                    message: 'Mongo inspection failed',
                    detail: message,
                    error: message,
                });

                return {
                    service: trimmedName,
                    success: false,
                    supported: true,
                    error: message,
                };
            }
        }

        return {
            service: trimmedName,
            success: false,
            supported: false,
            error: `Test action not supported for ${trimmedName}.`,
        };
    };
}

export default registerDiagnosticsApi;
