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
        networkName,
        normalizeHostPort,
        orderServicesForLifecycle,
        parseEnvEntries,
        processExit,
        requiredServiceSet,
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

        await api.startService(sage, 'http://noona-sage:3004/health');
        await api.startService(moon, moonHealthUrl);
    };

    const startServiceForBoot = async (name) => {
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

        await api.startService(svc, healthUrl);
    };

    const startServicesForBoot = async (names = []) => {
        for (const name of names) {
            await startServiceForBoot(name);
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
            const firstBootstrapOverrideIndex = bootstrapTargetNames.findIndex((name) =>
                loadedConfigs.some((entry) => entry?.service === name),
            );
            if (firstBootstrapOverrideIndex >= 0) {
                const bootstrapRestartNames = bootstrapTargetNames.slice(firstBootstrapOverrideIndex);
                for (const name of bootstrapRestartNames) {
                    await api.restartService(name);
                }
            }

            await startServicesForBoot(bootstrapTargetNames.length > 0 ? managedTargetNames : targetNames);
            return;
        }

        await startServicesForBoot(targetNames);
    };

    api.startEcosystem = async function startEcosystem(options = {}) {
        const setupCompleted = options?.setupCompleted === true
            ? true
            : options?.setupCompleted === false
                ? false
                : await api.isSetupCompleted();
        const shouldBootFull = options?.forceFull === true || SUPER_MODE || setupCompleted;

        if (shouldBootFull) {
            const dockerClient = await ensureDockerConnection().catch(() => null);
            const services = Array.isArray(options?.services)
                ? options.services
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
        const shouldBootFull = SUPER_MODE || setupCompleted;

        if (shouldBootFull) {
            if (SUPER_MODE) {
                logger.log('[Warden] 💥 DEBUG=super — launching full stack in superBootOrder...');
            } else {
                logger.log('[Warden] Setup marked complete — launching configured services.');
            }
            const services = await resolveManagedLifecycleServices({dockerClient});
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
