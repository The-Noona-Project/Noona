package com.paxkun.old;

import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.jetbrains.annotations.Contract;
import org.jetbrains.annotations.NotNull;

import java.io.*;
import java.nio.file.*;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Handles zipping of downloaded files into a single archive for user download.
 */
@Slf4j
public class ZipperAPI {

    @Getter
    private static final File zipFile = new File("downloads.zip");

    /**
     * Zips all files inside the given directory.
     *
     * @param downloadDir The directory containing files to be zipped.
     */
    public static void zipAllFiles(Path downloadDir) {
        log.info("📦 Starting zipping process...");
        //StatusAPI.broadcastLog("📦 Zipping files...");

        try (ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(zipFile))) {
            try (Stream<Path> paths = Files.walk(downloadDir)) {
                paths.filter(Files::isRegularFile)
                        .forEach(path -> {
                            try {
                                zos.putNextEntry(new ZipEntry(downloadDir.relativize(path).toString()));
                                Files.copy(path, zos);
                                zos.closeEntry();
                            } catch (IOException e) {
                                log.error("❌ Error zipping file: {}", path, e);
                            }
                        });
            }
            log.info("✅ Zipping complete! Ready for download.");
        } catch (IOException e) {
            log.error("❌ Zipping error", e);
        }
    }

    /**
     * Provides an InputStream for the generated ZIP file.
     *
     * @return FileInputStream of the ZIP file.
     * @throws FileNotFoundException if the ZIP file is not found.
     */
    @NotNull
    @Contract(" -> new")
    public static FileInputStream getZipFileInputStream() throws FileNotFoundException {
        return new FileInputStream(zipFile);
    }
}
