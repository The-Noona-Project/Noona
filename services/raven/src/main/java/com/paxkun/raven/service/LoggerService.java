package com.paxkun.raven.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.Optional;
import java.util.stream.Stream;

@Slf4j
@Service
public class LoggerService implements InitializingBean {

    private static final String LATEST_LOG = "latest.log";
    private static final int MAX_LOGS = 5;
    private static final DateTimeFormatter FILE_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss");
    private static final DateTimeFormatter LOG_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private Path logsPath;
    private BufferedWriter writer;

    @Override
    public void afterPropertiesSet() {
        try {
            Path downloadsRoot = Path.of(
                    Optional.ofNullable(System.getenv("APPDATA"))
                            .orElse("/app/downloads"),
                    "Noona", "raven", "downloads"
            );

            logsPath = downloadsRoot.resolve("logs");

            if (!Files.exists(logsPath)) {
                Files.createDirectories(logsPath);
                log.info("📂 Created logs directory at {}", logsPath.toAbsolutePath());
            } else {
                log.info("📂 Logs directory already exists at {}", logsPath.toAbsolutePath());
            }

            rotateLogs();

            Path latestLogPath = logsPath.resolve(LATEST_LOG);
            writer = Files.newBufferedWriter(latestLogPath, StandardOpenOption.CREATE, StandardOpenOption.APPEND);

            logSystemEnvironment();

            log.info("📝 LoggerService initialized. Logging to {}", latestLogPath.toAbsolutePath());
        } catch (IOException e) {
            throw new RuntimeException("Failed to initialize LoggerService", e);
        }
    }

    private void rotateLogs() throws IOException {
        Path latestLog = logsPath.resolve(LATEST_LOG);
        if (Files.exists(latestLog) && Files.size(latestLog) > 0) {
            String timestamp = LocalDateTime.now().format(FILE_FORMATTER);
            Path archivedLog = logsPath.resolve(timestamp + ".log");
            Files.move(latestLog, archivedLog, StandardCopyOption.REPLACE_EXISTING);
            log.info("🔄 Rotated log to {}", archivedLog.getFileName());
        }

        try (Stream<Path> files = Files.list(logsPath)
                .filter(p -> p.getFileName().toString().endsWith(".log"))
                .filter(p -> !p.getFileName().toString().equals(LATEST_LOG))
                .sorted(Comparator.comparingLong(this::getFileModifiedTime).reversed())) {

            files.skip(MAX_LOGS - 1)
                    .forEach(p -> {
                        try {
                            Files.delete(p);
                            log.info("🗑️ Deleted old log file: {}", p.getFileName());
                        } catch (IOException e) {
                            log.warn("⚠️ Failed to delete old log file: {}", p.getFileName(), e);
                        }
                    });
        }
    }

    private long getFileModifiedTime(Path path) {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (IOException e) {
            return 0L;
        }
    }

    private String getTimestamp() {
        return LocalDateTime.now().format(LOG_FORMATTER);
    }

    private void write(String level, String tag, String message) {
        try {
            String logLine = String.format("%s [%s] [%s] %s%n", getTimestamp(), level, tag, message);
            writer.write(logLine);
            writer.flush();
            System.out.print(logLine); // also output to console
        } catch (IOException e) {
            log.error("❌ Failed to write to log file", e);
        }
    }

    public void info(String tag, String message) {
        write("INFO", tag, message);
    }

    public void warn(String tag, String message) {
        write("WARN", tag, message);
    }

    public void error(String tag, String message, Throwable throwable) {
        write("ERROR", tag, message + " | Exception: " + throwable.getMessage());
    }

    public void debug(String tag, String message) {
        write("DEBUG", tag, message);
    }

    private void logSystemEnvironment() {
        write("SYSTEM", "APPDATA", System.getenv("APPDATA"));
        write("SYSTEM", "USER", System.getProperty("user.name"));
        write("SYSTEM", "OS", System.getProperty("os.name") + " " + System.getProperty("os.version"));
    }
}
