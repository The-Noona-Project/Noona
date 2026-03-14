/**
 * Covers raven worker launcher behavior.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/RavenWorkerLauncher.java
 * Times this file has been edited: 2
 */
package com.paxkun.raven.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Covers raven worker launcher behavior.
 */

class RavenWorkerLauncherTest {

    private final RavenWorkerLauncher launcher = new RavenWorkerLauncher();

    @Test
    void buildCommandUsesJarLaunchModeWhenCodeSourceIsJar() {
        RavenWorkerLauncher.JavaLaunchEnvironment environment = new RavenWorkerLauncher.JavaLaunchEnvironment(
                "/usr/lib/jvm/java-21/bin/java",
                "/workspace/build/classes",
                "/workspace/raven.jar",
                "com.paxkun.raven.RavenApplication"
        );

        List<String> command = launcher.buildCommand(
                new RavenWorkerLauncher.WorkerLaunchRequest("task-1", 2, 7, "process"),
                environment
        );

        assertThat(command).containsExactly(
                "/usr/lib/jvm/java-21/bin/java",
                "-jar",
                "/workspace/raven.jar",
                "--spring.main.web-application-type=none",
                "--raven.worker.mode=true",
                "--raven.worker.task-id=task-1",
                "--raven.worker.index=2",
                "--raven.worker.cpu-core-id=7",
                "--raven.worker.execution-mode=process"
        );
    }

    @Test
    void buildCommandUsesClasspathLaunchModeWhenCodeSourceIsNotJar() {
        RavenWorkerLauncher.JavaLaunchEnvironment environment = new RavenWorkerLauncher.JavaLaunchEnvironment(
                "java",
                "/workspace/build/classes:/workspace/build/resources",
                "/workspace/build/classes",
                "com.paxkun.raven.RavenApplication"
        );

        List<String> command = launcher.buildCommand(
                new RavenWorkerLauncher.WorkerLaunchRequest("task-9", 0, -1, "process"),
                environment
        );

        assertThat(command).containsExactly(
                "java",
                "-cp",
                "/workspace/build/classes:/workspace/build/resources",
                "com.paxkun.raven.RavenApplication",
                "--spring.main.web-application-type=none",
                "--raven.worker.mode=true",
                "--raven.worker.task-id=task-9",
                "--raven.worker.index=0",
                "--raven.worker.cpu-core-id=-1",
                "--raven.worker.execution-mode=process"
        );
    }
}
