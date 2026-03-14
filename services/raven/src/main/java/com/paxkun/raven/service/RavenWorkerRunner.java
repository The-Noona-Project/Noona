/**
 * Runs a single persisted Raven task in worker mode.
 * Related files:
 * - None yet.
 * Times this file has been edited: 2
 */
package com.paxkun.raven.service;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * One-shot worker entrypoint. The main Raven server ignores this bean.
 */
@Component
public class RavenWorkerRunner implements ApplicationRunner {

    private final RavenRuntimeProperties runtimeProperties;
    private final DownloadService downloadService;
    private final LoggerService logger;
    private final LinuxCpuAffinity cpuAffinity;

    /**
     * Creates a new raven worker runner instance.
     *
     * @param runtimeProperties The runtime properties.
     * @param downloadService   The download service.
     * @param logger            The logger.
     * @param cpuAffinity       The cpu affinity.
     */

    public RavenWorkerRunner(
            RavenRuntimeProperties runtimeProperties,
            DownloadService downloadService,
            LoggerService logger,
            LinuxCpuAffinity cpuAffinity
    ) {
        this.runtimeProperties = runtimeProperties;
        this.downloadService = downloadService;
        this.logger = logger;
        this.cpuAffinity = cpuAffinity;
    }

    /**
     * Handles run.
     *
     * @param args The application arguments.
    */

    @Override
    public void run(ApplicationArguments args) {
        if (!runtimeProperties.isWorkerMode()) {
            return;
        }

        int workerIndex = runtimeProperties.getNormalizedWorkerIndex();
        int slotNumber = Math.max(0, workerIndex) + 1;
        Thread.currentThread().setName("raven-download-" + slotNumber);

        int cpuCoreId = runtimeProperties.getNormalizedWorkerCpuCoreId();
        if (cpuCoreId >= 0) {
            LinuxCpuAffinity.AffinityResult result = cpuAffinity.applyCurrentProcessAffinity(cpuCoreId);
            if (!result.applied() && result.supported()) {
                logger.warn("DOWNLOAD_WORKER", "⚠️ Failed to apply Raven CPU affinity for core "
                        + cpuCoreId + " (errno=" + result.errorCode() + ").");
            }
        }

        downloadService.runPersistedTaskInWorker(
                runtimeProperties.getNormalizedWorkerTaskId(),
                workerIndex,
                cpuCoreId,
                runtimeProperties.getNormalizedWorkerExecutionMode()
        );
    }
}
