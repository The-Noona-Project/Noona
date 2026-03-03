// services/warden/core/registerServiceManagementApi.mjs

import {createManagedKavitaSetupClient} from '../../sage/clients/managedKavitaSetupClient.mjs';
import {
    DEFAULT_MANAGED_KOMF_APPLICATION_YML,
    normalizeManagedKomfConfigContent,
} from '../docker/komfConfigTemplate.mjs';

const MANAGED_KAVITA_SERVICE_NAME = 'noona-kavita';
const MANAGED_KAVITA_PORTAL_SERVICE_NAME = 'noona-portal';
const MANAGED_KAVITA_KOMF_SERVICE_NAME = 'noona-komf';
const MANAGED_KOMF_CONFIG_ENV_KEY = 'KOMF_APPLICATION_YML';

const normalizeString = (value) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
};

const normalizeManagedKavitaAccount = (envMap = {}) => {
    const username = normalizeString(envMap.KAVITA_ADMIN_USERNAME);
    const email = normalizeString(envMap.KAVITA_ADMIN_EMAIL);
    const password = normalizeString(envMap.KAVITA_ADMIN_PASSWORD);
    const providedCount = [username, email, password].filter(Boolean).length;

    if (providedCount === 0) {
        return null;
    }

    if (!username || !email || !password) {
        throw new Error(
            'Managed Kavita admin provisioning requires KAVITA_ADMIN_USERNAME, KAVITA_ADMIN_EMAIL, and KAVITA_ADMIN_PASSWORD together.',
        );
    }

    return {username, email, password};
};

const isManagedKavitaBaseUrl = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return false;
    }

    try {
        return new URL(normalized).hostname === MANAGED_KAVITA_SERVICE_NAME;
    } catch {
        return normalized.includes(`${MANAGED_KAVITA_SERVICE_NAME}:`);
    }
};

const buildManagedKavitaServiceEnv = (name, {baseUrl, apiKey}) => {
    if (name === MANAGED_KAVITA_PORTAL_SERVICE_NAME) {
        return {
            KAVITA_BASE_URL: baseUrl,
            KAVITA_API_KEY: apiKey,
        };
    }

    if (name === MANAGED_KAVITA_KOMF_SERVICE_NAME) {
        return {
            KOMF_KAVITA_BASE_URI: baseUrl,
            KOMF_KAVITA_API_KEY: apiKey,
        };
    }

    return null;
};

export function registerServiceManagementApi(context = {}) {
    const {
        api,
        appendHistoryEntry,
        applyEnvOverrides,
        applyStorageMountsForService,
        buildEffectiveServiceDescriptor,
        buildHostServiceUrl,
        cloneEnvConfig,
        cloneMeta,
        cloneServiceDescriptor,
        collectRavenDownloadMounts,
        deleteRavenDownloads,
        dependencyGraph,
        detectKavitaDataMount,
        dockerUtils,
        ensureDockerConnection,
        ensureHistory,
        findMatchingContainersByName,
        fetchImpl,
        formatDockerProgressMessage,
        getContainerPresence,
        getInstallationProgressSnapshot,
        hostServiceBase,
        INSTALLATION_SERVICE,
        invokeWizard,
        isDebugFlagEnabled,
        isLoggerDebugEnabled,
        listInstalledManagedServiceNames,
        listRegisteredServiceNames,
        logger,
        markDockerConnectionStale,
        networkName,
        normalizeEnvOverrideMap,
        normalizeHostPort,
        orderServicesForLifecycle,
        parseEnvEntries,
        parsePositiveLimit,
        persistServiceRuntimeConfig,
        persistServiceRuntimeConfigs,
        recordContainerOutput,
        removeNoonaDockerArtifacts,
        requiredServiceSet,
        requiredServices,
        readManagedKomfConfigFile,
        resetInstallationTracking,
        resolveManagedLifecycleServices,
        resolveRuntimeConfig,
        runtimeDebugState,
        serviceCatalog,
        serviceName,
        setLoggerDebug,
        timestamp,
        trackedContainers,
        writeRuntimeConfig,
    } = context;

    api.getDebug = function getDebug() {
        return {
            enabled: isLoggerDebugEnabled(),
            value: runtimeDebugState.value,
        };
    };

    api.setDebug = async function setDebug(enabled, options = {}) {
        const nextEnabled = isDebugFlagEnabled(enabled);
        runtimeDebugState.value = nextEnabled ? 'true' : 'false';
        setLoggerDebug(nextEnabled);

        if (options?.persist !== false) {
            const nextDebugValue = runtimeDebugState.value;
            for (const registeredServiceName of listRegisteredServiceNames()) {
                const runtime = resolveRuntimeConfig(registeredServiceName);
                writeRuntimeConfig(registeredServiceName, {
                    env: {
                        ...runtime.env,
                        DEBUG: nextDebugValue,
                    },
                    hostPort: runtime.hostPort,
                });
            }

            await persistServiceRuntimeConfigs(listRegisteredServiceNames());
        }

        return {
            enabled: nextEnabled,
            value: runtimeDebugState.value,
        };
    };

    api.resolveHostServiceUrl = function resolveHostServiceUrl(service) {
        if (!service) {
            return null;
        }

        const resolveByPort = (candidatePort) => {
            const port = normalizeHostPort(candidatePort);
            if (port == null) {
                return null;
            }

            if (typeof buildHostServiceUrl === 'function') {
                return buildHostServiceUrl(service, port);
            }

            return `${hostServiceBase}:${port}`;
        };

        const runtimeHostPort = normalizeHostPort(
            service?.name ? resolveRuntimeConfig(service.name).hostPort : null,
        );
        if (runtimeHostPort != null) {
            return resolveByPort(runtimeHostPort);
        }

        if (service.hostServiceUrl) {
            return service.hostServiceUrl;
        }

        if (service.port) {
            return resolveByPort(service.port);
        }

        return null;
    };

    const mergeManagedServiceRuntimeEnv = async (name, envUpdates = {}, {installOverridesByName = null} = {}) => {
        if (!serviceCatalog.has(name)) {
            return null;
        }

        const filteredUpdates = Object.fromEntries(
            Object.entries(envUpdates).filter(([key]) => normalizeString(key)),
        );

        if (Object.keys(filteredUpdates).length === 0) {
            return resolveRuntimeConfig(name);
        }

        const runtime = resolveRuntimeConfig(name);
        const nextRuntime = writeRuntimeConfig(name, {
            env: {
                ...runtime.env,
                ...filteredUpdates,
            },
            hostPort: runtime.hostPort,
        });

        await persistServiceRuntimeConfig(name, nextRuntime);

        if (installOverridesByName instanceof Map) {
            const existing = installOverridesByName.get(name) || {};
            installOverridesByName.set(name, {
                ...existing,
                ...filteredUpdates,
            });
        }

        return nextRuntime;
    };

    const serviceNeedsManagedKavitaProvisioning = (name, options = {}) => {
        if (name !== MANAGED_KAVITA_PORTAL_SERVICE_NAME && name !== MANAGED_KAVITA_KOMF_SERVICE_NAME) {
            return false;
        }

        if (!serviceCatalog.has(MANAGED_KAVITA_SERVICE_NAME)) {
            return false;
        }

        const envOverrides =
            options?.envOverrides && typeof options.envOverrides === 'object'
                ? options.envOverrides
                : null;
        const {descriptor} = buildEffectiveServiceDescriptor(name, {envOverrides});
        const envMap = parseEnvEntries(descriptor.env);

        if (name === MANAGED_KAVITA_KOMF_SERVICE_NAME) {
            return (
                isManagedKavitaBaseUrl(envMap.KOMF_KAVITA_BASE_URI) &&
                !normalizeString(envMap.KOMF_KAVITA_API_KEY)
            );
        }

        return (
            isManagedKavitaBaseUrl(envMap.KAVITA_BASE_URL) &&
            !normalizeString(envMap.KAVITA_API_KEY)
        );
    };

    api.needsManagedKavitaProvisioning = function needsManagedKavitaProvisioning(name, options = {}) {
        return serviceNeedsManagedKavitaProvisioning(name, options);
    };

    api.ensureManagedKavitaAccess = async function ensureManagedKavitaAccess(options = {}) {
        if (!serviceCatalog.has(MANAGED_KAVITA_SERVICE_NAME)) {
            return {
                configuredServices: [],
                skipped: true,
                reason: 'no-managed-kavita-service',
            };
        }

        const installOverridesByName =
            options?.installOverridesByName instanceof Map ? options.installOverridesByName : null;
        const targetServices = Array.isArray(options?.targetServices) ? options.targetServices : [];
        const configuredServices = Array.from(
            new Set(
                targetServices.filter((candidate) =>
                    serviceNeedsManagedKavitaProvisioning(candidate, {
                        envOverrides: installOverridesByName?.get(candidate) || null,
                    }),
                ),
            ),
        );

        if (configuredServices.length === 0) {
            return {
                configuredServices: [],
                skipped: true,
                reason: 'no-managed-kavita-targets',
            };
        }

        const {descriptor} = buildEffectiveServiceDescriptor(MANAGED_KAVITA_SERVICE_NAME, {
            envOverrides: installOverridesByName?.get(MANAGED_KAVITA_SERVICE_NAME) || null,
        });
        const kavitaPort = normalizeHostPort(descriptor.internalPort || descriptor.port) || 5000;
        const baseUrl = `http://${descriptor.name}:${kavitaPort}`;
        const envMap = parseEnvEntries(descriptor.env);
        const account = normalizeManagedKavitaAccount(envMap);

        appendHistoryEntry(MANAGED_KAVITA_SERVICE_NAME, {
            type: 'status',
            status: 'configuring',
            message: 'Provisioning managed Kavita API key for dependent services',
            detail: configuredServices.join(', '),
        });

        try {
            const client = createManagedKavitaSetupClient({
                baseUrl,
                fetchImpl,
                logger,
                serviceName,
            });
            const provisioning = await client.ensureServiceApiKey({
                account,
                allowRegister: true,
            });
            const normalizedBaseUrl = client.getBaseUrl().replace(/\/$/, '');
            const managedApiKey = normalizeString(provisioning?.apiKey);

            if (!managedApiKey) {
                throw new Error('Managed Kavita provisioning completed without returning an API key.');
            }

            if (provisioning?.account) {
                await mergeManagedServiceRuntimeEnv(
                    MANAGED_KAVITA_SERVICE_NAME,
                    {
                        KAVITA_ADMIN_USERNAME: provisioning.account.username,
                        KAVITA_ADMIN_EMAIL: provisioning.account.email ?? '',
                        KAVITA_ADMIN_PASSWORD: provisioning.account.password,
                    },
                    {installOverridesByName},
                );
            }

            for (const targetName of configuredServices) {
                const envUpdates = buildManagedKavitaServiceEnv(targetName, {
                    baseUrl: normalizedBaseUrl,
                    apiKey: managedApiKey,
                });

                if (!envUpdates) {
                    continue;
                }

                await mergeManagedServiceRuntimeEnv(targetName, envUpdates, {installOverridesByName});
                appendHistoryEntry(targetName, {
                    type: 'status',
                    status: 'configured',
                    message: 'Managed Kavita API key prepared for startup',
                    detail: normalizedBaseUrl,
                    clearError: true,
                });
            }

            appendHistoryEntry(MANAGED_KAVITA_SERVICE_NAME, {
                type: 'status',
                status: 'configured',
                message: 'Managed Kavita API key ready for dependent services',
                detail: normalizedBaseUrl,
                clearError: true,
            });

            return {
                apiKey: managedApiKey,
                baseUrl: normalizedBaseUrl,
                account: provisioning.account ?? null,
                configuredServices,
                skipped: false,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendHistoryEntry(MANAGED_KAVITA_SERVICE_NAME, {
                type: 'error',
                status: 'error',
                message: 'Managed Kavita API key provisioning failed',
                detail: message,
                error: message,
            });
            throw error;
        }
    };

    api.startService = async function startService(service, healthUrl = null, options = {}) {
        if (!service) {
            throw new Error('Service descriptor is required.');
        }

        const serviceName = service.name;
        if (!serviceName) {
            throw new Error('Service descriptor must include a name.');
        }

        appendHistoryEntry(serviceName, {
            type: 'status',
            status: 'pending',
            message: 'Preparing to start service',
            detail: null,
        });

        const dockerClient = await ensureDockerConnection();
        const installOverridesByName = options?.installOverridesByName;
        const effectiveService = await applyStorageMountsForService(service, {
            dockerClient,
            installOverridesByName,
        });
        const hostServiceUrl = api.resolveHostServiceUrl(effectiveService);
        const recreate = options?.recreate === true;
        let alreadyRunning = false;
        let existingContainer = {exists: false, running: false};

        try {
            const containerExists = await dockerUtils.containerExists(serviceName, {dockerInstance: dockerClient});
            if (containerExists) {
                const detectedState = await getContainerPresence(serviceName, dockerClient);
                existingContainer = detectedState.exists
                    ? detectedState
                    : {exists: true, running: true};
            }
            alreadyRunning = existingContainer.running;
        } catch (error) {
            markDockerConnectionStale(error);
            const message = error instanceof Error ? error.message : String(error);
            appendHistoryEntry(serviceName, {
                type: 'error',
                status: 'error',
                message: 'Failed to verify existing container state',
                detail: message,
                error: message,
            });
            throw error;
        }

        if (existingContainer.exists && (recreate || !alreadyRunning)) {
            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'recreating',
                message: recreate
                    ? 'Recreating container to apply updated configuration'
                    : 'Existing container is not running; recreating container',
                detail: null,
            });

            try {
                if (typeof dockerUtils.removeContainers === 'function') {
                    await dockerUtils.removeContainers(serviceName, {dockerInstance: dockerClient});
                } else {
                    await dockerClient.getContainer(serviceName).remove({force: true});
                }
                alreadyRunning = false;
            } catch (error) {
                markDockerConnectionStale(error);
                const message = error instanceof Error ? error.message : String(error);
                appendHistoryEntry(serviceName, {
                    type: 'error',
                    status: 'error',
                    message: 'Failed to remove existing container',
                    detail: message,
                    error: message,
                });
                throw error;
            }
        }

        if (!alreadyRunning) {
            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'pulling',
                message: `Checking Docker image ${effectiveService.image}`,
                detail: effectiveService.image,
            });

            try {
                await dockerUtils.pullImageIfNeeded(effectiveService.image, {
                    dockerInstance: dockerClient,
                    onProgress: (event = {}) => {
                        const explicitLayerId =
                            event.layerId != null ? String(event.layerId).trim() : '';
                        const fallbackLayerId = event.id != null ? String(event.id).trim() : '';
                        const layerId = explicitLayerId || fallbackLayerId || null;
                        const phase =
                            typeof event.phase === 'string' && event.phase.trim()
                                ? event.phase.trim()
                                : null;
                        const rawStatus = event.status || phase || 'progress';
                        const status =
                            typeof rawStatus === 'string'
                                ? rawStatus.trim() || 'progress'
                                : String(rawStatus ?? 'progress');
                        const detail = event.detail != null ? String(event.detail).trim() : '';
                        const explicitMessage = typeof event.message === 'string' ? event.message.trim() : '';
                        const message =
                            explicitMessage ||
                            formatDockerProgressMessage({
                                layerId,
                                phase,
                                status,
                                detail,
                            }) ||
                            status;

                        const meta = {};

                        if (layerId) {
                            meta.layerId = layerId;
                        }

                        if (phase) {
                            meta.phase = phase;
                        }

                        if (event.progressDetail && typeof event.progressDetail === 'object') {
                            meta.progressDetail = cloneMeta(event.progressDetail);
                        }

                        if (explicitMessage) {
                            meta.message = explicitMessage;
                        }

                        const metaPayload = Object.keys(meta).length > 0 ? meta : undefined;
                        appendHistoryEntry(serviceName, {
                            type: 'progress',
                            status,
                            message,
                            detail: detail || null,
                            ...(metaPayload ? {meta: metaPayload} : {}),
                        });
                    },
                });
            } catch (error) {
                markDockerConnectionStale(error);
                throw error;
            }

            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'starting',
                message: 'Starting container',
                detail: null,
            });

            try {
                await dockerUtils.runContainerWithLogs(
                    effectiveService,
                    networkName,
                    trackedContainers,
                    runtimeDebugState.value,
                    {
                        dockerInstance: dockerClient,
                        onLog: (raw, context = {}) => {
                            recordContainerOutput(serviceName, raw, context);
                        },
                    },
                );
            } catch (error) {
                markDockerConnectionStale(error);
                throw error;
            }

            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'started',
                message: 'Container start initiated',
                detail: null,
            });
        } else {
            logger.log(`${serviceName} already running.`);
            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'running',
                message: 'Container already running',
                detail: 'Container already running',
                clearError: true,
            });
        }

        if (healthUrl) {
            appendHistoryEntry(serviceName, {
                type: 'status',
                status: 'health-check',
                message: `Waiting for health check: ${healthUrl}`,
                detail: healthUrl,
            });

            try {
                await dockerUtils.waitForHealthyStatus(
                    serviceName,
                    healthUrl,
                    effectiveService.healthTries,
                    effectiveService.healthDelayMs,
                );
                appendHistoryEntry(serviceName, {
                    type: 'status',
                    status: 'healthy',
                    message: 'Health check passed',
                    detail: healthUrl,
                });
            } catch (error) {
                markDockerConnectionStale(error);
                const message = error instanceof Error ? error.message : String(error);
                appendHistoryEntry(serviceName, {
                    type: 'error',
                    status: 'error',
                    message: 'Health check failed',
                    detail: message,
                    error: message,
                });
                throw error;
            }
        }

        const readyMessage = hostServiceUrl
            ? `[${serviceName}] ✅ Ready (host_service_url: ${hostServiceUrl})`
            : `[${serviceName}] ✅ Ready.`;

        if (hostServiceUrl) {
            logger.log(readyMessage);
        } else {
            logger.log(readyMessage);
        }

        appendHistoryEntry(serviceName, {
            type: 'status',
            status: 'ready',
            message: 'Service ready',
            detail: hostServiceUrl ? `host_service_url: ${hostServiceUrl}` : null,
            clearError: true,
        });
    };

    api.listServices = async function listServices(options = {}) {
        const {includeInstalled = true} = options;

        const formatted = Array.from(
            new Map(
                Array.from(serviceCatalog.values()).map((entry) => [entry?.descriptor?.name, entry]),
            ).values(),
        )
            .map(({category, descriptor}) => {
                const effectiveDescriptor = buildEffectiveServiceDescriptor(descriptor.name).descriptor;

                return {
                    name: descriptor.name,
                    category,
                    image: effectiveDescriptor.image,
                    port: effectiveDescriptor.port ?? null,
                    hostServiceUrl: api.resolveHostServiceUrl(effectiveDescriptor),
                    description: effectiveDescriptor.description ?? null,
                    health: effectiveDescriptor.health ?? null,
                    envConfig: cloneEnvConfig(effectiveDescriptor.envConfig),
                    required: requiredServiceSet.has(descriptor.name),
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        let dockerClient = null;
        try {
            dockerClient = await ensureDockerConnection();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn?.(`[${serviceName}] ⚠️ Unable to establish Docker connection for listServices: ${message}`);
        }

        const entries = await Promise.all(
            formatted.map(async (service) => {
                let installed = false;

                if (dockerClient) {
                    try {
                        installed = await dockerUtils.containerExists(service.name, {dockerInstance: dockerClient});
                    } catch (error) {
                        markDockerConnectionStale(error);
                        const message = error instanceof Error ? error.message : String(error);
                        logger.warn?.(
                            `[${serviceName}] Failed to determine install status for ${service.name}: ${message}`,
                        );
                    }
                }

                return {...service, installed};
            }),
        );

        if (includeInstalled) {
            return entries;
        }

        return entries.filter((service) => service.installed !== true);
    };

    const buildInstallationList = (candidates = []) => {
        const invalidEntries = [];
        const seen = new Set();
        const prioritized = [];
        const envOverrides = new Map();

        const register = (name) => {
            if (!seen.has(name)) {
                seen.add(name);
                prioritized.push(name);
            }
        };

        for (const required of requiredServices) {
            register(required);
        }

        for (const candidate of candidates) {
            if (typeof candidate === 'string' || typeof candidate === 'number') {
                const trimmed = String(candidate).trim();

                if (!trimmed) {
                    invalidEntries.push({
                        name: typeof candidate === 'string' ? candidate.trim() : candidate ?? null,
                        status: 'error',
                        error: 'Invalid service name provided.',
                    });
                    continue;
                }

                register(trimmed);
                continue;
            }

            if (!candidate || typeof candidate !== 'object') {
                invalidEntries.push({
                    name: candidate ?? null,
                    status: 'error',
                    error: 'Service entry must be a string name or object descriptor.',
                });
                continue;
            }

            const rawName = typeof candidate.name === 'string' ? candidate.name.trim() : '';

            if (!rawName) {
                invalidEntries.push({
                    name: candidate.name ?? null,
                    status: 'error',
                    error: 'Service descriptor is missing a valid "name" field.',
                });
                continue;
            }

            if (candidate.env != null && (typeof candidate.env !== 'object' || Array.isArray(candidate.env))) {
                invalidEntries.push({
                    name: rawName,
                    status: 'error',
                    error: 'Environment overrides must be provided as an object map.',
                });
                continue;
            }

            register(rawName);

            if (candidate.env) {
                const normalized = {};

                for (const [key, value] of Object.entries(candidate.env)) {
                    if (typeof key !== 'string') {
                        continue;
                    }

                    const trimmedKey = key.trim();
                    if (!trimmedKey) {
                        continue;
                    }

                    normalized[trimmedKey] = value == null ? '' : String(value);
                }

                if (Object.keys(normalized).length > 0) {
                    const existing = envOverrides.get(rawName) || {};
                    envOverrides.set(rawName, {...existing, ...normalized});
                }
            }
        }

        return {prioritized, invalidEntries, overridesByName: envOverrides};
    };

    const resolveInstallOrder = (names = []) => {
        const order = [];
        const visited = new Set();
        const visiting = new Set();
        const requestedNames = new Set(names);
        const orderedKnownNames =
            typeof orderServicesForLifecycle === 'function'
                ? orderServicesForLifecycle(names.filter((name) => serviceCatalog.has(name)))
                : names.filter((name) => serviceCatalog.has(name));
        const orderedNames = [
            ...orderedKnownNames,
            ...names.filter((name) => !serviceCatalog.has(name)),
        ];

        const visit = (name) => {
            if (visited.has(name)) {
                return;
            }

            if (visiting.has(name)) {
                const chain = [...visiting, name].join(' -> ');
                throw new Error(`Circular dependency detected: ${chain}`);
            }

            visiting.add(name);

            const dependencies = [...(dependencyGraph.get(name) || [])];
            if (
                name === MANAGED_KAVITA_PORTAL_SERVICE_NAME &&
                requestedNames.has(MANAGED_KAVITA_SERVICE_NAME) &&
                !dependencies.includes(MANAGED_KAVITA_SERVICE_NAME)
            ) {
                dependencies.push(MANAGED_KAVITA_SERVICE_NAME);
            }

            for (const dependency of dependencies) {
                visit(dependency);
            }

            visiting.delete(name);
            visited.add(name);
            order.push(name);
        };

        for (const name of orderedNames) {
            visit(name);
        }

        return order;
    };

    const installSingleServiceByName = async (name, envOverrides = null, options = {}) => {
        const installOverridesByName =
            options?.installOverridesByName instanceof Map ? options.installOverridesByName : null;
        const {entry, descriptor, envOverrides: combinedOverrides, runtime} = buildEffectiveServiceDescriptor(name, {
            envOverrides,
        });
        const {category} = entry;
        const healthUrl = descriptor.health || null;
        let kavitaDetection = null;
        let kavitaDataMount = null;
        let serviceDescriptor = cloneServiceDescriptor(descriptor);
        let normalizedOverrides = {...combinedOverrides};
        let launchStartedAt = null;
        const upsertEnvValue = (entries, key, value) => {
            const list = Array.isArray(entries) ? [...entries] : [];
            const prefix = `${key}=`;
            const filtered = list.filter((entry) => !(typeof entry === 'string' && entry.startsWith(prefix)));
            filtered.push(`${key}=${value ?? ''}`);
            return filtered;
        };
        const ensureVolumeEntry = (entries, mount) => {
            const list = Array.isArray(entries) ? [...entries] : [];
            if (!list.includes(mount)) {
                list.push(mount);
            }
            return list;
        };

        if (descriptor.name === 'noona-raven') {
            const detectionStartedAt = timestamp();
            const detectionMessage = 'Detecting Kavita data mount…';
            appendHistoryEntry(descriptor.name, {
                type: 'status',
                status: 'detecting',
                message: detectionMessage,
                detail: null,
            });
            invokeWizard(
                'recordRavenDetail',
                {
                    detection: {
                        status: 'detecting',
                        message: detectionMessage,
                        mountPath: null,
                        updatedAt: detectionStartedAt,
                    },
                    message: detectionMessage,
                },
                {status: 'in-progress', error: null},
            );

            try {
                kavitaDetection = await detectKavitaDataMount();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                appendHistoryEntry(descriptor.name, {
                    type: 'status',
                    status: 'error',
                    message: 'Failed to detect Kavita data mount',
                    detail: message,
                    error: message,
                });
                invokeWizard('recordRavenDetail', {
                    detection: {
                        status: 'error',
                        message,
                        mountPath: null,
                        updatedAt: timestamp(),
                    },
                    message,
                }, {status: 'error', error: message});
                throw error;
            }

            kavitaDataMount = kavitaDetection?.mountPath ?? null;

            if (kavitaDataMount) {
                const envWithAppData = upsertEnvValue(serviceDescriptor.env, 'APPDATA', '/kavita-data');
                const envWithKavita = upsertEnvValue(envWithAppData, 'KAVITA_DATA_MOUNT', '/kavita-data');
                const volumes = ensureVolumeEntry(serviceDescriptor.volumes, `${kavitaDataMount}:/kavita-data`);

                serviceDescriptor = {
                    ...serviceDescriptor,
                    env: envWithKavita,
                    volumes,
                };

                const detectedMessage = `Kavita data mount detected at ${kavitaDataMount}`;
                appendHistoryEntry(descriptor.name, {
                    type: 'status',
                    status: 'detected',
                    message: detectedMessage,
                    detail: kavitaDataMount,
                });
                invokeWizard(
                    'recordRavenDetail',
                    {
                        detection: {
                            status: 'detected',
                            message: detectedMessage,
                            mountPath: kavitaDataMount,
                            updatedAt: timestamp(),
                        },
                        message: detectedMessage,
                    },
                    {status: 'in-progress', error: null},
                );
            } else {
                const trimValue = (value) => (typeof value === 'string' ? value.trim() : '');
                const manualAppData = trimValue(normalizedOverrides?.APPDATA);
                const manualMount = trimValue(normalizedOverrides?.KAVITA_DATA_MOUNT);
                const containerPath = manualAppData || (manualMount ? '/kavita-data' : null);
                const hostPath = manualMount || manualAppData || null;

                if (hostPath && containerPath) {
                    const envWithAppData = upsertEnvValue(serviceDescriptor.env, 'APPDATA', containerPath);
                    const envWithMount = upsertEnvValue(envWithAppData, 'KAVITA_DATA_MOUNT', containerPath);
                    const volumes = ensureVolumeEntry(serviceDescriptor.volumes, `${hostPath}:${containerPath}`);

                    serviceDescriptor = {
                        ...serviceDescriptor,
                        env: envWithMount,
                        volumes,
                    };

                    normalizedOverrides = normalizedOverrides ? {...normalizedOverrides} : {};
                    normalizedOverrides.APPDATA = containerPath;
                    normalizedOverrides.KAVITA_DATA_MOUNT = containerPath;
                    kavitaDataMount = hostPath;
                }

                const manualMessage = kavitaDataMount
                    ? `Configured Kavita mount from overrides at ${kavitaDataMount}`
                    : 'Kavita data mount not detected automatically';
                appendHistoryEntry(descriptor.name, {
                    type: 'status',
                    status: kavitaDataMount ? 'configured' : 'installing',
                    message: manualMessage,
                    detail: kavitaDataMount ?? null,
                });
                invokeWizard(
                    'recordRavenDetail',
                    {
                        detection: {
                            status: kavitaDataMount ? 'detected' : 'not-found',
                            message: manualMessage,
                            mountPath: kavitaDataMount ?? null,
                            updatedAt: timestamp(),
                        },
                        message: manualMessage,
                    },
                    {status: 'in-progress', error: null},
                );
            }
        }

        serviceDescriptor = applyEnvOverrides(serviceDescriptor, normalizedOverrides);

        if (descriptor.name === 'noona-raven') {
            launchStartedAt = timestamp();
            invokeWizard(
                'recordRavenDetail',
                {
                    launch: {
                        status: 'launching',
                        startedAt: launchStartedAt,
                        completedAt: null,
                        error: null,
                    },
                    message: 'Requesting Raven installation…',
                },
                {status: 'in-progress', error: null},
            );
        }

        appendHistoryEntry(descriptor.name, {
            type: 'status',
            status: 'pending',
            message: 'Starting installation',
            detail: null,
        });

        try {
            const recreate = normalizedOverrides && Object.keys(normalizedOverrides).length > 0;
            await api.startService(serviceDescriptor, healthUrl, {
                recreate,
                installOverridesByName,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendHistoryEntry(descriptor.name, {
                type: 'error',
                status: 'error',
                message: 'Installation failed',
                detail: message,
                error: message,
            });
            if (descriptor.name === 'noona-raven') {
                const failureMessage = message;
                invokeWizard(
                    'recordRavenDetail',
                    {
                        launch: {
                            status: 'error',
                            startedAt: launchStartedAt ?? timestamp(),
                            completedAt: null,
                            error: failureMessage,
                        },
                        message: failureMessage,
                    },
                    {status: 'error', error: failureMessage},
                );
            }
            throw error;
        }

        const result = {
            name: descriptor.name,
            category,
            status: 'installed',
            hostServiceUrl: api.resolveHostServiceUrl(serviceDescriptor),
            image: descriptor.image,
            port: serviceDescriptor.port ?? null,
            required: requiredServiceSet.has(descriptor.name),
        };

        const nextRuntime = writeRuntimeConfig(descriptor.name, {
            env: normalizedOverrides,
            hostPort: runtime.hostPort,
        });
        await persistServiceRuntimeConfig(descriptor.name, nextRuntime);

        if (descriptor.name === 'noona-raven') {
            result.kavitaDataMount = kavitaDataMount;
            result.kavitaDetection = kavitaDetection;
            const completedAt = timestamp();
            appendHistoryEntry(descriptor.name, {
                type: 'status',
                status: 'installed',
                message: kavitaDetection
                    ? `Kavita data mount detected at ${kavitaDetection.mountPath}`
                    : 'Kavita data mount not detected automatically',
                detail: kavitaDetection?.mountPath ?? null,
            });
            invokeWizard(
                'recordRavenDetail',
                {
                    launch: {
                        status: 'launched',
                        startedAt: launchStartedAt ?? completedAt,
                        completedAt,
                        error: null,
                    },
                    message: 'Raven installation requested.',
                },
                {status: 'in-progress', error: null},
            );
        }

        return result;
    };

    api.installService = async function installService(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();

        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const {prioritized, overridesByName} = buildInstallationList([trimmedName]);
        const order = resolveInstallOrder(prioritized);
        resetInstallationTracking(order);

        if (order.length > 0) {
            appendHistoryEntry(
                INSTALLATION_SERVICE,
                {
                    type: 'status',
                    status: 'installing',
                    message: `Installing ${order.join(', ')}`,
                    detail: null,
                    clearError: true,
                },
                {mirrorToInstallation: false},
            );
        }
        const attempted = new Set();
        let targetResult = null;

        for (let index = 0; index < order.length; index += 1) {
            const serviceName = order[index];
            if (attempted.has(serviceName)) {
                continue;
            }

            attempted.add(serviceName);
            let overrides = overridesByName.get(serviceName) || null;

            if (serviceNeedsManagedKavitaProvisioning(serviceName, {envOverrides: overrides})) {
                await api.ensureManagedKavitaAccess({
                    targetServices: [serviceName],
                    installOverridesByName: overridesByName,
                });
                overrides = overridesByName.get(serviceName) || null;
            }

            const result = await installSingleServiceByName(serviceName, overrides, {
                installOverridesByName: overridesByName,
            });

            if (serviceName === MANAGED_KAVITA_SERVICE_NAME) {
                const remainingTargets = order.slice(index + 1).filter((candidate) =>
                    serviceNeedsManagedKavitaProvisioning(candidate, {
                        envOverrides: overridesByName.get(candidate) || null,
                    }),
                );

                if (remainingTargets.length > 0) {
                    await api.ensureManagedKavitaAccess({
                        targetServices: remainingTargets,
                        installOverridesByName: overridesByName,
                    });
                }
            }

            if (serviceName === trimmedName) {
                targetResult = result;
            }
        }

        appendHistoryEntry(
            INSTALLATION_SERVICE,
            {
                type: 'status',
                status: targetResult ? 'complete' : 'error',
                message: targetResult
                    ? `Installation complete for ${trimmedName}`
                    : `Installation failed for ${trimmedName}`,
                detail: targetResult?.status === 'installed' ? 'installed' : null,
            },
            {mirrorToInstallation: false},
        );

        const hasErrors = !targetResult || targetResult.status === 'error';
        invokeWizard('completeInstall', {hasErrors});

        if (!targetResult) {
            throw new Error(`Service ${trimmedName} is not registered with Warden.`);
        }

        return targetResult;
    };

    api.installServices = async function installServices(names = []) {
        const {prioritized, invalidEntries, overridesByName} = buildInstallationList(names);
        const results = [];
        let order;

        try {
            order = resolveInstallOrder(prioritized);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            appendHistoryEntry(
                INSTALLATION_SERVICE,
                {
                    type: 'error',
                    status: 'error',
                    message: 'Failed to resolve installation order',
                    detail: message,
                    error: message,
                },
                {mirrorToInstallation: false},
            );
            return [
                ...results,
                ...invalidEntries,
                {
                    name: 'installation',
                    status: 'error',
                    error: message,
                },
            ];
        }

        resetInstallationTracking(order);

        if (order.length > 0) {
            appendHistoryEntry(
                INSTALLATION_SERVICE,
                {
                    type: 'status',
                    status: 'installing',
                    message: `Installing ${order.join(', ')}`,
                    detail: null,
                    clearError: true,
                },
                {mirrorToInstallation: false},
            );
        }

        const attempted = new Set();

        for (let index = 0; index < order.length; index += 1) {
            const serviceName = order[index];
            if (attempted.has(serviceName)) {
                continue;
            }

            attempted.add(serviceName);

            try {
                let overrides = overridesByName.get(serviceName) || null;

                if (serviceNeedsManagedKavitaProvisioning(serviceName, {envOverrides: overrides})) {
                    await api.ensureManagedKavitaAccess({
                        targetServices: [serviceName],
                        installOverridesByName: overridesByName,
                    });
                    overrides = overridesByName.get(serviceName) || null;
                }

                const result = await installSingleServiceByName(serviceName, overrides, {
                    installOverridesByName: overridesByName,
                });

                if (serviceName === MANAGED_KAVITA_SERVICE_NAME) {
                    const remainingTargets = order.slice(index + 1).filter((candidate) =>
                        serviceNeedsManagedKavitaProvisioning(candidate, {
                            envOverrides: overridesByName.get(candidate) || null,
                        }),
                    );

                    if (remainingTargets.length > 0) {
                        await api.ensureManagedKavitaAccess({
                            targetServices: remainingTargets,
                            installOverridesByName: overridesByName,
                        });
                    }
                }

                results.push(result);
            } catch (error) {
                results.push({
                    name: serviceName,
                    status: 'error',
                    error: error.message,
                });
            }
        }

        const hasErrors = results.some((entry) => entry.status === 'error');
        appendHistoryEntry(
            INSTALLATION_SERVICE,
            {
                type: 'status',
                status: hasErrors ? 'error' : 'complete',
                message: hasErrors
                    ? 'Installation finished with errors'
                    : 'Installation complete',
                detail: hasErrors ? 'One or more services failed to install' : null,
            },
            {mirrorToInstallation: false},
        );

        invokeWizard('completeInstall', {hasErrors});

        return [...results, ...invalidEntries];
    };

    api.getInstallationProgress = function getInstallationProgress() {
        return getInstallationProgressSnapshot();
    };

    api.getServiceHistory = function getServiceHistory(name, options = {}) {
        const serviceName = typeof name === 'string' ? name.trim() : '';

        if (!serviceName) {
            return {
                service: name ?? null,
                entries: [],
                summary: {
                    status: 'idle',
                    percent: null,
                    detail: null,
                    updatedAt: null,
                },
            };
        }

        const history = ensureHistory(serviceName);
        const limit = parsePositiveLimit(options.limit);
        const sliceSource = limit
            ? history.entries.slice(-limit)
            : history.entries.slice();
        const entries = sliceSource.map((entry) => ({...entry}));
        const summary = history.summary
            ? {...history.summary}
            : {
                status: 'idle',
                percent: null,
                detail: null,
                updatedAt: null,
            };

        return {
            service: serviceName,
            entries,
            summary,
        };
    };

    api.getServiceConfig = function getServiceConfig(name) {
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

        const {descriptor} = buildEffectiveServiceDescriptor(trimmedName);
        const runtime = resolveRuntimeConfig(trimmedName);
        const env = parseEnvEntries(descriptor.env);
        if (trimmedName === MANAGED_KAVITA_KOMF_SERVICE_NAME) {
            env[MANAGED_KOMF_CONFIG_ENV_KEY] =
                readManagedKomfConfigFile?.() ??
                normalizeManagedKomfConfigContent(env[MANAGED_KOMF_CONFIG_ENV_KEY] ?? DEFAULT_MANAGED_KOMF_APPLICATION_YML);
        }

        return {
            name: descriptor.name,
            image: descriptor.image ?? null,
            port: descriptor.port ?? null,
            internalPort: descriptor.internalPort ?? descriptor.port ?? null,
            hostServiceUrl: api.resolveHostServiceUrl(descriptor),
            description: descriptor.description ?? null,
            health: descriptor.health ?? null,
            env,
            envConfig: cloneEnvConfig(descriptor.envConfig),
            runtimeConfig: {
                hostPort: runtime.hostPort,
                env: runtime.env,
            },
        };
    };

    api.updateServiceConfig = async function updateServiceConfig(name, updates = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        if (!serviceCatalog.has(trimmedName)) {
            throw new Error(`Service ${trimmedName} is not registered with Warden.`);
        }

        const runtime = resolveRuntimeConfig(trimmedName);
        const nextRuntime = {
            env: {...runtime.env},
            hostPort: runtime.hostPort,
        };

        if (Object.prototype.hasOwnProperty.call(updates ?? {}, 'env')) {
            nextRuntime.env = normalizeEnvOverrideMap(updates?.env);
        }

        if (Object.prototype.hasOwnProperty.call(updates ?? {}, 'hostPort')) {
            const parsedHostPort = normalizeHostPort(updates?.hostPort);
            if (updates?.hostPort != null && parsedHostPort == null) {
                throw new Error('hostPort must be a valid TCP port between 1 and 65535.');
            }
            nextRuntime.hostPort = parsedHostPort;
        }

        await persistServiceRuntimeConfig(trimmedName, nextRuntime);
        writeRuntimeConfig(trimmedName, nextRuntime);

        const restart = updates?.restart === true;
        let restartResult = null;
        if (restart) {
            restartResult = await api.restartService(trimmedName);
        }

        return {
            service: api.getServiceConfig(trimmedName),
            restarted: Boolean(restartResult),
        };
    };

    api.restartService = async function restartService(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const {descriptor} = buildEffectiveServiceDescriptor(trimmedName);
        await api.startService(descriptor, descriptor.health || null, {recreate: true});

        return {
            service: trimmedName,
            status: 'restarted',
            hostServiceUrl: api.resolveHostServiceUrl(descriptor),
        };
    };

    api.stopService = async function stopService(name, options = {}) {
        if (!name || typeof name !== 'string') {
            throw new Error('Service name must be a non-empty string.');
        }

        const trimmedName = name.trim();
        if (!trimmedName) {
            throw new Error('Service name must be a non-empty string.');
        }

        const removeContainer = options.remove === true;
        const dockerClient = await ensureDockerConnection();
        const matches = await findMatchingContainersByName(trimmedName, dockerClient);

        if (matches.length === 0) {
            trackedContainers.delete(trimmedName);
            return {
                service: trimmedName,
                stopped: false,
                removed: false,
                reason: 'not-running',
            };
        }

        if (removeContainer && typeof dockerUtils.removeContainers === 'function') {
            await dockerUtils.removeContainers(trimmedName, {dockerInstance: dockerClient});
        } else {
            for (const match of matches) {
                const containerId = match?.Id || trimmedName;
                const container = dockerClient.getContainer(containerId);
                try {
                    await container.stop();
                } catch (error) {
                    const statusCode = Number(error?.statusCode);
                    if (statusCode !== 304 && statusCode !== 404) {
                        throw error;
                    }
                }

                if (removeContainer) {
                    try {
                        await container.remove({force: true});
                    } catch (error) {
                        const statusCode = Number(error?.statusCode);
                        if (statusCode !== 304 && statusCode !== 404) {
                            throw error;
                        }
                    }
                }
            }
        }

        trackedContainers.delete(trimmedName);
        appendHistoryEntry(trimmedName, {
            type: 'status',
            status: 'stopped',
            message: removeContainer ? 'Service stopped and removed.' : 'Service stopped.',
            detail: null,
            clearError: true,
        });

        return {
            service: trimmedName,
            stopped: true,
            removed: removeContainer,
            reason: null,
        };
    };

    api.stopEcosystem = async function stopEcosystem(options = {}) {
        const includeTrackedOnly = options?.trackedOnly === true;
        const removeContainersOnStop = options?.remove === true;
        const onResult = typeof options?.onResult === 'function' ? options.onResult : null;
        let names = includeTrackedOnly
            ? Array.from(trackedContainers)
            : [];

        if (!includeTrackedOnly) {
            let dockerClient = null;
            try {
                dockerClient = await ensureDockerConnection();
            } catch (error) {
                markDockerConnectionStale(error);
            }

            const managedServices = await resolveManagedLifecycleServices({
                dockerClient,
                fallbackToAll: true,
            }).catch(() => []);
            const installedManagedServices = dockerClient
                ? await listInstalledManagedServiceNames(dockerClient).catch(() => [])
                : [];

            names = Array.from(new Set([
                ...managedServices,
                ...installedManagedServices,
                ...Array.from(trackedContainers),
            ]));
        }

        const normalizedNames = names
            .filter((name) => typeof name === 'string' && name.trim())
            .map((name) => name.trim());
        const stopOrder = includeTrackedOnly
            ? normalizedNames
            : [...normalizedNames].reverse();

        const results = [];

        for (const service of stopOrder) {
            let result;
            try {
                result = await api.stopService(service, {remove: removeContainersOnStop});
            } catch (error) {
                markDockerConnectionStale(error);
                const message = error instanceof Error ? error.message : String(error);
                result = {
                    service,
                    stopped: false,
                    removed: false,
                    reason: message,
                    error: message,
                };
            }

            results.push(result);

            if (onResult) {
                await onResult(result);
            }
        }

        return results;
    };

    api.restartEcosystem = async function restartEcosystem(options = {}) {
        const stopResults = await api.stopEcosystem({...options, trackedOnly: false, remove: false});
        const startResults = await api.startEcosystem(options);

        return {
            stopped: stopResults,
            started: startResults,
        };
    };

    api.factoryResetEcosystem = async function factoryResetEcosystem(options = {}) {
        const deleteRavenDownloadsRequested = options?.deleteRavenDownloads === true;
        const deleteDockersRequested = options?.deleteDockers === true;
        const dockerClient = await ensureDockerConnection();

        let ravenMounts = [];
        if (deleteRavenDownloadsRequested) {
            try {
                ravenMounts = await collectRavenDownloadMounts(dockerClient);
            } catch (error) {
                logger.warn?.(
                    `[${serviceName}] Failed to inspect Raven mounts during factory reset: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        const stopped = await api.stopEcosystem({
            trackedOnly: false,
            remove: true,
        });

        const ravenDownloads = deleteRavenDownloadsRequested
            ? await deleteRavenDownloads(dockerClient, ravenMounts)
            : {
                requested: false,
                mountCount: 0,
                entries: [],
                deleted: false,
            };

        const dockerCleanup = deleteDockersRequested
            ? await removeNoonaDockerArtifacts(dockerClient)
            : {
                requested: false,
                containersRemoved: [],
                imagesRemoved: [],
                containerErrors: [],
                imageErrors: [],
            };

        const started = await api.startEcosystem({
            setupCompleted: false,
            forceFull: false,
        });

        return {
            ok: true,
            stopped,
            ravenDownloads,
            dockerCleanup,
            started,
        };
    };
}

export default registerServiceManagementApi;
