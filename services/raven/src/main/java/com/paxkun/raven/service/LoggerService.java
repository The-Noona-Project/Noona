package com.paxkun.raven.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.stream.Stream;

@Slf4j
@Service
public class LoggerService implements InitializingBean {

    private static final String LATEST_LOG = "latest.log";
    private static final int MAX_LOGS = 5;
    private static final DateTimeFormatter FILE_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss");
    private static final DateTimeFormatter LOG_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final Path CONTAINER_FALLBACK = Path.of("/app", "downloads");

    private Path downloadsRoot;
    private Path logsPath;
    private BufferedWriter writer;

    @Override
    public void afterPropertiesSet() {
        downloadsRoot = initializeDownloadsRoot();

        if (downloadsRoot == null) {
            log.warn("⚠️ LoggerService initialized without a writable downloads root. Console output only.");
            return;
        }

        logsPath = downloadsRoot.resolve("logs");
        try {
            if (!Files.exists(logsPath)) {
                Files.createDirectories(logsPath);
                log.info("📂 Created logs directory at {}", logsPath.toAbsolutePath());
            } else {
                log.info("📂 Logs directory already exists at {}", logsPath.toAbsolutePath());
            }
        } catch (IOException e) {
            log.warn("⚠️ Failed to create logs directory at {}. LoggerService will operate in console-only mode.", logsPath.toAbsolutePath(), e);
            logsPath = null;
            writer = null;
            return;
        }

        try {
            rotateLogs();
        } catch (IOException e) {
            log.warn("⚠️ Failed to rotate logs at {}. Continuing without rotating existing logs.", logsPath.toAbsolutePath(), e);
        }

        Path latestLogPath = logsPath.resolve(LATEST_LOG);
        try {
            writer = Files.newBufferedWriter(latestLogPath, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            logSystemEnvironment();
            log.info("📝 LoggerService initialized. Logging to {}", latestLogPath.toAbsolutePath());
        } catch (IOException e) {
            log.warn("⚠️ Failed to initialize log writer at {}. LoggerService will operate in console-only mode.", latestLogPath.toAbsolutePath(), e);
            writer = null;
        }
    }

    private Path initializeDownloadsRoot() {
        Path appDataPath = resolveAppDataDownloadsPath();
        Path resolved = tryInitialize(appDataPath,
                "📁 Using APPDATA downloads root at {}",
                "⚠️ Failed to create APPDATA downloads directory at {}. Falling back to user home.");
        if (resolved != null) {
            return resolved;
        }

        Path userHomePath = resolveUserHomeDownloadsPath();
        resolved = tryInitialize(userHomePath,
                "📁 Using fallback downloads root at {}",
                "⚠️ Failed to create fallback downloads directory at {}. Falling back to container path.");
        if (resolved != null) {
            return resolved;
        }

        Path containerFallback = resolveContainerFallbackPath();
        resolved = tryInitialize(containerFallback,
                "📁 Using container downloads root at {}",
                "⚠️ Failed to create container downloads directory at {}. LoggerService will operate in console-only mode.");
        if (resolved != null) {
            return resolved;
        }

        log.warn("⚠️ Failed to determine a writable downloads root. LoggerService will operate in console-only mode.");
        return null;
    }

    private Path tryInitialize(Path path, String successMessage, String failureMessage) {
        if (path == null) {
            return null;
        }

        try {
            Path created = createDirectories(path);
            log.info(successMessage, created.toAbsolutePath());
            return created;
        } catch (IOException e) {
            log.warn(failureMessage, path.toAbsolutePath(), e);
            return null;
        }
    }

    protected Path createDirectories(Path path) throws IOException {
        return Files.createDirectories(path);
    }

    protected Path resolveAppDataDownloadsPath() {
        String appData = System.getenv("APPDATA");
        if (appData != null && !appData.isBlank()) {
            return Path.of(appData, "Noona", "raven", "downloads");
        }
        return null;
    }

    protected Path resolveUserHomeDownloadsPath() {
        String userHome = System.getProperty("user.home");
        if (userHome != null && !userHome.isBlank()) {
            return Path.of(userHome, ".noona", "raven", "downloads");
        }
        return Path.of(".noona", "raven", "downloads");
    }

    protected Path resolveContainerFallbackPath() {
        return CONTAINER_FALLBACK;
    }

    private void rotateLogs() throws IOException {
        if (logsPath == null) {
            return;
        }

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
        String logLine = String.format("%s [%s] [%s] %s%n", getTimestamp(), level, tag, message);
        if (writer != null) {
            try {
                writer.write(logLine);
                writer.flush();
            } catch (IOException e) {
                log.error("❌ Failed to write to log file", e);
                writer = null;
            }
        }
        System.out.print(logLine); // also output to console
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

    public Path getDownloadsRoot() {
        return downloadsRoot;
    }

    private void logSystemEnvironment() {
        write("SYSTEM", "APPDATA", System.getenv("APPDATA"));
        write("SYSTEM", "USER", System.getProperty("user.name"));
        write("SYSTEM", "OS", System.getProperty("os.name") + " " + System.getProperty("os.version"));
    }
}
