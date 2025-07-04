package com.paxkun.raven.service.download;

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
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
