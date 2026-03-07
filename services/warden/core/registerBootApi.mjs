// services/warden/core/registerBootApi.mjs

export function registerBootApi(context = {}) {
    const {
        api,
        bootOrder,
        buildEffectiveServiceDescriptor,
        dockerUtils,
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
        serviceCatalog,
        startServiceUpdateTimer,
        stopServiceUpdateTimer,
        SUPER_MODE,
        trackedContainers,
    } = context;

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

    api.bootMinimal = async function bootMinimal() {
        const moon = buildEffectiveServiceDescriptor('noona-moon').descriptor;
        const sage = buildEffectiveServiceDescriptor('noona-sage').descriptor;
        const moonHealthUrl = moon.health || (() => {
            const moonEnv = parseEnvEntries(moon.env);
            const moonPort = normalizeHostPort(moon.internalPort || moon.port || moonEnv.WEBGUI_PORT || 3000);
            if (moonPort == null) {
                return null;
            }

            return `http://${moon.name}:${moonPort}/`;
        })();

        if (autoUpdatesEnabled()) {
            await runStartupAutoUpdates(['noona-sage', 'noona-moon'], {restart: true});
        }

        await api.startService(sage, 'http://noona-sage:3004/health');
        await api.startService(moon, moonHealthUrl);
    };

    const startServiceForBoot = async (name, options = {}) => {
        if (!serviceCatalog.has(name)) {
            return;
        }

        const svc = buildEffectiveServiceDescriptor(name).descriptor;
        const healthUrl =
            name === 'noona-redis'
                ? 'http://noona-redis:8001/'
                : name === 'noona-sage'
                    ? 'http://noona-sage:3004/health'
                    : svc.health || null;

        await api.startService(svc, healthUrl, {
            recreate: options?.recreate === true,
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

            const loadedConfigs = await loadPersistedServiceRuntimeConfig();
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
        const setupCompleted = options?.setupCompleted === true
            ? true
            : options?.setupCompleted === false
                ? false
                : await api.isSetupCompleted();
        let dockerClient = null;
        let detectedServices = [];
        let shouldBootFull = options?.forceFull === true || SUPER_MODE || setupCompleted;

        if (!shouldBootFull && !Array.isArray(options?.services)) {
            dockerClient = await ensureDockerConnection().catch(() => null);
            if (dockerClient) {
                detectedServices = await resolveInstalledLifecycleServices(dockerClient);
                shouldBootFull = shouldRestoreManagedLifecycle(detectedServices);
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
        await dockerUtils.attachSelfToNetwork(dockerClient, networkName);

        const setupCompleted = await api.isSetupCompleted();
        const detectedServices = setupCompleted || SUPER_MODE
            ? []
            : await resolveInstalledLifecycleServices(dockerClient);
        const shouldBootFull = SUPER_MODE || setupCompleted || shouldRestoreManagedLifecycle(detectedServices);

        if (shouldBootFull) {
            if (SUPER_MODE) {
                logger.log('[Warden] 💥 DEBUG=super — launching full stack in superBootOrder...');
            } else if (setupCompleted) {
                logger.log('[Warden] Setup marked complete — launching configured services.');
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
