/**
 * Exposes Raven debug state endpoints.
 * Related files:
 * - src/main/java/com/paxkun/raven/service/LoggerService.java
 * - src/test/java/com/paxkun/raven/controller/DebugControllerTest.java
 * Times this file has been edited: 3
 */
package com.paxkun.raven.controller;

import com.paxkun.raven.service.LoggerService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Locale;
import java.util.Map;

/**
 * Exposes Raven debug state endpoints.
 */

@RestController
@RequestMapping("/v1/debug")
@RequiredArgsConstructor
public class DebugController {

    private final LoggerService loggerService;

    /**
     * Returns debug state.
     *
     * @return The resulting Object>>.
     */

    @GetMapping
    public ResponseEntity<Map<String, Object>> getDebugState() {
        return ResponseEntity.ok(Map.of("enabled", loggerService.isDebugEnabled()));
    }

    @PostMapping
    public ResponseEntity<?> setDebugState(@RequestBody(required = false) Map<String, Object> body) {
        Boolean enabled = parseBoolean(body != null ? body.get("enabled") : null);
        if (enabled == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "enabled must be a boolean value."));
        }

        loggerService.setDebugEnabled(enabled);
        loggerService.info("DEBUG_CONTROLLER", "Debug mode set to " + enabled);
        return ResponseEntity.ok(Map.of("enabled", loggerService.isDebugEnabled()));
    }

    private Boolean parseBoolean(Object value) {
        if (value instanceof Boolean boolValue) {
            return boolValue;
        }

        if (value instanceof Number numberValue) {
            return numberValue.doubleValue() > 0;
        }

        if (value instanceof String stringValue) {
            String normalized = stringValue.trim().toLowerCase(Locale.ROOT);
            return switch (normalized) {
                case "" -> null;
                case "0", "false", "no", "off" -> false;
                case "1", "true", "yes", "on", "super" -> true;
                default -> null;
            };
        }

        return null;
    }
}
