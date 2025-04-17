package com.paxkun.old;

import com.paxkun.Main;
import lombok.Getter;

public class CancelAPI {

    @Getter
    private static boolean cancelRequested = false;

    public static void cancelDownload() {
        cancelRequested = true;
        System.out.println("⛔ Download process has been canceled.");

        // Stop the server by accessing it from Main
//        if (Main.getServer() != null) {
//            Main.getServer().stopServer();
//        }
    }

    public static void resetCancelRequest() {
        cancelRequested = false;
    }
}
