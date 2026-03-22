import test from "node:test";
import assert from "node:assert/strict";

import {
    DEFAULT_BACKEND_READ_RETRY_ATTEMPTS,
    isRetryableBackendReadStatus,
    retryBackendRead,
} from "../src/app/api/noona/backendReadRetry.mjs";

test("retryBackendRead retries transient 502 responses and returns the later success", async () => {
    let calls = 0;

    const result = await retryBackendRead(async () => {
        calls += 1;
        if (calls === 1) {
            return {status: 502, payload: {error: "warming up"}};
        }

        return {status: 200, payload: {ok: true}};
    }, {delayMs: 0});

    assert.equal(calls, 2);
    assert.deepEqual(result, {status: 200, payload: {ok: true}});
});

test("retryBackendRead retries thrown transient read failures and returns the later success", async () => {
    let calls = 0;

    const result = await retryBackendRead(async () => {
        calls += 1;
        if (calls === 1) {
            throw new Error("All backends failed for /api/auth/status: http://noona-sage:3004 (fetch failed)");
        }

        return {status: 200, payload: {user: {username: "admin"}}};
    }, {delayMs: 0});

    assert.equal(calls, 2);
    assert.equal(result.status, 200);
    assert.equal(result.payload.user.username, "admin");
});

test("retryBackendRead does not retry non-retryable statuses", async () => {
    let calls = 0;

    const result = await retryBackendRead(async () => {
        calls += 1;
        return {status: 500, payload: {error: "hard failure"}};
    }, {delayMs: 0});

    assert.equal(calls, 1);
    assert.deepEqual(result, {status: 500, payload: {error: "hard failure"}});
    assert.equal(isRetryableBackendReadStatus(500), false);
});

test("retryBackendRead returns the final retryable failure after exhausting attempts", async () => {
    let calls = 0;

    const result = await retryBackendRead(async () => {
        calls += 1;
        return {status: 503, payload: {error: "still booting", attempt: calls}};
    }, {attempts: 2, delayMs: 0});

    assert.equal(calls, 2);
    assert.equal(result.status, 503);
    assert.equal(result.payload.attempt, 2);
});

test("retryBackendRead uses the documented default attempt count", async () => {
    let calls = 0;

    await retryBackendRead(async () => {
        calls += 1;
        return {status: 503, payload: {error: "still booting"}};
    }, {delayMs: 0});

    assert.equal(calls, DEFAULT_BACKEND_READ_RETRY_ATTEMPTS);
});
