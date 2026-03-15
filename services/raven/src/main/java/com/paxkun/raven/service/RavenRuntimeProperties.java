/**
 * Normalizes Raven runtime and worker-mode properties.
 * Related files:
 * - None yet.
 * Times this file has been edited: 2
 */
package com.paxkun.raven.service;

import lombok.Data;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.Locale;

/**
 * Runtime switches that let Raven boot either as the main server process or as
 * a one-shot download worker child process.
 */
@Data
@Component
public class RavenRuntimeProperties {

    @Value("${raven.worker.mode:${RAVEN_WORKER_MODE:false}}")
    private boolean workerMode = false;

    @Value("${raven.worker.task-id:${RAVEN_WORKER_TASK_ID:}}")
    private String workerTaskId = "";

    @Value("${raven.worker.index:${RAVEN_WORKER_INDEX:-1}}")
    private int workerIndex = -1;

    @Value("${raven.worker.cpu-core-id:${RAVEN_WORKER_CPU_CORE_ID:-1}}")
    private int workerCpuCoreId = -1;

    @Value("${raven.worker.execution-mode:${RAVEN_WORKER_EXECUTION_MODE:process}}")
    private String workerExecutionMode = "process";

    /**
     * Indicates whether linux host.
     *
     * @return True when the condition is satisfied.
     */

    public boolean isLinuxHost() {
        String osName = System.getProperty("os.name", "");
        return osName.toLowerCase(Locale.ROOT).contains("linux");
    }

    /**
     * Handles use process workers.
     *
     * @return True when the condition is satisfied.
     */

    public boolean useProcessWorkers() {
        return !workerMode && isLinuxHost();
    }

    /**
     * Returns normalized worker task id.
     *
     * @return The resulting message or value.
     */

    public String getNormalizedWorkerTaskId() {
        return workerTaskId == null ? "" : workerTaskId.trim();
    }

    /**
     * Returns normalized worker index.
     *
     * @return The resulting count or numeric value.
     */

    public int getNormalizedWorkerIndex() {
        return Math.max(-1, workerIndex);
    }

    /**
     * Returns normalized worker cpu core id.
     *
     * @return The resulting count or numeric value.
     */

    public int getNormalizedWorkerCpuCoreId() {
        return workerCpuCoreId;
    }

    /**
     * Returns normalized worker execution mode.
     *
     * @return The resulting message or value.
     */

    public String getNormalizedWorkerExecutionMode() {
        String normalized = workerExecutionMode == null ? "" : workerExecutionMode.trim().toLowerCase(Locale.ROOT);
        return normalized.isBlank() ? "process" : normalized;
    }
}
