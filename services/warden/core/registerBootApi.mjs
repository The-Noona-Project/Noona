// services/warden/core/registerBootApi.mjs

export function registerBootApi(context = {}) {
    const {
        api,
        bootOrder,
        buildEffectiveServiceDescriptor,
        dataNetworkName,
        dockerUtils,
        env = process.env,
        ensureDockerConnection,
        isPersistedServiceRuntimeConfigLoaded,
        loadPersistedServiceRuntimeConfig,
        logger,
        minimalServiceNames = [],
        networkName,
        normalizeHostPort,
        orderServicesForLifecycle,
        parseEnvEntries,
        processExit,
        requiredServiceSet,
        resolveCurrentAutoUpdatesEnabled,
        resolveManagedLifecycleServices,
        resolvePersistedSetupSelectionState,
        serviceCatalog,
        sleepImpl,
        startServiceUpdateTimer,
        stopServiceUpdateTimer,
        SUPER_MODE,
        trackedContainers,
    } = context;
    const PERSISTED_CONFIG_BOOT_RETRY_ATTEMPTS = 6;
    const PERSISTED_CONFIG_BOOT_RETRY_DELAY_MS = 1500;

    const persistedServiceRuntimeConfigLoadedState = {
        get value() {
            return isPersistedServiceRuntimeConfigLoaded();
        },
    };

    const autoUpdatesEnabled = () =>
        typeof resolveCurrentAutoUpdatesEnabled === 'function' ? resolveCurrentAutoUpdatesEnabled() === true : false;
    const minimalServiceSet = new Set(
        (Array.isArray(minimalServiceNames) && minimalServiceNames.length > 0
            ? minimalServiceNames
            : ['noona-sage', 'noona-moon'])
            .filter((name) => typeof name === 'string' && name.trim()),
    );

    const resolveInstalledLifecycleServices = async (dockerClient = null) => {
        if (typeof resolveManagedLifecycleServices !== 'function') {
            return [];
        }

        try {
            const resolved = await resolveManagedLifecycleServices({
                dockerClient,
                fallbackToAll: false,
            });
            return Array.isArray(resolved) ? resolved : [];
        } catch {
            return [];
        }
    };

    const shouldRestoreManagedLifecycle = (names = []) =>
        Array.isArray(names) &&
        names.some((name) => typeof name === 'string' && !minimalServiceSet.has(name));

    const waitForPersistedRuntimeConfigLoad = async (managedTargetNames = [], loadedConfigs = []) => {
        let currentConfigs = Array.isArray(loadedConfigs) ? loadedConfigs : [];
        if (
            persistedServiceRuntimeConfigLoadedState.value
            || !Array.isArray(managedTargetNames)
            || managedTargetNames.length === 0
            || typeof loadPersistedServiceRuntimeConfig !== 'function'
        ) {
            return currentConfigs;
        }

        for (let attempt = 1; attempt <= PERSISTED_CONFIG_BOOT_RETRY_ATTEMPTS; attempt += 1) {
            logger.warn(
                `[Warden] Persisted service config is not ready after bootstrap startup; retrying ${attempt}/${PERSISTED_CONFIG_BOOT_RETRY_ATTEMPTS} before starting managed services.`,
            );
            await Promise.resolve(
                typeof sleepImpl === 'function'
                    ? sleepImpl(PERSISTED_CONFIG_BOOT_RETRY_DELAY_MS)
                    : null,
            );
            currentConfigs = await loadPersistedServiceRuntimeConfig();
            if (persistedServiceRuntimeConfigLoadedState.value) {
                break;
            }
        }

        if (!persistedServiceRuntimeConfigLoadedState.value) {
            const fallbackServices = currentConfigs
                .map((entry) => (typeof entry?.service === 'string' ? entry.service.trim() : ''))
                .filter(Boolean);
            logger.warn(
                fallbackServices.length > 0
                    ? `[Warden] Proceeding with local runtime config fallback for ${fallbackServices.join(', ')} because Vault-backed settings are still unavailable.`
                    : '[Warden] Proceeding without restored managed runtime config because Vault-backed settings are still unavailable.',
            );
        }

        return currentConfigs;
    };

    const runStartupAutoUpdates = async (names = [], options = {}) => {
        const restart = options?.restart !== false;
        const uniqueNames = Array.from(
            new Set(
                names.filter((name) => typeof name === 'string' && serviceCatalog.has(name)),
            ),
        );

        if (uniqueNames.length === 0 || typeof api.updateServiceImage !== 'function') {
            return [];
        }

        logger.log(
            `[Warden] AUTO_UPDATES enabled — checking ${uniqueNames.length} startup service image${uniqueNames.length === 1 ? '' : 's'}.`,
        );

        const results = [];
        for (const name of uniqueNames) {
            try {
                const result = await api.updateServiceImage(name, {restart});
                results.push(result);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`[Warden] Failed to auto-update ${name} during startup: ${message}`);
                results.push({
                    service: name,
                    updated: false,
                    restarted: false,
                    installed: false,
                    error: message,
                });
            }
        }

        return results;
    };

    const collectUpdatedInstalledServiceNames = (results = []) =>
        new Set(
            results
                .filter((entry) => entry?.updated === true && entry?.installed === true)
                .map((entry) => (typeof entry?.service === 'string' ? entry.service.trim() : ''))
                .filter((name) => Boolean(name) && serviceCatalog.has(name)),
        );

    const resolveBootHealthTarget = (service) => {
        if (!service || typeof service !== 'object') {
            return null;
        }

        if (service.healthCheck || service.health) {
            return service.healthCheck || service.health || null;
        }

        if (service.name === 'noona-sage') {
            const sagePort = normalizeHostPort(service.internalPort || service.port || 3004);
            return sagePort == null ? null : `http://${service.name}:${sagePort}/health`;
        }

        if (service.name === 'noona-moon') {
            const moonEnv = parseEnvEntries(service.env);
            const moonPort = normalizeHostPort(service.internalPort || service.port || moonEnv.WEBGUI_PORT || 3000);
            return moonPort == null ? null : `http://${service.name}:${moonPort}/`;
        }

        return null;
    };

    api.bootMinimal = async function bootMinimal() {
        const moon = buildEffectiveServiceDescriptor('noona-moon').descriptor;
        const sage = buildEffectiveServiceDescriptor('noona-sage').descriptor;
        const moonHealthUrl = resolveBootHealthTarget(moon);

        if (autoUpdatesEnabled()) {
            await runStartupAutoUpdates(['noona-sage', 'noona-moon'], {restart: true});
        }

        await api.startService(sage, resolveBootHealthTarget(sage));
        await api.startService(moon, moonHealthUrl);
    };

    const startServiceForBoot = async (name, options = {}) => {
        if (!serviceCatalog.has(name)) {
            return;
        }

        const svc = buildEffectiveServiceDescriptor(name).descriptor;
        await api.startService(svc, resolveBootHealthTarget(svc), {
            recreate: options?.recreate === true,
            reuseStoppedContainer: true,
        });
    };

    const startServicesForBoot = async (names = [], options = {}) => {
        const forceRecreateNames =
            options?.forceRecreateNames instanceof Set ? options.forceRecreateNames : new Set();

        for (let index = 0; index < names.length; index += 1) {
            const name = names[index];
            await startServiceForBoot(name, {
                recreate: forceRecreateNames.has(name),
            });

            if (name === 'noona-kavita' && typeof api.ensureManagedKavitaAccess === 'function') {
                const remainingTargets = names.slice(index + 1).filter((candidate) =>
                    typeof api.needsManagedKavitaProvisioning === 'function'
                        ? api.needsManagedKavitaProvisioning(candidate)
                        : false,
                );

                if (remainingTargets.length > 0) {
                    const provisioning = await api.ensureManagedKavitaAccess({
                        targetServices: remainingTargets,
                        allowRegister: false,
                        failOnError: false,
                    });

                    if (provisioning?.skipped !== true && Array.isArray(provisioning?.configuredServices)) {
                        for (const configuredService of provisioning.configuredServices) {
                            if (typeof configuredService === 'string' && configuredService.trim()) {
                                forceRecreateNames.add(configuredService);
                            }
                        }
                    }
                }
            }
        }
    };

    api.bootFull = async function bootFull(options = {}) {
        const targetNames = Array.isArray(options?.services) && options.services.length > 0
            ? orderServicesForLifecycle(options.services)
            : orderServicesForLifecycle(bootOrder);
        const bootstrapTargetNames = targetNames.filter((name) => requiredServiceSet.has(name));
        const managedTargetNames = targetNames.filter((name) => !requiredServiceSet.has(name));

        if (!persistedServiceRuntimeConfigLoadedState.value) {
            if (bootstrapTargetNames.length > 0) {
                await startServicesForBoot(bootstrapTargetNames);
            }

            const loadedConfigs = await waitForPersistedRuntimeConfigLoad(
                bootstrapTargetNames.length > 0 ? managedTargetNames : targetNames,
                await loadPersistedServiceRuntimeConfig(),
            );
            const bootstrapConfigOverrides = new Set(
                loadedConfigs
                    .map((entry) => entry?.service)
                    .filter((name) => bootstrapTargetNames.includes(name)),
            );
            let bootstrapUpdateResults = [];
            let deferredManagedRecreateNames = new Set();

            if (autoUpdatesEnabled()) {
                if (bootstrapTargetNames.length > 0) {
                    bootstrapUpdateResults = await runStartupAutoUpdates(bootstrapTargetNames, {restart: false});
                }

                const managedUpdateResults = await runStartupAutoUpdates(
                    bootstrapTargetNames.length > 0 ? managedTargetNames : targetNames,
                    {restart: false},
                );
                deferredManagedRecreateNames = collectUpdatedInstalledServiceNames(managedUpdateResults);
            }

            const bootstrapUpdatesRequiringRestart = new Set(
                bootstrapUpdateResults
                    .filter((entry) => entry?.updated === true && entry?.installed === true)
                    .map((entry) => entry.service)
                    .filter(Boolean),
            );
            const firstBootstrapRestartIndex = bootstrapTargetNames.findIndex((name) =>
                bootstrapConfigOverrides.has(name) || bootstrapUpdatesRequiringRestart.has(name),
            );
            if (firstBootstrapRestartIndex >= 0) {
                const bootstrapRestartNames = bootstrapTargetNames.slice(firstBootstrapRestartIndex);
                for (const name of bootstrapRestartNames) {
                    await api.restartService(name);
                }
            }

            await startServicesForBoot(bootstrapTargetNames.length > 0 ? managedTargetNames : targetNames, {
                forceRecreateNames: deferredManagedRecreateNames,
            });
            return;
        }

        let deferredRecreateNames = new Set();
        if (autoUpdatesEnabled()) {
            const updateResults = await runStartupAutoUpdates(targetNames, {restart: false});
            deferredRecreateNames = collectUpdatedInstalledServiceNames(updateResults);
        }

        await startServicesForBoot(targetNames, {
            forceRecreateNames: deferredRecreateNames,
        });
    };

    api.startEcosystem = async function startEcosystem(options = {}) {
        const persistedSelectionState =
            !Array.isArray(options?.services) && typeof resolvePersistedSetupSelectionState === 'function'
                ? await resolvePersistedSetupSelectionState().catch(() => ({
                    mode: 'unspecified',
                    selected: [],
                    explicit: false,
                }))
                : {mode: 'unspecified', selected: [], explicit: false};
        const setupCompleted = options?.setupCompleted === true
            ? true
            : options?.setupCompleted === false
                ? false
                : await api.isSetupCompleted();
        let dockerClient = null;
        let detectedServices = [];
        let shouldBootFull =
            options?.forceMinimal === true
                ? false
                : persistedSelectionState?.mode === 'minimal'
                    ? false
                    : options?.forceFull === true || SUPER_MODE || setupCompleted;

        if (
            !shouldBootFull
            && !Array.isArray(options?.services)
            && options?.forceMinimal !== true
            && persistedSelectionState?.mode !== 'minimal'
        ) {
            if (typeof resolveManagedLifecycleServices === 'function') {
                detectedServices = await resolveManagedLifecycleServices({
                    dockerClient: null,
                    fallbackToAll: false,
                }).catch(() => []);
                shouldBootFull = shouldRestoreManagedLifecycle(detectedServices);
            }

            if (!shouldBootFull) {
                dockerClient = await ensureDockerConnection().catch(() => null);
                if (dockerClient) {
                    detectedServices = await resolveInstalledLifecycleServices(dockerClient);
                    shouldBootFull = shouldRestoreManagedLifecycle(detectedServices);
                }
            }
        }

        if (shouldBootFull) {
            const services = Array.isArray(options?.services)
                ? options.services
                : detectedServices.length > 0
                    ? detectedServices
                    : await resolveManagedLifecycleServices({dockerClient});
            await api.bootFull({services});
        } else {
            await api.bootMinimal();
        }

        return {
            mode: shouldBootFull ? 'full' : 'minimal',
            setupCompleted,
        };
    };

    api.shutdownAll = async function shutdownAll(options = {}) {
        const shouldExit = options?.exit !== false;
        const trackedOnly = options?.trackedOnly === true;
        logger.warn(`Shutting down all containers...`);
        stopServiceUpdateTimer();

        const results = await api.stopEcosystem({
            trackedOnly,
            remove: options?.remove === true,
            onResult: async (result) => {
                if (result?.stopped === true) {
                    logger.log(
                        result?.removed === true
                            ? `Stopped & removed ${result.service}`
                            : `Stopped ${result.service}`,
                    );
                } else if (result?.reason && result?.reason !== 'not-running') {
                    logger.warn(`Error stopping ${result.service}: ${result.reason}`);
                }
            },
        });

        trackedContainers.clear();

        if (shouldExit) {
            processExit(0);
        }

        return {results};
    };

    api.init = async function init() {
        const dockerClient = await ensureDockerConnection();
        await dockerUtils.ensureNetwork(dockerClient, networkName);
        await dockerUtils.ensureNetwork(dockerClient, dataNetworkName);
        await dockerUtils.attachSelfToNetwork(dockerClient, networkName, {env});

        const setupCompleted = await api.isSetupCompleted();
        const detectedServices = setupCompleted || SUPER_MODE
            ? []
            : await resolveInstalledLifecycleServices(dockerClient);
        const shouldBootFull = SUPER_MODE || (!setupCompleted && shouldRestoreManagedLifecycle(detectedServices));

        if (shouldBootFull) {
            if (SUPER_MODE) {
                logger.log('[Warden] 💥 DEBUG=super — launching full stack in superBootOrder...');
            } else {
                logger.log('[Warden] Detected installed managed services — restoring configured stack.');
            }
            const services = detectedServices.length > 0
                ? detectedServices
                : await resolveManagedLifecycleServices({dockerClient});
            await api.bootFull({services});
        } else {
            logger.log('[Warden] 🧪 Minimal mode — launching sage and moon only');
            await api.bootMinimal();
        }

        startServiceUpdateTimer();
        logger.log(`✅ Warden is ready.`);
        return {mode: shouldBootFull ? 'full' : 'minimal', setupCompleted};
    };
}

export default registerBootApi;
