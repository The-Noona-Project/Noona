package com.paxkun.raven.service.download;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * A wrapper for ExecutorService implementing AutoCloseable for try-with-resources usage.
 */
public record AutoCloseableExecutor(ExecutorService executor) implements AutoCloseable {

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
