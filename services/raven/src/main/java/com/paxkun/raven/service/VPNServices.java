package com.paxkun.raven.service;

import com.paxkun.raven.service.settings.DownloadVpnSettings;
import com.paxkun.raven.service.settings.SettingsService;
import com.paxkun.raven.service.vpn.VpnLoginTestResult;
import com.paxkun.raven.service.vpn.VpnRegionOption;
import com.paxkun.raven.service.vpn.VpnRotationResult;
import com.paxkun.raven.service.vpn.VpnRuntimeStatus;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Manages Raven VPN connectivity and scheduled IP rotations.
 * The implementation currently targets PIA OpenVPN profiles.
 */
@Service
@RequiredArgsConstructor
public class VPNServices {

    private static final String VPN_TAG = "VPN";
    private static final String DEFAULT_PROVIDER = "pia";
    private static final String DEFAULT_REGION = "us_california";
    private static final int DEFAULT_ROTATE_INTERVAL_MINUTES = 30;
    private static final int MIN_ROTATE_INTERVAL_MINUTES = 1;
    private static final int MAX_ROTATE_INTERVAL_MINUTES = 24 * 60;
    private static final Duration PROFILE_REFRESH_TTL = Duration.ofHours(6);
    private static final Pattern REMOTE_PATTERN = Pattern.compile("^\\s*remote\\s+([^\\s]+)\\s+\\d+\\s*$");
    private static final Pattern IP_JSON_PATTERN = Pattern.compile("\"ip\"\\s*:\\s*\"([^\"]+)\"");
    private static final int CONNECT_LOG_PREVIEW_LIMIT = 8;
    private static final String LOGIN_TEST_PUBLIC_IP_URL = "https://api64.ipify.org?format=json";

    private final SettingsService settingsService;
    private final DownloadService downloadService;
    private final LoggerService logger;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor((runnable) -> {
        Thread thread = new Thread(runnable);
        thread.setName("raven-vpn-scheduler");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicBoolean rotationInProgress = new AtomicBoolean(false);
    private final AtomicBoolean loginTestInProgress = new AtomicBoolean(false);
    private final Object openVpnLock = new Object();
    @Value("${raven.vpn.pia.openvpnZipUrl:${RAVEN_PIA_OPENVPN_ZIP_URL:https://www.privateinternetaccess.com/openvpn/openvpn-ip.zip}}")
    private String piaOpenVpnZipUrl;
    @Value("${raven.vpn.connectTimeoutSeconds:${RAVEN_VPN_CONNECT_TIMEOUT_SECONDS:90}}")
    private int connectTimeoutSeconds;
    @Value("${raven.vpn.pauseTimeoutMinutes:${RAVEN_VPN_PAUSE_TIMEOUT_MINUTES:30}}")
    private int pauseTimeoutMinutes;
    @Value("${raven.vpn.publicIpUrl:${RAVEN_VPN_PUBLIC_IP_URL:https://api.ipify.org}}")
    private String publicIpUrl;
    private volatile Process openVpnProcess;
    private volatile String currentRegion = DEFAULT_REGION;
    private volatile String currentPublicIp;
    private volatile String lastRotationAtIso;
    private volatile String nextRotationAtIso;
    private volatile long nextRotationAtMs = 0L;
    private volatile String connectionState = "idle";
    private volatile String lastError;

    private volatile List<VpnRegionOption> cachedRegions = List.of();
    private volatile long cachedRegionsAtMs = 0L;

    @PostConstruct
    public void start() {
        scheduler.scheduleWithFixedDelay(this::runScheduleTick, 10, 30, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void stop() {
        scheduler.shutdownNow();
        disconnectOpenVpn();
    }

    public VpnRuntimeStatus getStatus() {
        DownloadVpnSettings settings = settingsService.getDownloadVpnSettings();
        return new VpnRuntimeStatus(
                Boolean.TRUE.equals(settings.getEnabled()),
                Boolean.TRUE.equals(settings.getAutoRotate()),
                rotationInProgress.get(),
                isOpenVpnRunning(),
                Optional.ofNullable(settings.getProvider()).orElse(DEFAULT_PROVIDER),
                Optional.ofNullable(settings.getRegion()).orElse(DEFAULT_REGION),
                normalizeRotateInterval(settings.getRotateEveryMinutes()),
                currentPublicIp,
                lastRotationAtIso,
                nextRotationAtIso,
                lastError,
                connectionState
        );
    }

    public List<VpnRegionOption> listRegions() {
        try {
            return loadRegions();
        } catch (Exception e) {
            logger.warn(VPN_TAG, "⚠️ Failed to load PIA regions: " + e.getMessage());
            return List.of();
        }
    }

    public VpnRotationResult rotateNow(String triggeredBy) {
        return rotateNowInternal(Optional.ofNullable(triggeredBy).filter(s -> !s.isBlank()).orElse("manual"));
    }

    public VpnLoginTestResult testLogin(
            String triggeredBy,
            String requestedRegion,
            String requestedUsername,
            String requestedPassword
    ) {
        String sanitizedTrigger = Optional.ofNullable(triggeredBy).filter(value -> !value.isBlank()).orElse("manual");
        if (rotationInProgress.get()) {
            return new VpnLoginTestResult(
                    false,
                    "Cannot test VPN login while a rotation is in progress.",
                    resolveRequestedRegion(requestedRegion, settingsService.getDownloadVpnSettings()),
                    "",
                    "",
                    Instant.now().toString()
            );
        }
        if (isOpenVpnRunning()) {
            return new VpnLoginTestResult(
                    false,
                    "Cannot test VPN login while Raven VPN is already connected.",
                    resolveRequestedRegion(requestedRegion, settingsService.getDownloadVpnSettings()),
                    "",
                    "",
                    Instant.now().toString()
            );
        }
        if (!loginTestInProgress.compareAndSet(false, true)) {
            return new VpnLoginTestResult(
                    false,
                    "A VPN login test is already in progress.",
                    resolveRequestedRegion(requestedRegion, settingsService.getDownloadVpnSettings()),
                    "",
                    "",
                    Instant.now().toString()
            );
        }

        String region = DEFAULT_REGION;
        String endpoint = "";
        String reportedIp = "";
        try {
            DownloadVpnSettings settings = settingsService.getDownloadVpnSettings();
            String provider = Optional.ofNullable(settings.getProvider()).orElse(DEFAULT_PROVIDER);
            if (!DEFAULT_PROVIDER.equalsIgnoreCase(provider)) {
                throw new IllegalStateException("Only PIA VPN provider is currently supported.");
            }

            region = resolveRequestedRegion(requestedRegion, settings);
            String username = Optional.ofNullable(requestedUsername).orElse("").trim();
            String password = Optional.ofNullable(requestedPassword).orElse("").trim();
            if (username.isBlank() || password.isBlank()) {
                throw new IllegalStateException("PIA username and password are required for login test.");
            }

            Path profilePath = resolveProfilePath(region);
            endpoint = parseRemoteEndpoint(profilePath);
            reportedIp = probeOpenVpnLogin(profilePath, username, password);

            String successMessage = "PIA login succeeded for region " + region + ".";
            logger.info(VPN_TAG, "PIA login test succeeded | trigger=" + sanitizeForLog(sanitizedTrigger)
                    + " | region=" + sanitizeForLog(region));
            return new VpnLoginTestResult(
                    true,
                    successMessage,
                    region,
                    endpoint,
                    reportedIp,
                    Instant.now().toString()
            );
        } catch (Exception e) {
            String safeMessage = sanitizeForLog(e.getMessage());
            logger.warn(VPN_TAG, "⚠️ PIA login test failed | trigger=" + sanitizeForLog(sanitizedTrigger)
                    + " | region=" + sanitizeForLog(region)
                    + " | reason=" + safeMessage);
            return new VpnLoginTestResult(
                    false,
                    Optional.ofNullable(e.getMessage()).filter(message -> !message.isBlank())
                            .orElse("Unable to validate PIA login."),
                    region,
                    endpoint,
                    reportedIp,
                    Instant.now().toString()
            );
        } finally {
            loginTestInProgress.set(false);
        }
    }

    private void runScheduleTick() {
        try {
            DownloadVpnSettings settings = settingsService.getDownloadVpnSettings();
            boolean enabled = Boolean.TRUE.equals(settings.getEnabled());
            boolean autoRotate = Boolean.TRUE.equals(settings.getAutoRotate());

            if (!enabled) {
                nextRotationAtMs = 0L;
                nextRotationAtIso = null;
                if (isOpenVpnRunning()) {
                    disconnectOpenVpn();
                    connectionState = "disabled";
                }
                return;
            }

            if (!DEFAULT_PROVIDER.equalsIgnoreCase(Optional.ofNullable(settings.getProvider()).orElse(DEFAULT_PROVIDER))) {
                lastError = "Unsupported VPN provider configured for Raven.";
                return;
            }

            if (!autoRotate) {
                nextRotationAtMs = 0L;
                nextRotationAtIso = null;
                return;
            }

            int intervalMinutes = normalizeRotateInterval(settings.getRotateEveryMinutes());
            long now = System.currentTimeMillis();
            if (nextRotationAtMs <= 0) {
                nextRotationAtMs = now;
            }

            nextRotationAtIso = Instant.ofEpochMilli(nextRotationAtMs).toString();
            if (now < nextRotationAtMs || rotationInProgress.get() || loginTestInProgress.get()) {
                return;
            }

            VpnRotationResult result = rotateNowInternal("schedule");
            if (!result.ok()) {
                logger.warn(VPN_TAG, "⚠️ Scheduled VPN rotation failed: " + sanitizeForLog(result.message()));
            }

            long nextAt = System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(intervalMinutes);
            nextRotationAtMs = nextAt;
            nextRotationAtIso = Instant.ofEpochMilli(nextAt).toString();
        } catch (Exception e) {
            lastError = e.getMessage();
            logger.warn(VPN_TAG, "⚠️ VPN scheduler tick failed: " + e.getMessage());
        }
    }

    private VpnRotationResult rotateNowInternal(String triggeredBy) {
        if (loginTestInProgress.get()) {
            return new VpnRotationResult(
                    false,
                    "A VPN login test is in progress.",
                    currentPublicIp,
                    currentPublicIp,
                    currentRegion,
                    0,
                    0,
                    triggeredBy,
                    Instant.now().toString()
            );
        }

        if (!rotationInProgress.compareAndSet(false, true)) {
            return new VpnRotationResult(
                    false,
                    "A VPN rotation is already in progress.",
                    currentPublicIp,
                    currentPublicIp,
                    currentRegion,
                    0,
                    0,
                    triggeredBy,
                    Instant.now().toString()
            );
        }

        DownloadService.PauseRequestResult pauseResult = new DownloadService.PauseRequestResult(List.of(), List.of());
        int resumedTasks = 0;
        String previousIp = currentPublicIp;
        String activeRegion = currentRegion;
        try {
            DownloadVpnSettings settings = settingsService.getDownloadVpnSettings();
            validateEnabledVpnSettings(settings);

            String targetRegion = Optional.ofNullable(settings.getRegion())
                    .filter(region -> !region.isBlank())
                    .map(region -> region.trim().toLowerCase(Locale.ROOT))
                    .orElse(DEFAULT_REGION);
            activeRegion = targetRegion;

            downloadService.beginMaintenancePause("VPN rotation");
            pauseResult = downloadService.requestPauseActiveDownloads();

            boolean drained = downloadService.waitForNoActiveDownloads(Duration.ofMinutes(Math.max(1, pauseTimeoutMinutes)));
            if (!drained) {
                throw new IllegalStateException("Timed out while waiting for active downloads to pause.");
            }

            disconnectOpenVpn();
            connectOpenVpn(targetRegion, settings.getPiaUsername(), settings.getPiaPassword());

            currentRegion = targetRegion;
            currentPublicIp = resolvePublicIp();
            connectionState = "connected";
            lastError = null;
            lastRotationAtIso = Instant.now().toString();

            resumedTasks = downloadService.resumePausedDownloads();
            downloadService.endMaintenancePause("VPN rotation complete");

            int intervalMinutes = normalizeRotateInterval(settings.getRotateEveryMinutes());
            long nextAt = System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(intervalMinutes);
            nextRotationAtMs = nextAt;
            nextRotationAtIso = Instant.ofEpochMilli(nextAt).toString();

            return new VpnRotationResult(
                    true,
                    "VPN rotation complete.",
                    previousIp,
                    currentPublicIp,
                    currentRegion,
                    pauseResult.getAffectedTasks(),
                    resumedTasks,
                    triggeredBy,
                    lastRotationAtIso
            );
        } catch (Exception e) {
            lastError = e.getMessage();
            connectionState = "error";
            logger.warn(VPN_TAG, "⚠️ VPN rotation failed: " + sanitizeForLog(e.getMessage()));
            downloadService.endMaintenancePause("VPN rotation failed");
            resumedTasks = downloadService.resumePausedDownloads();
            return new VpnRotationResult(
                    false,
                    e.getMessage(),
                    previousIp,
                    currentPublicIp,
                    activeRegion,
                    pauseResult.getAffectedTasks(),
                    resumedTasks,
                    triggeredBy,
                    Instant.now().toString()
            );
        } finally {
            rotationInProgress.set(false);
        }
    }

    private void validateEnabledVpnSettings(DownloadVpnSettings settings) {
        if (!Boolean.TRUE.equals(settings.getEnabled())) {
            throw new IllegalStateException("VPN is disabled in Raven settings.");
        }

        String provider = Optional.ofNullable(settings.getProvider()).orElse(DEFAULT_PROVIDER);
        if (!DEFAULT_PROVIDER.equalsIgnoreCase(provider)) {
            throw new IllegalStateException("Only PIA VPN provider is currently supported.");
        }

        String username = Optional.ofNullable(settings.getPiaUsername()).orElse("").trim();
        String password = Optional.ofNullable(settings.getPiaPassword()).orElse("").trim();
        if (username.isBlank() || password.isBlank()) {
            throw new IllegalStateException("PIA credentials are required before rotating Raven VPN.");
        }
    }

    private List<VpnRegionOption> loadRegions() throws IOException {
        long now = System.currentTimeMillis();
        if (!cachedRegions.isEmpty() && now - cachedRegionsAtMs < PROFILE_REFRESH_TTL.toMillis()) {
            return cachedRegions;
        }

        Path configRoot = ensurePiaProfiles();
        List<VpnRegionOption> options = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(configRoot, "*.ovpn")) {
            for (Path entry : stream) {
                String fileName = entry.getFileName().toString();
                String regionId = fileName.substring(0, fileName.length() - ".ovpn".length());
                String endpoint = parseRemoteEndpoint(entry);
                options.add(new VpnRegionOption(regionId, prettifyRegionLabel(regionId), endpoint));
            }
        }
        options.sort(Comparator.comparing(VpnRegionOption::label, String.CASE_INSENSITIVE_ORDER));

        cachedRegions = List.copyOf(options);
        cachedRegionsAtMs = now;
        return cachedRegions;
    }

    private Path ensurePiaProfiles() throws IOException {
        Path vpnRoot = resolveVpnRoot();
        Path archivePath = vpnRoot.resolve("openvpn-ip.zip");
        Path configRoot = vpnRoot.resolve("profiles");
        Files.createDirectories(vpnRoot);

        boolean refreshArchive = shouldRefreshArchive(archivePath, configRoot);
        if (refreshArchive) {
            downloadArchive(archivePath);
            extractArchive(archivePath, configRoot);
        }

        return configRoot;
    }

    private boolean shouldRefreshArchive(Path archivePath, Path configRoot) throws IOException {
        if (!Files.exists(archivePath) || !Files.exists(configRoot)) {
            return true;
        }

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(configRoot, "*.ovpn")) {
            if (!stream.iterator().hasNext()) {
                return true;
            }
        }

        long modifiedAt = Files.getLastModifiedTime(archivePath).toMillis();
        return System.currentTimeMillis() - modifiedAt > PROFILE_REFRESH_TTL.toMillis();
    }

    private void downloadArchive(Path archivePath) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(piaOpenVpnZipUrl).openConnection();
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(45_000);
        connection.setRequestProperty("User-Agent", "Noona-Raven/2.2");
        connection.connect();

        int statusCode = connection.getResponseCode();
        if (statusCode < 200 || statusCode >= 300) {
            throw new IOException("PIA OpenVPN profile download failed with status " + statusCode);
        }

        try (var in = connection.getInputStream()) {
            Files.copy(in, archivePath, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } finally {
            connection.disconnect();
        }
    }

    private void extractArchive(Path archivePath, Path configRoot) throws IOException {
        if (Files.exists(configRoot)) {
            try (var walk = Files.walk(configRoot)) {
                walk.sorted(Comparator.reverseOrder())
                        .filter(path -> !path.equals(configRoot))
                        .forEach(path -> {
                            try {
                                Files.deleteIfExists(path);
                            } catch (IOException ignored) {
                                // best-effort cleanup
                            }
                        });
            }
        }
        Files.createDirectories(configRoot);

        try (ZipInputStream zipInputStream = new ZipInputStream(Files.newInputStream(archivePath))) {
            ZipEntry entry;
            while ((entry = zipInputStream.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    zipInputStream.closeEntry();
                    continue;
                }

                Path target = configRoot.resolve(entry.getName()).normalize();
                if (!target.startsWith(configRoot)) {
                    zipInputStream.closeEntry();
                    continue;
                }

                Path parent = target.getParent();
                if (parent != null) {
                    Files.createDirectories(parent);
                }

                Files.copy(zipInputStream, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                zipInputStream.closeEntry();
            }
        }
    }

    private void connectOpenVpn(String region, String username, String password) throws IOException {
        Path configPath = resolveProfilePath(region);

        Path authPath = resolveVpnRoot().resolve("pia-auth.txt");
        writeAuthFile(authPath, username, password);

        Process process;
        synchronized (openVpnLock) {
            ProcessBuilder builder = new ProcessBuilder(
                    "openvpn",
                    "--config", configPath.toString(),
                    "--auth-user-pass", authPath.toString(),
                    "--auth-nocache",
                    "--verb", "1"
            );
            builder.redirectErrorStream(true);
            process = builder.start();
            openVpnProcess = process;
        }

        AtomicBoolean connected = new AtomicBoolean(false);
        AtomicBoolean authFailed = new AtomicBoolean(false);
        Deque<String> recentLogs = new ArrayDeque<>();
        Thread streamReader = new Thread(() -> readOpenVpnOutput(process, connected, authFailed, recentLogs));
        streamReader.setName("raven-openvpn-output");
        streamReader.setDaemon(true);
        streamReader.start();

        connectionState = "connecting";
        long deadline = System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(Math.max(15, connectTimeoutSeconds));
        while (System.currentTimeMillis() < deadline) {
            if (connected.get()) {
                connectionState = "connected";
                return;
            }

            if (authFailed.get()) {
                disconnectOpenVpn();
                throw new IllegalStateException("PIA authentication failed for Raven VPN.");
            }

            if (!process.isAlive()) {
                break;
            }

            try {
                Thread.sleep(500L);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                break;
            }
        }

        String preview;
        synchronized (recentLogs) {
            preview = String.join(" | ", recentLogs);
        }
        disconnectOpenVpn();
        throw new IllegalStateException("OpenVPN did not complete initialization in time."
                + (preview.isBlank() ? "" : " Logs: " + preview));
    }

    private String probeOpenVpnLogin(Path configPath, String username, String password) throws IOException {
        Path authPath = resolveVpnRoot().resolve("pia-auth-test.txt");
        writeAuthFile(authPath, username, password);

        Process process = null;
        AtomicBoolean connected = new AtomicBoolean(false);
        AtomicBoolean authFailed = new AtomicBoolean(false);
        Deque<String> recentLogs = new ArrayDeque<>();
        try {
            ProcessBuilder builder = new ProcessBuilder(
                    "openvpn",
                    "--config", configPath.toString(),
                    "--auth-user-pass", authPath.toString(),
                    "--auth-nocache",
                    "--dev", "tun-login",
                    "--connect-retry-max", "1",
                    "--verb", "1"
            );
            builder.redirectErrorStream(true);
            process = builder.start();

            Process activeProcess = process;
            Thread streamReader = new Thread(() -> readOpenVpnOutput(activeProcess, connected, authFailed, recentLogs));
            streamReader.setName("raven-openvpn-login-test");
            streamReader.setDaemon(true);
            streamReader.start();

            long deadline = System.currentTimeMillis() + TimeUnit.SECONDS.toMillis(Math.max(15, connectTimeoutSeconds));
            while (System.currentTimeMillis() < deadline) {
                if (connected.get()) {
                    String reportedIp = resolvePublicIpFromJsonEndpoint(LOGIN_TEST_PUBLIC_IP_URL);
                    stopOpenVpnProcess(activeProcess);
                    return reportedIp;
                }

                if (authFailed.get()) {
                    stopOpenVpnProcess(activeProcess);
                    throw new IllegalStateException("PIA authentication failed.");
                }

                if (!activeProcess.isAlive()) {
                    break;
                }

                try {
                    Thread.sleep(500L);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }

            String preview;
            synchronized (recentLogs) {
                preview = String.join(" | ", recentLogs);
            }
            throw new IllegalStateException("OpenVPN login test timed out."
                    + (preview.isBlank() ? "" : " Logs: " + preview));
        } finally {
            if (process != null) {
                stopOpenVpnProcess(process);
            }
            try {
                Files.deleteIfExists(authPath);
            } catch (IOException ignored) {
                // best-effort cleanup
            }
        }
    }

    private void readOpenVpnOutput(
            Process process,
            AtomicBoolean connected,
            AtomicBoolean authFailed,
            Deque<String> recentLogs
    ) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String trimmed = line.trim();
                if (trimmed.isEmpty()) {
                    continue;
                }

                synchronized (recentLogs) {
                    if (recentLogs.size() >= CONNECT_LOG_PREVIEW_LIMIT) {
                        recentLogs.removeFirst();
                    }
                    recentLogs.addLast(trimmed);
                }

                String lower = trimmed.toLowerCase(Locale.ROOT);
                if (trimmed.contains("Initialization Sequence Completed")) {
                    connected.set(true);
                }
                if (lower.contains("auth_failed") || lower.contains("authentication failed")) {
                    authFailed.set(true);
                }

                logger.debug(VPN_TAG, sanitizeForLog(trimmed));
            }
        } catch (IOException e) {
            logger.debug(VPN_TAG, "OpenVPN stream closed: " + sanitizeForLog(e.getMessage()));
        }
    }

    private void disconnectOpenVpn() {
        Process process;
        synchronized (openVpnLock) {
            process = openVpnProcess;
            openVpnProcess = null;
        }

        if (process == null) {
            return;
        }

        try {
            if (process.isAlive()) {
                process.destroy();
                if (!process.waitFor(10, TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                }
            }
        } catch (Exception e) {
            logger.warn(VPN_TAG, "⚠️ Failed to stop OpenVPN process cleanly: " + e.getMessage());
        } finally {
            connectionState = "disconnected";
        }
    }

    private boolean isOpenVpnRunning() {
        Process process = openVpnProcess;
        return process != null && process.isAlive();
    }

    private void stopOpenVpnProcess(Process process) {
        if (process == null) {
            return;
        }
        try {
            if (process.isAlive()) {
                process.destroy();
                if (!process.waitFor(10, TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                }
            }
        } catch (Exception ignored) {
            // best-effort cleanup for short-lived probe process
        }
    }

    private Path resolveProfilePath(String region) throws IOException {
        Path configRoot = ensurePiaProfiles();
        Path configPath = configRoot.resolve(region + ".ovpn");
        if (!Files.exists(configPath)) {
            throw new IllegalStateException("PIA region profile not found: " + region);
        }
        return configPath;
    }

    private String resolveRequestedRegion(String requestedRegion, DownloadVpnSettings settings) {
        String requested = Optional.ofNullable(requestedRegion).orElse("").trim().toLowerCase(Locale.ROOT);
        if (!requested.isBlank()) {
            return requested;
        }
        return Optional.ofNullable(settings.getRegion())
                .map(value -> value.trim().toLowerCase(Locale.ROOT))
                .filter(value -> !value.isBlank())
                .orElse(DEFAULT_REGION);
    }

    private void writeAuthFile(Path authPath, String username, String password) throws IOException {
        Files.createDirectories(authPath.getParent());
        try (BufferedWriter writer = Files.newBufferedWriter(
                authPath,
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING,
                StandardOpenOption.WRITE
        )) {
            writer.write(Optional.ofNullable(username).orElse("").trim());
            writer.newLine();
            writer.write(Optional.ofNullable(password).orElse("").trim());
            writer.newLine();
        }
    }

    private String parseRemoteEndpoint(Path profilePath) {
        try {
            List<String> lines = Files.readAllLines(profilePath, StandardCharsets.UTF_8);
            for (String line : lines) {
                Matcher matcher = REMOTE_PATTERN.matcher(line);
                if (matcher.matches()) {
                    return matcher.group(1);
                }
            }
        } catch (Exception ignored) {
            // best effort only
        }
        return "";
    }

    private String prettifyRegionLabel(String regionId) {
        String raw = Optional.ofNullable(regionId).orElse("").replace(".ovpn", "").replace('_', ' ').trim();
        if (raw.isBlank()) {
            return "";
        }

        StringBuilder out = new StringBuilder();
        for (String part : raw.split("\\s+")) {
            if (part.isBlank()) {
                continue;
            }
            if (out.length() > 0) {
                out.append(' ');
            }
            out.append(Character.toUpperCase(part.charAt(0)));
            if (part.length() > 1) {
                out.append(part.substring(1));
            }
        }
        return out.toString();
    }

    private Path resolveVpnRoot() {
        Path downloadsRoot = Optional.ofNullable(logger.getDownloadsRoot()).orElse(Path.of("/app/downloads"));
        return downloadsRoot.resolve("vpn").resolve("pia");
    }

    private int normalizeRotateInterval(Integer inputMinutes) {
        if (inputMinutes == null) {
            return DEFAULT_ROTATE_INTERVAL_MINUTES;
        }
        return Math.max(MIN_ROTATE_INTERVAL_MINUTES, Math.min(MAX_ROTATE_INTERVAL_MINUTES, inputMinutes));
    }

    private String resolvePublicIp() {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(publicIpUrl).openConnection();
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setRequestProperty("User-Agent", "Noona-Raven/2.2");
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                return currentPublicIp;
            }

            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line = reader.readLine();
                if (line == null) {
                    return currentPublicIp;
                }
                String ip = line.trim();
                return ip.isBlank() ? currentPublicIp : ip;
            } finally {
                connection.disconnect();
            }
        } catch (Exception e) {
            logger.debug(VPN_TAG, "Public IP lookup failed: " + sanitizeForLog(e.getMessage()));
            return currentPublicIp;
        }
    }

    private String resolvePublicIpFromJsonEndpoint(String targetUrl) {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(targetUrl).openConnection();
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setRequestProperty("User-Agent", "Noona-Raven/2.2");
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                return "";
            }

            StringBuilder payload = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    payload.append(line);
                }
            } finally {
                connection.disconnect();
            }

            Matcher matcher = IP_JSON_PATTERN.matcher(payload.toString());
            return matcher.find() ? matcher.group(1).trim() : "";
        } catch (Exception e) {
            logger.debug(VPN_TAG, "JSON public IP lookup failed: " + sanitizeForLog(e.getMessage()));
            return "";
        }
    }

    private String sanitizeForLog(String value) {
        if (value == null) {
            return "";
        }
        return value.replaceAll("[\\r\\n]", "").replaceAll("[^\\p{Alnum}\\s_.,:/-]", "").trim();
    }
}
