package com.paxkun.raven.controller;

import com.paxkun.raven.service.LoggerService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Locale;
import java.util.Map;

@RestController
@RequestMapping("/v1/debug")
@RequiredArgsConstructor
public class DebugController {

    private final LoggerService loggerService;

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
            if (normalized.isEmpty()) {
                return null;
            }

            if (normalized.equals("1") || normalized.equals("true") || normalized.equals("yes") || normalized.equals("on") || normalized.equals("super")) {
                return true;
            }

            if (normalized.equals("0") || normalized.equals("false") || normalized.equals("no") || normalized.equals("off")) {
                return false;
            }
        }

        return null;
    }
}
