/**
 * Bootstraps the Raven Spring application and worker-mode exit path.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/RavenWorkerLauncher.java
 * - src/test/java/com/paxkun/raven/RavenApplicationTests.java
 * Times this file has been edited: 3
 */
package com.paxkun.raven;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * 🦅 Raven Application Entry Point
 *
 * The main Spring Boot application class for Raven Downloader and Library Manager.
 */
@SpringBootApplication
public class RavenApplication {
    /**
     * Handles main.
     *
     * @param args The application arguments.
     */

    public static void main(String[] args) {
        ConfigurableApplicationContext context = SpringApplication.run(RavenApplication.class, args);
        boolean workerMode = context.getEnvironment().getProperty("raven.worker.mode", Boolean.class, false);
        if (workerMode) {
            int exitCode = SpringApplication.exit(context);
            System.exit(exitCode);
        }
    }
}
