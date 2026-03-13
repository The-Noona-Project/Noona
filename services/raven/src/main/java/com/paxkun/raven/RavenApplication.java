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
    public static void main(String[] args) {
        ConfigurableApplicationContext context = SpringApplication.run(RavenApplication.class, args);
        boolean workerMode = context.getEnvironment().getProperty("raven.worker.mode", Boolean.class, false);
        if (workerMode) {
            int exitCode = SpringApplication.exit(context);
            System.exit(exitCode);
        }
    }
}
