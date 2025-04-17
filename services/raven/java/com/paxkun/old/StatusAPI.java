package com.paxkun.old;

import io.javalin.websocket.WsContext;
import java.util.concurrent.atomic.AtomicBoolean;

public class StatusAPI {

    private static WsContext progressWsContext = null;
    private static final AtomicBoolean isDownloading = new AtomicBoolean(false);

    public static void startLogging() {
        System.out.println("📜 Logging initialized...");
    }

    // ✅ This method fixes "Cannot resolve method 'updateLog'"
    public static void updateLog(String message) {
        System.out.println(message); // Console log

        // Send logs to frontend via WebSocket
        if (progressWsContext != null) {
            progressWsContext.send("{\"logMessage\":\"" + message + "\"}");
        }
    }

    public static void startStatusServer() {
        System.out.println("📡 Status API initialized...");
    }
}
