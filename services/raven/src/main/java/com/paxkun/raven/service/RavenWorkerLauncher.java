/**
 * Launches Raven process-mode download workers.
 * Related files:
 * - src/main/java/com/paxkun/raven/RavenApplication.java
 * - src/test/java/com/paxkun/raven/service/RavenWorkerLauncherTest.java
 * Times this file has been edited: 2
 */
package com.paxkun.raven.service;

import com.paxkun.raven.RavenApplication;
import org.springframework.stereotype.Component;

import java.io.File;
import java.net.URISyntaxException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Builds and launches child Raven worker JVMs.
 */
@Component
public class RavenWorkerLauncher {

    /**
     * Handles launch.
     *
     * @param request The request payload.
     * @return The resulting Process.
     */

    public Process launch(WorkerLaunchRequest request) throws Exception {
        List<String> command = buildCommand(request, resolveEnvironment());
        ProcessBuilder processBuilder = new ProcessBuilder(command);
        processBuilder.directory(new File(System.getProperty("user.dir", ".")));
        processBuilder.redirectInput(ProcessBuilder.Redirect.INHERIT);
        processBuilder.redirectOutput(ProcessBuilder.Redirect.INHERIT);
        processBuilder.redirectError(ProcessBuilder.Redirect.INHERIT);
        return processBuilder.start();
    }

    List<String> buildCommand(WorkerLaunchRequest request, JavaLaunchEnvironment environment) {
        List<String> command = new ArrayList<>();
        command.add(environment.javaExecutable());

        boolean packagedJar = environment.codeSourcePath() != null
                && environment.codeSourcePath().toLowerCase(java.util.Locale.ROOT).endsWith(".jar");
        if (packagedJar) {
            command.add("-jar");
            command.add(environment.codeSourcePath());
        } else {
            command.add("-cp");
            command.add(environment.classPath());
            command.add(environment.mainClassName());
        }

        command.add("--spring.main.web-application-type=none");
        command.add("--raven.worker.mode=true");
        command.add("--raven.worker.task-id=" + request.taskId());
        command.add("--raven.worker.index=" + request.workerIndex());
        command.add("--raven.worker.cpu-core-id=" + request.cpuCoreId());
        command.add("--raven.worker.execution-mode=" + request.executionMode());
        return command;
    }

    JavaLaunchEnvironment resolveEnvironment() {
        String javaHome = System.getProperty("java.home", "");
        String javaExecutable = javaHome == null || javaHome.isBlank()
                ? "java"
                : Path.of(javaHome, "bin", "java").toString();
        String classPath = System.getProperty("java.class.path", "");
        String mainClassName = RavenApplication.class.getName();
        String codeSourcePath = null;
        try {
            if (RavenApplication.class.getProtectionDomain() != null
                    && RavenApplication.class.getProtectionDomain().getCodeSource() != null
                    && RavenApplication.class.getProtectionDomain().getCodeSource().getLocation() != null) {
                codeSourcePath = Path.of(RavenApplication.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toString();
            }
        } catch (URISyntaxException ignored) {
            codeSourcePath = null;
        }

        return new JavaLaunchEnvironment(javaExecutable, classPath, codeSourcePath, mainClassName);
    }

    /**
     * Launches Raven process-mode download workers.
     *
     * @param taskId The Raven task id.
     * @param workerIndex The worker index.
     * @param cpuCoreId The CPU core id.
     * @param executionMode The worker execution mode.
     */

    public record WorkerLaunchRequest(String taskId, int workerIndex, int cpuCoreId, String executionMode) {
    }

    /**
     * Launches Raven process-mode download workers.
     *
     * @param javaExecutable The java executable.
     * @param classPath The class path.
     * @param codeSourcePath The code source path.
     * @param mainClassName The main class name.
     */

    record JavaLaunchEnvironment(
            String javaExecutable,
            String classPath,
            String codeSourcePath,
            String mainClassName
    ) {
    }
}
