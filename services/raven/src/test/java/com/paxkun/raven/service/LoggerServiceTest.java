package com.paxkun.raven.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import java.io.IOException;
import java.nio.file.AccessDeniedException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
class LoggerServiceTest {

    @Test
    void initializesWithContainerFallbackWhenAccessDenied(CapturedOutput output) throws IOException {
        Path containerFallback = Files.createTempDirectory("logger-service");

        LoggerService service = new LoggerService() {
            private int attempts = 0;

            @Override
            protected Path resolveAppDataDownloadsPath() {
                return Path.of("/denied/appdata");
            }

            @Override
            protected Path resolveUserHomeDownloadsPath() {
                return Path.of("/denied/userhome");
            }

            @Override
            protected Path resolveContainerFallbackPath() {
                return containerFallback;
            }

            @Override
            protected Path createDirectories(Path path) throws IOException {
                attempts++;
                if (attempts <= 2) {
                    throw new AccessDeniedException(path.toString());
                }
                return Files.createDirectories(path);
            }
        };

        service.afterPropertiesSet();

        assertThat(service.getDownloadsRoot()).isEqualTo(containerFallback);
        assertThat(output).contains("⚠️ Failed to create APPDATA downloads directory");
    }
}

