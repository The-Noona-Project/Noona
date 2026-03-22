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
        var domain = RavenApplication.class.getProtectionDomain();
        var source = domain != null ? domain.getCodeSource() : null;
        var location = source != null ? source.getLocation() : null;

        return resolveEnvironmentFromProperties(
                System.getProperty("java.home", ""),
                System.getProperty("java.class.path", ""),
                location
        );
    }

    JavaLaunchEnvironment resolveEnvironmentFromProperties(String javaHome, String classPath, java.net.URL location) {
        String javaExecutable = javaHome == null || javaHome.isBlank()
                ? "java"
                : Path.of(javaHome, "bin", "java").toString();
        String mainClassName = RavenApplication.class.getName();
        String codeSourcePath = null;
        try {
            if (location != null) {
                String uriString = location.toURI().toString();
                if (uriString.startsWith("jar:file:")) {
                    // Example: jar:file:/app/app.jar!/BOOT-INF/classes!/
                    int bangIndex = uriString.indexOf("!");
                    if (bangIndex > 0) {
                        String jarUri = uriString.substring(4, bangIndex); // "file:/app/app.jar"
                        codeSourcePath = Path.of(new java.net.URI(jarUri)).toString();
                    }
                } else if (uriString.startsWith("file:")) {
                    codeSourcePath = Path.of(location.toURI()).toString();
                }
            }
        } catch (Exception ignored) {
            // Fallback will be handled below
        }

        // Final fallback: if classPath is exactly one jar and codeSourcePath is null or doesn't end in .jar
        if ((codeSourcePath == null || !codeSourcePath.toLowerCase(java.util.Locale.ROOT).endsWith(".jar"))
                && classPath != null && !classPath.contains(File.pathSeparator) && classPath.toLowerCase(java.util.Locale.ROOT).endsWith(".jar")) {
            codeSourcePath = classPath;
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
