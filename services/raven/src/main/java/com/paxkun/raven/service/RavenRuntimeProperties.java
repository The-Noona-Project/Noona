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

    public boolean isLinuxHost() {
        String osName = System.getProperty("os.name", "");
        return osName.toLowerCase(Locale.ROOT).contains("linux");
    }

    public boolean useProcessWorkers() {
        return !workerMode && isLinuxHost();
    }

    public String getNormalizedWorkerTaskId() {
        return workerTaskId == null ? "" : workerTaskId.trim();
    }

    public int getNormalizedWorkerIndex() {
        return Math.max(-1, workerIndex);
    }

    public int getNormalizedWorkerCpuCoreId() {
        return workerCpuCoreId;
    }

    public String getNormalizedWorkerExecutionMode() {
        String normalized = workerExecutionMode == null ? "" : workerExecutionMode.trim().toLowerCase(Locale.ROOT);
        return normalized.isBlank() ? "process" : normalized;
    }
}
