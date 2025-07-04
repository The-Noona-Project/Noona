package com.paxkun.raven.service.download;

import com.paxkun.raven.service.LoggerService;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * AutoCloseableExecutor is a wrapper for ExecutorService implementing AutoCloseable,
 * allowing use in try-with-resources blocks for clean and safe thread pool management.
 *
 * Usage Example:
 * <pre>
 * try (AutoCloseableExecutor executor = new AutoCloseableExecutor(Executors.newFixedThreadPool(4))) {
 *     executor.executor().submit(() -> { ... });
 * }
 * </pre>
 *
 * Author: Pax
 */
public record AutoCloseableExecutor(ExecutorService executor) implements AutoCloseable {

    @Autowired(required = false)
    private static LoggerService logger;

    /**
     * Closes the ExecutorService, waiting up to 1 hour for tasks to finish.
     * If interrupted or timeout occurs, forces shutdown immediately.
     */
    @Override
    public void close() {
        executor.shutdown();
        try {
            if (!executor.awaitTermination(1, TimeUnit.HOURS)) {
                executor.shutdownNow();
                if (logger != null) {
                    logger.warn("EXECUTOR", "⚠️ Executor did not terminate in time, forced shutdown.");
                }
            } else {
                if (logger != null) {
                    logger.info("EXECUTOR", "✅ Executor shutdown cleanly.");
                }
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
            if (logger != null) {
                logger.error("EXECUTOR", "❌ Executor shutdown interrupted: " + e.getMessage(), e);
            }
        }
    }
}
