import test from "node:test";
import assert from "node:assert/strict";

import {interpretRavenQueueResponse} from "../src/components/noona/downloadQueueResults.mjs";

test("interpretRavenQueueResponse accepts queued results only when Raven marks them accepted", () => {
    assert.deepEqual(
        interpretRavenQueueResponse({
            httpStatus: 202,
            payload: {status: "queued", message: "Download queued for: Solo Leveling"},
        }),
        {
            accepted: true,
            queueStatus: "queued",
            message: "Download queued for: Solo Leveling",
        },
    );
});

test("interpretRavenQueueResponse keeps partial queue results accepted", () => {
    assert.deepEqual(
        interpretRavenQueueResponse({
            httpStatus: 202,
            payload: {status: "partial", message: "Queued 1 download(s). Skipped 1 already-active title(s)."},
        }),
        {
            accepted: true,
            queueStatus: "partial",
            message: "Queued 1 download(s). Skipped 1 already-active title(s).",
        },
    );
});

test("interpretRavenQueueResponse rejects semantic failures even when a payload message is present", () => {
    assert.deepEqual(
        interpretRavenQueueResponse({
            httpStatus: 410,
            payload: {status: "search_expired", message: "Search session expired or not found. Please search again."},
        }),
        {
            accepted: false,
            queueStatus: "search_expired",
            message: "Search session expired or not found. Please search again.",
        },
    );
});

test("interpretRavenQueueResponse rejects unexpected payload statuses on accepted HTTP codes", () => {
    assert.deepEqual(
        interpretRavenQueueResponse({
            httpStatus: 202,
            payload: {status: "search_expired"},
            fallbackMessage: "Queue failed (HTTP 202).",
        }),
        {
            accepted: false,
            queueStatus: "search_expired",
            message: "Queue failed (HTTP 202).",
        },
    );
});
