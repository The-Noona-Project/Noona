import test from "node:test";
import assert from "node:assert/strict";

import {backendJsonResponse} from "../src/app/api/noona/backendResponses.mjs";

test("backendJsonResponse returns an empty 204 response without throwing", async () => {
    const response = backendJsonResponse(null, 204);

    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
});

test("backendJsonResponse keeps JSON payloads for non-204 responses", async () => {
    const response = backendJsonResponse({ok: true, message: "queued"}, 202);

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {ok: true, message: "queued"});
});
