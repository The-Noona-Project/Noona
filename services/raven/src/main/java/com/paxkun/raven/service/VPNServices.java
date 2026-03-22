/**
 * Manages Raven VPN startup, status, rotation, and login testing.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/settings/DownloadVpnSettings.java
 * - src/main/java/com/paxkun/raven/service/settings/SettingsService.java
 * - src/main/java/com/paxkun/raven/service/vpn/VpnLoginTestResult.java
 * - src/main/java/com/paxkun/raven/service/vpn/VpnRegionOption.java
 * Times this file has been edited: 9
 */
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
    private static final Pattern VPN_ROUTE_DEVICE_PATTERN = Pattern.compile("\\bdev\\s+tun\\S*\\b", Pattern.CASE_INSENSITIVE);
    private static final Pattern LOOPBACK_ROUTE_DEVICE_PATTERN = Pattern.compile("\\bdev\\s+lo\\b", Pattern.CASE_INSENSITIVE);
    private static final int CONNECT_LOG_PREVIEW_LIMIT = 8;
    private static final int ROUTE_COMMAND_TIMEOUT_SECONDS = 10;
    private static final String LOGIN_TEST_PUBLIC_IP_URL = "https://api64.ipify.org?format=json";
    private static final long AUTO_CONNECT_RETRY_COOLDOWN_MS = TimeUnit.MINUTES.toMillis(1);

    private final SettingsService settingsService;
    private final DownloadService downloadService;
    private final LoggerService logger;
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private RavenRuntimeProperties runtimeProperties = new RavenRuntimeProperties();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor((runnable) -> {
        Thread thread = new Thread(runnable);
        thread.setName("raven-vpn-scheduler");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicBoolean rotationInProgress = new AtomicBoolean(false);
    private final AtomicBoolean loginTestInProgress = new AtomicBoolean(false);
    private final Object openVpnLock = new Object();
    private final Object profileRefreshLock = new Object();
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
    private volatile long nextAutoConnectAttemptAtMs = 0L;
    private volatile String connectionState = "idle";
    private volatile String lastError;
    private volatile boolean profileErrorActive;

    private volatile List<VpnRegionOption> cachedRegions = List.of();
    private volatile long cachedRegionsAtMs = 0L;

    /**
     * Handles start.
     */

    @PostConstruct
    public void start() {
        if (runtimeProperties != null && runtimeProperties.isWorkerMode()) {
            return;
        }

        scheduleTickLoop();
    }

    /**
     * Handles stop.
     */

    @PreDestroy
    public void stop() {
        scheduler.shutdownNow();
        disconnectOpenVpn();
    }

    protected void scheduleTickLoop() {
        scheduler.scheduleWithFixedDelay(this::runScheduleTick, 10, 30, TimeUnit.SECONDS);
    }

    /**
     * Returns status.
     *
     * @return The resulting VpnRuntimeStatus.
     */

    public VpnRuntimeStatus getStatus() {
        DownloadVpnSettings settings = getLiveVpnSettings();
        String configuredRegion = resolveConfiguredRegion(settings);
        boolean connected = isVpnConnected();
        return new VpnRuntimeStatus(
                Boolean.TRUE.equals(settings.getEnabled()),
                Boolean.TRUE.equals(settings.getAutoRotate()),
                rotationInProgress.get(),
                connected,
                Optional.ofNullable(settings.getProvider()).orElse(DEFAULT_PROVIDER),
                connected ? Optional.ofNullable(currentRegion).filter(region -> !region.isBlank()).orElse(configuredRegion) : configuredRegion,
                normalizeRotateInterval(settings.getRotateEveryMinutes()),
                currentPublicIp,
                lastRotationAtIso,
                nextRotationAtIso,
                lastError,
                connectionState
        );
    }

    /**
     * Returns regions.
     *
     * @return The resulting list.
     */

    public List<VpnRegionOption> listRegions() {
        try {
            return loadRegions();
        } catch (Exception e) {
            recordProfileFailure(buildProfileErrorMessage(e, false));
            logger.warn(VPN_TAG, "Failed to load PIA regions: " + sanitizeForLog(e.getMessage()));
            return List.of();
        }
    }

    /**
     * Handles rotate now.
     *
     * @param triggeredBy The triggered by.
     * @return The resulting VpnRotationResult.
     */

    public VpnRotationResult rotateNow(String triggeredBy) {
        String sanitizedTrigger = Optional.ofNullable(triggeredBy).filter(s -> !s.isBlank()).orElse("manual");
        if (!rotationInProgress.compareAndSet(false, true)) {
            return new VpnRotationResult(
                    false,
                    "A VPN rotation is already in progress.",
                    currentPublicIp,
                    currentPublicIp,
                    currentRegion,
                    0,
                    0,
                    sanitizedTrigger,
                    Instant.now().toString()
            );
        }
        String configuredRegion = currentRegion;
        try {
            if (loginTestInProgress.get()) {
                return new VpnRotationResult(
                        false,
                        "Cannot rotate while a VPN login test is in progress.",
                        currentPublicIp,
                        currentPublicIp,
                        currentRegion,
                        0,
                        0,
                        sanitizedTrigger,
                        Instant.now().toString()
                );
            }

            DownloadVpnSettings settings = getLiveVpnSettings();
            configuredRegion = resolveConfiguredRegion(settings);
            validateEnabledVpnSettings(settings);
        } catch (Exception e) {
            rotationInProgress.set(false);
            String message = Optional.ofNullable(e.getMessage()).filter(value -> !value.isBlank())
                    .orElse("Unable to validate Raven VPN settings.");
            setRuntimeError(message);
            return new VpnRotationResult(
                    false,
                    message,
                    currentPublicIp,
                    currentPublicIp,
                    configuredRegion,
                    0,
                    0,
                    sanitizedTrigger,
                    Instant.now().toString()
            );
        }

        try {
            scheduler.execute(() -> {
                try {
                    rotateNowInternal(sanitizedTrigger, true);
                } catch (Exception e) {
                    logger.error(VPN_TAG, "Background VPN rotation failed: " + e.getMessage());
                }
            });
        } catch (RuntimeException e) {
            rotationInProgress.set(false);
            String message = "Unable to queue Raven VPN rotation: " + sanitizeForLog(e.getMessage());
            setRuntimeError(message);
            return new VpnRotationResult(
                    false,
                    message,
                    currentPublicIp,
                    currentPublicIp,
                    configuredRegion,
                    0,
                    0,
                    sanitizedTrigger,
                    Instant.now().toString()
            );
        }

        return new VpnRotationResult(
                true,
                "VPN rotation started in background.",
                currentPublicIp,
                currentPublicIp,
                configuredRegion,
                0,
                0,
                sanitizedTrigger,
                Instant.now().toString()
        );
    }

    /**
     * Tests login.
     *
     * @param triggeredBy The triggered by.
     * @param requestedRegion The requested region.
     * @param requestedUsername The requested username.
     * @param requestedPassword The requested password.
     * @return The resulting VpnLoginTestResult.
     */

    public VpnLoginTestResult testLogin(
            String triggeredBy,
            String requestedRegion,
            String requestedUsername,
            String requestedPassword
    ) {
        String sanitizedTrigger = Optional.ofNullable(triggeredBy).filter(value -> !value.isBlank()).orElse("manual");
        String region = resolveRequestedRegion(requestedRegion, getLiveVpnSettings());

        if (!loginTestInProgress.compareAndSet(false, true)) {
            return new VpnLoginTestResult(
                    false,
                    "A VPN login test is already in progress.",
                    region,
                    "",
                    "",
                    Instant.now().toString()
            );
        }
        try {
            if (rotationInProgress.get()) {
                return new VpnLoginTestResult(
                        false,
                        "Cannot test VPN login while a rotation is in progress.",
                        region,
                        "",
                        "",
                        Instant.now().toString()
                );
            }
            if (isOpenVpnRunning()) {
                return new VpnLoginTestResult(
                        false,
                        "Cannot test VPN login while Raven VPN is already active.",
                        region,
                        "",
                        "",
                        Instant.now().toString()
                );
            }
            return testLoginInternal(sanitizedTrigger, requestedRegion, requestedUsername, requestedPassword);
        } finally {
            loginTestInProgress.set(false);
        }
    }

    /**
     * Executes a synchronous VPN login test and returns the final probe result.
     *
     * @param triggeredBy       The source that requested the test.
     * @param requestedRegion   The requested region override.
     * @param requestedUsername The requested PIA username.
     * @param requestedPassword The requested PIA password.
     * @return The resulting VPN login test payload.
     */
    private VpnLoginTestResult testLoginInternal(
            String triggeredBy,
            String requestedRegion,
            String requestedUsername,
            String requestedPassword
    ) {
        String region = DEFAULT_REGION;
        String endpoint = "";
        String reportedIp = "";
        VpnLoginTestResult result;
        List<String> preservedLocalRoutes = List.of();
        boolean shouldRestoreRoutes = false;
        try {
            DownloadVpnSettings settings = getLiveVpnSettings();
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
            preservedLocalRoutes = captureLocalRouteSpecs();
            shouldRestoreRoutes = true;
            reportedIp = probeOpenVpnLogin(profilePath, username, password);

            logger.info(VPN_TAG, "PIA login test succeeded | trigger=" + sanitizeForLog(triggeredBy)
                    + " | region=" + sanitizeForLog(region)
                    + " | preservedLocalRoutes=" + preservedLocalRoutes.size());
            clearRuntimeError();
            result = new VpnLoginTestResult(
                    true,
                    "PIA login succeeded for region " + region + ".",
                    region,
                    endpoint,
                    reportedIp,
                    Instant.now().toString()
            );
        } catch (Exception e) {
            String safeMessage = Optional.ofNullable(e.getMessage())
                    .filter(message -> !message.isBlank())
                    .map(this::sanitizeForLog)
                    .orElse("PIA login test failed.");
            String failureMessage = "Login test failed: " + safeMessage;
            setRuntimeError(failureMessage);
            logger.warn(VPN_TAG, "⚠️ PIA login test failed | trigger=" + sanitizeForLog(triggeredBy)
                    + " | region=" + sanitizeForLog(region)
                    + " | reason=" + safeMessage);
            result = new VpnLoginTestResult(
                    false,
                    failureMessage,
                    region,
                    endpoint,
                    "",
                    Instant.now().toString()
            );
        }
        if (shouldRestoreRoutes) {
            try {
                restoreLocalRouteSpecs(preservedLocalRoutes);
            } catch (IOException restoreError) {
                String restoreMessage = "Login test failed: Failed to restore local routes after VPN login test: "
                        + sanitizeForLog(restoreError.getMessage());
                logger.warn(VPN_TAG, "Failed to restore local routes after login test | region="
                        + sanitizeForLog(region)
                        + " | reason=" + sanitizeForLog(restoreError.getMessage()));
                setRuntimeError(restoreMessage);
                result = new VpnLoginTestResult(
                        false,
                        result.ok() ? restoreMessage : result.message() + " " + restoreMessage,
                        region,
                        endpoint,
                        result.ok() ? reportedIp : result.reportedIp(),
                        Instant.now().toString()
                );
            }
        }
        return result;
    }

    private void runScheduleTick() {
        try {
            DownloadVpnSettings settings = getLiveVpnSettings();
            boolean enabled = Boolean.TRUE.equals(settings.getEnabled());
            boolean autoRotate = Boolean.TRUE.equals(settings.getAutoRotate());
            long now = System.currentTimeMillis();

            if (!enabled) {
                nextRotationAtMs = 0L;
                nextRotationAtIso = null;
                clearAutoConnectRetrySchedule();
                if (isOpenVpnRunning() || !"disabled".equalsIgnoreCase(connectionState)) {
                    disconnectOpenVpn();
                    connectionState = "disabled";
                    currentPublicIp = null;
                }
                return;
            }

            if (!DEFAULT_PROVIDER.equalsIgnoreCase(Optional.ofNullable(settings.getProvider()).orElse(DEFAULT_PROVIDER))) {
                setRuntimeError("Unsupported VPN provider configured for Raven.");
                return;
            }

            if (enabled && currentPublicIp == null) {
                currentPublicIp = resolvePublicIp();
            }

            if (shouldEnsureConnected()) {
                if (!isAutoConnectRetryReady(now)) {
                    return;
                }

                VpnRotationResult result = ensureConnectedInternal("schedule-connect");
                if (!result.ok()) {
                    scheduleNextAutoConnectRetry(now);
                    logger.warn(VPN_TAG, "⚠️ Raven VPN auto-connect failed: " + sanitizeForLog(result.message()));
                    return;
                }

                clearAutoConnectRetrySchedule();
                now = System.currentTimeMillis();
            }

            if (!autoRotate) {
                nextRotationAtMs = 0L;
                nextRotationAtIso = null;
                return;
            }

            int intervalMinutes = normalizeRotateInterval(settings.getRotateEveryMinutes());
            if (nextRotationAtMs <= 0) {
                long nextAt = now + TimeUnit.MINUTES.toMillis(intervalMinutes);
                nextRotationAtMs = nextAt;
                nextRotationAtIso = Instant.ofEpochMilli(nextAt).toString();
                return;
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
            setRuntimeError(e.getMessage());
            logger.warn(VPN_TAG, "⚠️ VPN scheduler tick failed: " + e.getMessage());
        }
    }

    /**
     * Executes a VPN rotation using the current Raven settings, reserving the in-progress flag on demand.
     *
     * @param triggeredBy The source that requested the rotation.
     * @return The resulting rotation payload.
     */
    private VpnRotationResult rotateNowInternal(String triggeredBy) {
        return rotateNowInternal(triggeredBy, false);
    }

    /**
     * Executes a VPN rotation using the current Raven settings and optionally reuses an existing reservation.
     *
     * @param triggeredBy     The source that requested the rotation.
     * @param reservationHeld Whether the caller already reserved {@code rotationInProgress}.
     * @return The resulting rotation payload.
     */
    private VpnRotationResult rotateNowInternal(String triggeredBy, boolean reservationHeld) {
        return runVpnTransition(
                triggeredBy,
                reservationHeld,
                true,
                "VPN rotation complete.",
                "VPN rotation"
        );
    }

    /**
     * Ensures Raven has an established VPN tunnel without requiring periodic rotation to be enabled.
     *
     * @param triggeredBy The source that requested the connection.
     * @return The resulting VPN transition payload.
     */
    private VpnRotationResult ensureConnectedInternal(String triggeredBy) {
        return runVpnTransition(
                triggeredBy,
                false,
                false,
                "VPN connection established.",
                "VPN auto-connect"
        );
    }

    /**
     * Executes Raven's shared VPN transition flow for both manual rotations and background auto-connect attempts.
     *
     * @param triggeredBy            The source that requested the transition.
     * @param reservationHeld        Whether the caller already reserved {@code rotationInProgress}.
     * @param updateRotationSchedule Whether Raven should schedule the next periodic rotation on success.
     * @param successMessage         The message returned when the transition succeeds.
     * @param maintenanceReason      The maintenance-pause label used while downloads drain.
     * @return The resulting VPN transition payload.
     */
    private VpnRotationResult runVpnTransition(
            String triggeredBy,
            boolean reservationHeld,
            boolean updateRotationSchedule,
            String successMessage,
            String maintenanceReason
    ) {
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

        if (!reservationHeld && !rotationInProgress.compareAndSet(false, true)) {
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
        String failureStage = "validating VPN settings";
        List<String> preservedLocalRoutes = List.of();
        boolean maintenancePauseActive = false;
        boolean openVpnConnected = false;
        try {
            DownloadVpnSettings settings = getLiveVpnSettings();
            validateEnabledVpnSettings(settings);

            String targetRegion = resolveConfiguredRegion(settings);
            activeRegion = targetRegion;

            failureStage = "starting maintenance pause";
            downloadService.beginMaintenancePause(maintenanceReason);
            maintenancePauseActive = true;
            failureStage = "pausing active downloads";
            pauseResult = downloadService.requestPauseActiveDownloads();

            failureStage = "waiting for downloads to pause";
            boolean drained = downloadService.waitForNoActiveDownloads(Duration.ofMinutes(Math.max(1, pauseTimeoutMinutes)));
            if (!drained) {
                throw new IllegalStateException("Timed out while waiting for active downloads to pause.");
            }

            failureStage = "capturing local routes";
            disconnectOpenVpn();
            preservedLocalRoutes = captureLocalRouteSpecs();
            failureStage = "connecting OpenVPN";
            connectOpenVpn(targetRegion, settings.getPiaUsername(), settings.getPiaPassword());
            openVpnConnected = true;
            failureStage = "restoring local routes";
            restoreLocalRouteSpecs(preservedLocalRoutes);

            currentRegion = targetRegion;
            failureStage = "resolving public IP";
            currentPublicIp = null;
            currentPublicIp = resolvePublicIp();
            connectionState = "connected";
            clearAutoConnectRetrySchedule();
            clearRuntimeError();
            lastRotationAtIso = Instant.now().toString();
            logger.info(VPN_TAG, "Re-applied " + preservedLocalRoutes.size() + " local route(s) after VPN connect.");

            failureStage = "resuming paused downloads";
            resumedTasks = downloadService.resumePausedDownloads(pauseResult.affectedTitles());
            failureStage = "ending maintenance pause";
            downloadService.endMaintenancePause(maintenanceReason + " complete");
            maintenancePauseActive = false;

            if (updateRotationSchedule) {
                int intervalMinutes = normalizeRotateInterval(settings.getRotateEveryMinutes());
                long nextAt = System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(intervalMinutes);
                nextRotationAtMs = nextAt;
                nextRotationAtIso = Instant.ofEpochMilli(nextAt).toString();
            }

            return new VpnRotationResult(
                    true,
                    successMessage,
                    previousIp,
                    currentPublicIp,
                    currentRegion,
                    pauseResult.getAffectedTasks(),
                    resumedTasks,
                    triggeredBy,
                    lastRotationAtIso
            );
        } catch (Exception e) {
            String failureMessage = buildVpnTransitionFailureMessage(maintenanceReason, failureStage, e);
            logger.warn(VPN_TAG, "⚠️ VPN rotation failed: " + sanitizeForLog(e.getMessage()));
            if (openVpnConnected || !preservedLocalRoutes.isEmpty()) {
                failureMessage = appendVpnTransitionFailureDetail(
                        failureMessage,
                        cleanupFailedRotation(preservedLocalRoutes)
                );
            }
            currentPublicIp = null;
            currentPublicIp = resolvePublicIp();
            connectionState = "error";
            if (maintenancePauseActive) {
                try {
                    downloadService.endMaintenancePause(maintenanceReason + " failed");
                } catch (Exception maintenancePauseError) {
                    String cleanupMessage = buildVpnTransitionFollowUpFailureMessage(
                            "ending maintenance pause",
                            maintenancePauseError
                    );
                    logger.warn(VPN_TAG, sanitizeForLog(cleanupMessage));
                    failureMessage = appendVpnTransitionFailureDetail(failureMessage, cleanupMessage);
                }
                maintenancePauseActive = false;
            }
            try {
                resumedTasks = downloadService.resumePausedDownloads(pauseResult.affectedTitles());
            } catch (Exception resumeError) {
                String cleanupMessage = buildVpnTransitionFollowUpFailureMessage(
                        "resuming paused downloads",
                        resumeError
                );
                logger.warn(VPN_TAG, sanitizeForLog(cleanupMessage));
                failureMessage = appendVpnTransitionFailureDetail(failureMessage, cleanupMessage);
            }
            setRuntimeError(failureMessage);
            return new VpnRotationResult(
                    false,
                    failureMessage,
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

    /**
     * Builds the primary user-facing failure message for a VPN transition stage.
     *
     * @param operationLabel The transition label such as VPN rotation or VPN auto-connect.
     * @param stage          The stage where the failure occurred.
     * @param error          The original failure.
     * @return The user-facing failure message.
     */
    private String buildVpnTransitionFailureMessage(String operationLabel, String stage, Exception error) {
        String label = Optional.ofNullable(operationLabel)
                .filter(value -> !value.isBlank())
                .orElse("VPN transition");
        String normalizedStage = Optional.ofNullable(stage)
                .filter(value -> !value.isBlank())
                .orElse("an unknown stage");
        String detail = Optional.ofNullable(error)
                .map(Throwable::getMessage)
                .filter(message -> !message.isBlank())
                .map(this::sanitizeForLog)
                .orElse("Unexpected VPN transition error.");
        return label + " failed while " + normalizedStage + ": " + detail;
    }

    /**
     * Builds a follow-up cleanup failure detail for a VPN transition that already failed earlier.
     *
     * @param stage The cleanup stage that also failed.
     * @param error The cleanup failure.
     * @return The follow-up cleanup detail.
     */
    private String buildVpnTransitionFollowUpFailureMessage(String stage, Exception error) {
        String normalizedStage = Optional.ofNullable(stage)
                .filter(value -> !value.isBlank())
                .orElse("performing cleanup");
        String detail = Optional.ofNullable(error)
                .map(Throwable::getMessage)
                .filter(message -> !message.isBlank())
                .map(this::sanitizeForLog)
                .orElse("Unexpected VPN cleanup error.");
        return "Cleanup also failed while " + normalizedStage + ": " + detail;
    }

    /**
     * Appends a cleanup detail to an existing VPN transition failure message without dropping the primary cause.
     *
     * @param failureMessage The primary failure message.
     * @param detail         The cleanup detail to append.
     * @return The combined failure message.
     */
    private String appendVpnTransitionFailureDetail(String failureMessage, String detail) {
        String base = Optional.ofNullable(failureMessage)
                .filter(value -> !value.isBlank())
                .orElse("VPN transition failed.");
        String normalizedDetail = Optional.ofNullable(detail).filter(value -> !value.isBlank()).orElse("");
        if (normalizedDetail.isBlank()) {
            return base;
        }
        return base + " " + normalizedDetail;
    }

    /**
     * Indicates whether Raven should start a background VPN connection attempt.
     *
     * @return {@code true} when the tunnel is down and no other VPN action is in flight.
     */
    private boolean shouldEnsureConnected() {
        return !isVpnConnected()
                && !isOpenVpnRunning()
                && !rotationInProgress.get()
                && !loginTestInProgress.get();
    }

    /**
     * Indicates whether the scheduler may perform another VPN auto-connect attempt yet.
     *
     * @param now The current epoch milliseconds.
     * @return {@code true} when the retry cooldown has elapsed.
     */
    private boolean isAutoConnectRetryReady(long now) {
        return nextAutoConnectAttemptAtMs <= 0L || now >= nextAutoConnectAttemptAtMs;
    }

    /**
     * Schedules Raven's next background auto-connect retry.
     *
     * @param now The current epoch milliseconds.
     */
    private void scheduleNextAutoConnectRetry(long now) {
        nextAutoConnectAttemptAtMs = now + AUTO_CONNECT_RETRY_COOLDOWN_MS;
    }

    /**
     * Clears any pending background auto-connect retry delay.
     */
    private void clearAutoConnectRetrySchedule() {
        nextAutoConnectAttemptAtMs = 0L;
    }

    /**
     * Returns a fresh Vault-backed Raven VPN settings snapshot for VPN-critical decisions.
     *
     * @return The latest DownloadVpnSettings.
     */
    private DownloadVpnSettings getLiveVpnSettings() {
        return settingsService.getDownloadVpnSettingsFresh();
    }

    /**
     * Disconnects the current VPN process and restores preserved local routes after a failed rotation attempt.
     *
     * @param preservedLocalRoutes The local routes captured before Raven connected OpenVPN.
     * @return An appended cleanup failure message, or {@code null} when cleanup succeeded.
     */
    private String cleanupFailedRotation(List<String> preservedLocalRoutes) {
        disconnectOpenVpn();
        try {
            restoreLocalRouteSpecs(preservedLocalRoutes);
            return null;
        } catch (IOException restoreError) {
            logger.warn(VPN_TAG, "Failed to restore local routes after rotation failure | reason="
                    + sanitizeForLog(restoreError.getMessage()));
            return "Failed to restore local routes after VPN rotation: "
                    + sanitizeForLog(restoreError.getMessage());
        }
    }

    List<String> captureLocalRouteSpecs() throws IOException {
        LinkedHashSet<String> preserved = new LinkedHashSet<>();
        for (String line : runCommandForOutput(List.of("ip", "-o", "-4", "route", "show", "table", "main"))) {
            String routeSpec = normalizeRouteSpec(line);
            if (routeSpec == null || shouldSkipPreservedRoute(routeSpec)) {
                continue;
            }
            preserved.add(routeSpec);
        }
        return List.copyOf(preserved);
    }

    void restoreLocalRouteSpecs(List<String> routeSpecs) throws IOException {
        if (routeSpecs == null || routeSpecs.isEmpty()) {
            return;
        }

        for (String routeSpec : routeSpecs) {
            String normalized = normalizeRouteSpec(routeSpec);
            if (normalized == null || shouldSkipPreservedRoute(normalized)) {
                continue;
            }

            List<String> command = new ArrayList<>();
            command.add("ip");
            command.add("route");
            command.add("replace");
            command.addAll(Arrays.asList(normalized.split("\\s+")));
            runCommand(command);
        }
    }

    List<String> runCommandForOutput(List<String> command) throws IOException {
        if (command == null || command.isEmpty()) {
            throw new IOException("Command cannot be empty.");
        }

        ProcessBuilder builder = new ProcessBuilder(command);
        builder.redirectErrorStream(true);
        Process process = builder.start();

        List<String> output = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.add(line);
            }
        }

        boolean finished;
        try {
            finished = process.waitFor(ROUTE_COMMAND_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            throw new IOException("Command interrupted: " + String.join(" ", command), interrupted);
        }

        if (!finished) {
            process.destroyForcibly();
            throw new IOException("Command timed out: " + String.join(" ", command));
        }

        int exit = process.exitValue();
        if (exit != 0) {
            String detail = output.isEmpty() ? "" : " | " + sanitizeForLog(String.join(" | ", output));
            throw new IOException("Command failed (" + exit + "): " + String.join(" ", command) + detail);
        }

        return output;
    }

    void runCommand(List<String> command) throws IOException {
        runCommandForOutput(command);
    }

    private String normalizeRouteSpec(String routeSpec) {
        String trimmed = Optional.ofNullable(routeSpec).orElse("").trim();
        if (trimmed.isBlank()) {
            return null;
        }
        return trimmed.replaceAll("\\s+", " ");
    }

    private boolean shouldSkipPreservedRoute(String routeSpec) {
        String normalized = Optional.ofNullable(routeSpec).orElse("").trim();
        if (normalized.isBlank()) {
            return true;
        }

        if (normalized.regionMatches(true, 0, "default ", 0, "default ".length())) {
            return true;
        }

        return LOOPBACK_ROUTE_DEVICE_PATTERN.matcher(normalized).find()
                || VPN_ROUTE_DEVICE_PATTERN.matcher(normalized).find();
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

    /**
     * Loads the available PIA regions from the discovered profile files.
     *
     * @return The discovered region options.
     * @throws IOException When the profile directory cannot be prepared or read.
     */
    private List<VpnRegionOption> loadRegions() throws IOException {
        long now = System.currentTimeMillis();
        if (!cachedRegions.isEmpty() && now - cachedRegionsAtMs < PROFILE_REFRESH_TTL.toMillis()) {
            return cachedRegions;
        }

        Path configRoot = ensurePiaProfiles();
        LinkedHashMap<String, Path> profilesByRegion = new LinkedHashMap<>();
        for (Path entry : discoverProfileFiles(configRoot)) {
            profilesByRegion.putIfAbsent(extractRegionId(entry), entry);
        }

        List<VpnRegionOption> options = new ArrayList<>();
        for (Map.Entry<String, Path> entry : profilesByRegion.entrySet()) {
            String regionId = entry.getKey();
            String endpoint = parseRemoteEndpoint(entry.getValue());
            options.add(new VpnRegionOption(regionId, prettifyRegionLabel(regionId), endpoint));
        }
        options.sort(Comparator.comparing(VpnRegionOption::label, String.CASE_INSENSITIVE_ORDER));

        cachedRegions = List.copyOf(options);
        cachedRegionsAtMs = now;
        return cachedRegions;
    }

    /**
     * Ensures the on-disk PIA profile tree exists and refreshes it when the cached archive is stale.
     *
     * @return The profile root directory.
     * @throws IOException When no usable PIA profiles are available.
     */
    private Path ensurePiaProfiles() throws IOException {
        Path vpnRoot = resolveVpnRoot();
        Path archivePath = vpnRoot.resolve("openvpn-ip.zip");
        Path configRoot = vpnRoot.resolve("profiles");
        Files.createDirectories(vpnRoot);

        synchronized (profileRefreshLock) {
            boolean refreshArchive = shouldRefreshArchive(archivePath, configRoot);
            if (refreshArchive) {
                try {
                    refreshPiaProfilesAtomically(vpnRoot, archivePath, configRoot);
                    clearProfileFailure();
                    cachedRegions = List.of();
                    cachedRegionsAtMs = 0L;
                } catch (IOException e) {
                    List<Path> preservedProfiles = discoverProfileFiles(configRoot);
                    boolean usingFallbackProfiles = !preservedProfiles.isEmpty();
                    String message = buildProfileErrorMessage(e, usingFallbackProfiles);
                    recordProfileFailure(message);
                    if (!usingFallbackProfiles) {
                        throw new IOException(message, e);
                    }
                }
            }

            List<Path> profiles = discoverProfileFiles(configRoot);
            if (profiles.isEmpty()) {
                String message = "PIA OpenVPN profiles are unavailable. Refresh the Raven VPN profiles and try again.";
                recordProfileFailure(message);
                throw new IOException(message);
            }
        }

        return configRoot;
    }

    /**
     * Determines whether the cached PIA profile archive should be refreshed.
     *
     * @param archivePath The cached archive path.
     * @param configRoot  The extracted profile root.
     * @return {@code true} when Raven should download a fresh archive.
     * @throws IOException When the existing profile tree cannot be inspected.
     */
    private boolean shouldRefreshArchive(Path archivePath, Path configRoot) throws IOException {
        if (!Files.exists(archivePath)) {
            return true;
        }

        if (discoverProfileFiles(configRoot).isEmpty()) {
            return true;
        }

        long modifiedAt = Files.getLastModifiedTime(archivePath).toMillis();
        return System.currentTimeMillis() - modifiedAt > PROFILE_REFRESH_TTL.toMillis();
    }

    /**
     * Downloads the upstream PIA OpenVPN archive into the supplied path.
     *
     * @param archivePath The target archive path.
     * @throws IOException When the download fails.
     */
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

    /**
     * Extracts a downloaded PIA archive into the supplied directory.
     *
     * @param archivePath The downloaded archive.
     * @param configRoot The extraction target directory.
     * @throws IOException When extraction fails.
     */
    private void extractArchive(Path archivePath, Path configRoot) throws IOException {
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

    /**
     * Refreshes the cached PIA profiles into a temporary directory and swaps them into place only after validation.
     *
     * @param vpnRoot     The VPN provider root directory.
     * @param archivePath The cached archive path.
     * @param configRoot  The extracted profile root.
     * @throws IOException When the refreshed archive cannot be downloaded, extracted, or validated.
     */
    private void refreshPiaProfilesAtomically(Path vpnRoot, Path archivePath, Path configRoot) throws IOException {
        Path tempArchive = Files.createTempFile(vpnRoot, "pia-openvpn-", ".zip");
        Path tempConfigRoot = Files.createTempDirectory(vpnRoot, "pia-profiles-");
        Path backupConfigRoot = null;
        boolean swappedProfiles = false;

        try {
            downloadArchive(tempArchive);
            extractArchive(tempArchive, tempConfigRoot);

            if (discoverProfileFiles(tempConfigRoot).isEmpty()) {
                throw new IOException("PIA OpenVPN profile archive did not contain any .ovpn files.");
            }

            if (Files.exists(configRoot)) {
                backupConfigRoot = vpnRoot.resolve("profiles-backup-" + UUID.randomUUID());
                movePath(configRoot, backupConfigRoot);
            }

            movePath(tempConfigRoot, configRoot);
            swappedProfiles = true;

            try {
                movePath(tempArchive, archivePath);
            } catch (IOException e) {
                logger.warn(VPN_TAG, "Failed to replace cached PIA archive: " + sanitizeForLog(e.getMessage()));
            }
        } catch (IOException e) {
            if (swappedProfiles) {
                cleanupPath(configRoot);
            }
            if (!swappedProfiles && backupConfigRoot != null && Files.exists(backupConfigRoot) && Files.exists(configRoot)) {
                cleanupPath(configRoot);
            }
            if (backupConfigRoot != null && Files.exists(backupConfigRoot) && !Files.exists(configRoot)) {
                movePath(backupConfigRoot, configRoot);
            }
            throw e;
        } finally {
            if (backupConfigRoot != null && Files.exists(backupConfigRoot)) {
                cleanupPath(backupConfigRoot);
            }
            cleanupPath(tempConfigRoot);
            cleanupPath(tempArchive);
        }
    }

    /**
     * Discovers `.ovpn` profile files recursively under the supplied root.
     *
     * @param configRoot The extracted profile root.
     * @return The discovered profile files sorted by relative path.
     * @throws IOException When the directory tree cannot be walked.
     */
    private List<Path> discoverProfileFiles(Path configRoot) throws IOException {
        if (configRoot == null || !Files.exists(configRoot)) {
            return List.of();
        }

        try (var walk = Files.walk(configRoot)) {
            return walk.filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".ovpn"))
                    .sorted(Comparator.comparing(
                            path -> configRoot.relativize(path).toString(),
                            String.CASE_INSENSITIVE_ORDER
                    ))
                    .toList();
        }
    }

    /**
     * Extracts a normalized Raven region id from the supplied profile path.
     *
     * @param profilePath The discovered profile file.
     * @return The normalized region id.
     */
    private String extractRegionId(Path profilePath) {
        String fileName = profilePath.getFileName().toString();
        String withoutExtension = fileName.substring(0, fileName.length() - ".ovpn".length());
        return withoutExtension.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * Builds a user-facing profile refresh error message.
     *
     * @param error                 The original failure.
     * @param usingFallbackProfiles Whether Raven kept previously extracted profiles.
     * @return The message surfaced through Raven runtime status.
     */
    private String buildProfileErrorMessage(Exception error, boolean usingFallbackProfiles) {
        String detail = Optional.ofNullable(error)
                .map(Throwable::getMessage)
                .filter(message -> !message.isBlank())
                .orElse("Unable to refresh PIA OpenVPN profiles.");
        String message = detail.startsWith("PIA ") ? detail : "PIA OpenVPN profile refresh failed: " + detail;
        if (usingFallbackProfiles) {
            return message + " Keeping last known-good PIA profiles.";
        }
        return message;
    }

    /**
     * Stores a runtime error that originated from profile discovery or refresh.
     *
     * @param message The user-facing error message.
     */
    private void recordProfileFailure(String message) {
        lastError = Optional.ofNullable(message).filter(value -> !value.isBlank())
                .orElse("PIA OpenVPN profiles are unavailable.");
        profileErrorActive = true;
    }

    /**
     * Stores a non-profile runtime error.
     *
     * @param message The user-facing error message.
     */
    private void setRuntimeError(String message) {
        lastError = message;
        profileErrorActive = false;
    }

    /**
     * Clears Raven's runtime error state after a successful refresh or rotation.
     */
    private void clearRuntimeError() {
        lastError = null;
        profileErrorActive = false;
    }

    /**
     * Clears any stale profile-specific error once Raven has completed a successful profile refresh.
     */
    private void clearProfileFailure() {
        if (profileErrorActive) {
            clearRuntimeError();
        }
    }

    /**
     * Moves a file or directory into place, preferring atomic replacement when the filesystem supports it.
     *
     * @param source The source path.
     * @param target The destination path.
     * @throws IOException When the move fails.
     */
    private void movePath(Path source, Path target) throws IOException {
        if (source == null || target == null || !Files.exists(source)) {
            return;
        }

        Path parent = target.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        try {
            Files.move(
                    source,
                    target,
                    java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                    java.nio.file.StandardCopyOption.ATOMIC_MOVE
            );
        } catch (java.nio.file.AtomicMoveNotSupportedException ignored) {
            Files.move(source, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /**
     * Removes a temporary file or directory tree without surfacing cleanup failures to callers.
     *
     * @param path The temporary path to remove.
     */
    private void cleanupPath(Path path) {
        if (path == null || !Files.exists(path)) {
            return;
        }

        try {
            if (!Files.isDirectory(path)) {
                Files.deleteIfExists(path);
                return;
            }

            try (var walk = Files.walk(path)) {
                walk.sorted(Comparator.reverseOrder())
                        .forEach(entry -> {
                            try {
                                Files.deleteIfExists(entry);
                            } catch (IOException ignored) {
                                // best-effort cleanup of temporary VPN paths
                            }
                        });
            }
        } catch (IOException e) {
            logger.debug(VPN_TAG, "Failed to clean up VPN path: " + sanitizeForLog(e.getMessage()));
        }
    }

    void connectOpenVpn(String region, String username, String password) throws IOException {
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

    /**
     * Starts a temporary OpenVPN session to validate the supplied PIA credentials.
     *
     * @param configPath The region profile path.
     * @param username   The supplied PIA username.
     * @param password   The supplied PIA password.
     * @return The observed public IP reported while the probe session is connected.
     * @throws IOException When the probe process cannot start or complete successfully.
     */
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

    /**
     * Indicates whether Raven currently has a live, established OpenVPN tunnel.
     *
     * @return {@code true} when the tunnel is connected and the process is still alive.
     */
    private boolean isVpnConnected() {
        return "connected".equalsIgnoreCase(connectionState) && isOpenVpnRunning();
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

    /**
     * Resolves the PIA profile path for a region id by scanning the extracted profile tree recursively.
     *
     * @param region The requested region id.
     * @return The matching profile path.
     * @throws IOException When the profile tree cannot be prepared.
     */
    private Path resolveProfilePath(String region) throws IOException {
        Path configRoot = ensurePiaProfiles();
        String normalizedRegion = Optional.ofNullable(region).orElse("").trim().toLowerCase(Locale.ROOT);
        for (Path profilePath : discoverProfileFiles(configRoot)) {
            if (normalizedRegion.equals(extractRegionId(profilePath))) {
                return profilePath;
            }
        }
        throw new IllegalStateException("PIA region profile not found: " + normalizedRegion);
    }

    private String resolveRequestedRegion(String requestedRegion, DownloadVpnSettings settings) {
        String requested = Optional.ofNullable(requestedRegion).orElse("").trim().toLowerCase(Locale.ROOT);
        if (!requested.isBlank()) {
            return requested;
        }
        return resolveConfiguredRegion(settings);
    }

    /**
     * Resolves the normalized configured region from the stored Raven VPN settings.
     *
     * @param settings The stored Raven VPN settings snapshot.
     * @return The normalized configured region id.
     */
    private String resolveConfiguredRegion(DownloadVpnSettings settings) {
        return Optional.ofNullable(settings)
                .map(DownloadVpnSettings::getRegion)
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

    String resolvePublicIp() {
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
