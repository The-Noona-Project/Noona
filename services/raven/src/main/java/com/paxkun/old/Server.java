package com.paxkun.old;

import io.javalin.Javalin;
import io.javalin.http.staticfiles.Location;
import lombok.Getter;

@Getter
public class Server {

    private final Javalin app; // Javalin instance for the server

    public Server() {
        /*
        this.app = Javalin.create(config -> {
            config.staticFiles.add("/public", Location.CLASSPATH); // Serve static files
        });
         */

        this.app = Javalin.create(config -> {
            // ✅ Set up static file serving
            config.staticFiles.add(staticFileConfig -> {
                staticFileConfig.directory = "/public";
                staticFileConfig.location = Location.CLASSPATH;
            });
        });
    }

    public void startServer() {
        app.start(7000);
        System.out.println("🚀 Server started on http://localhost:7000");
    }

    public void stopServer() {
        app.stop();
        System.out.println("🛑 Server stopped.");
    }

    public void populate() {

        // THIS IS NOT NEEDED - configs auto render static pages
        // ✅ Serve the main frontend page
        //app.get("/", ctx -> ctx.render("public/index.html"));

        // ✅ API routes (all under /api/)
        app.get("/api/health", ctx -> ctx.result("✅ WebAPI is running!"));

        // Route to trigger downloading files
        app.post("/api/startDownload", ctx -> {
            String url = ctx.formParam("url");
            String fileType = ctx.formParam("fileType");
            if (url == null || url.isEmpty() || fileType == null || fileType.isEmpty()) {
                ctx.status(400).result("❌ Invalid parameters.");
                return;
            }
            SearchAPI.startSearch(url, fileType);
            ctx.result("🔍 Searching and downloading files...");
        });

        // Route to check download status
        //app.get("/api/status", ctx -> ctx.result(StatusAPI.getStatus()));

        // Route to cancel download
        app.post("/api/cancel", ctx -> {
            CancelAPI.cancelDownload();
            ctx.result("⛔ Download canceled.");
        });

        // Route to serve the ZIP file
        app.get("/api/download", ctx -> {
            ctx.header("Content-Disposition", "attachment; filename=downloads.zip");
            ctx.contentType("application/zip");
            ctx.result(String.valueOf(ZipperAPI.getZipFile()));
        });

        System.out.println("🚀 Web server started on http://localhost:7000");
    }
}
