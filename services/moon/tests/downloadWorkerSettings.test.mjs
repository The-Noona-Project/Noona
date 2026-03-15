import test from "node:test";
import assert from "node:assert/strict";

import {
    CPU_CORE_UNPINNED,
    formatCpuCoreIdDraft,
    formatWorkerCpuLabel,
    normalizeCpuCoreIdDrafts,
} from "../src/components/noona/downloadWorkerSettings.mjs";

test("normalizeCpuCoreIdDrafts pads to the configured worker count", () => {
    assert.deepEqual(normalizeCpuCoreIdDrafts([4, -1], 4), ["4", "-1", "-1", "-1"]);
});

test("formatCpuCoreIdDraft clamps invalid values to the unpinned sentinel", () => {
    assert.equal(formatCpuCoreIdDraft(""), CPU_CORE_UNPINNED);
    assert.equal(formatCpuCoreIdDraft(-9), CPU_CORE_UNPINNED);
    assert.equal(formatCpuCoreIdDraft("7"), "7");
});

test("formatWorkerCpuLabel describes pinned and unpinned workers", () => {
    assert.equal(formatWorkerCpuLabel(6), "CPU 6");
    assert.equal(formatWorkerCpuLabel(-1), "CPU auto");
});
