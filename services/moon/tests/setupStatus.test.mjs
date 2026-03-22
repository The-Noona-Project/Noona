import assert from "node:assert/strict";
import test from "node:test";

import {
    buildBootScreenHref,
    normalizeBootScreenReturnTo,
    normalizeSetupStatus,
} from "../src/components/noona/setupStatus.mjs";

test("normalizeSetupStatus preserves manual-boot lifecycle fields", () => {
    assert.deepEqual(
        normalizeSetupStatus({
            completed: true,
            configured: true,
            installing: false,
            debugEnabled: true,
            selectionMode: "selected",
            selectedServices: ["noona-portal", "noona-portal", "noona-raven"],
            lifecycleServices: ["noona-mongo", "noona-sage", "noona-moon", "noona-portal"],
            manualBootRequired: true,
        }),
        {
            completed: true,
            configured: true,
            installing: false,
            debugEnabled: true,
            selectionMode: "selected",
            selectedServices: ["noona-portal", "noona-raven"],
            lifecycleServices: ["noona-mongo", "noona-sage", "noona-moon", "noona-portal"],
            manualBootRequired: true,
            error: "",
        },
    );
});

test("boot screen helpers normalize unsafe return targets back to root", () => {
    assert.equal(normalizeBootScreenReturnTo("/downloads?view=grid"), "/downloads?view=grid");
    assert.equal(normalizeBootScreenReturnTo("https://example.com/elsewhere"), "/");
    assert.equal(buildBootScreenHref("/downloads?view=grid"), "/bootScreen?returnTo=%2Fdownloads%3Fview%3Dgrid");
});
