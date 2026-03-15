import test from "node:test";
import assert from "node:assert/strict";

import {
    buildBackgroundTrackProxyHeaders,
    proxyBackgroundTrackRequest,
} from "../src/app/api/noona/media/backgroundTrackProxy.mjs";

test("buildBackgroundTrackProxyHeaders omits empty auth and range values", () => {
    assert.deepEqual(buildBackgroundTrackProxyHeaders({authorization: "", range: ""}), {});
});

test("proxyBackgroundTrackRequest forwards auth and range headers and preserves streaming metadata", async () => {
    let receivedInit = null;

    const response = await proxyBackgroundTrackRequest({
        authorization: "Bearer moon-token",
        range: "bytes=0-2",
        fetchTrack: async (init) => {
            receivedInit = init;
            return new Response("ID3", {
                status: 206,
                headers: {
                    "Accept-Ranges": "bytes",
                    "Content-Length": "3",
                    "Content-Range": "bytes 0-2/10",
                    "Content-Type": "audio/mpeg",
                },
            });
        },
    });

    assert.deepEqual(receivedInit, {
        headers: {
            Authorization: "Bearer moon-token",
            Range: "bytes=0-2",
        },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.equal(response.headers.get("content-range"), "bytes 0-2/10");
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString("utf8"), "ID3");
});
