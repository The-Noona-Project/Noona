import test from "node:test";
import assert from "node:assert/strict";

import {
    buildBackendFailureMessage,
    resolveSageBaseUrls,
    SAGE_BACKEND_FAILURE_GUIDANCE,
} from "../src/app/api/noona/backendDiscovery.mjs";

test("resolveSageBaseUrls prefers explicit SAGE_BASE_URL ahead of Docker and localhost fallbacks", () => {
    const urls = resolveSageBaseUrls({
        SAGE_BASE_URL: "sage.internal:3004",
        SAGE_INTERNAL_BASE_URL: "http://noona-sage:3004",
    });

    assert.deepEqual(urls, [
        "http://sage.internal:3004",
        "http://noona-sage:3004",
        "http://host.docker.internal:3004",
        "http://127.0.0.1:3004",
        "http://localhost:3004",
    ]);
});

test("buildBackendFailureMessage keeps the Sage proxy failure actionable and token-safe", () => {
    const message = buildBackendFailureMessage("/api/settings/services/noona-moon/config", [
        "http://noona-sage:3004 (fetch failed)",
        "http://127.0.0.1:3004 (ECONNREFUSED)",
    ], {
        guidance: SAGE_BACKEND_FAILURE_GUIDANCE,
    });

    assert.match(message, /^All backends failed for \/api\/settings\/services\/noona-moon\/config:/);
    assert.match(message, /check noona-sage health/i);
    assert.match(message, /share noona-network/i);
    assert.match(message, /set noona-moon SAGE_BASE_URL/i);
    assert.doesNotMatch(message, /Authorization|Bearer|token=/i);
});
