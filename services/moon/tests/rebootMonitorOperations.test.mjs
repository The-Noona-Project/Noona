import assert from "node:assert/strict";
import test from "node:test";

import {
    normalizeRebootMonitorOperation,
    REBOOT_MONITOR_OPERATION_BOOT_START,
    REBOOT_MONITOR_OPERATION_ECOSYSTEM_RESTART,
    REBOOT_MONITOR_OPERATION_UPDATE_SERVICES,
    resolveRebootMonitorMonitoredServices,
    resolveRebootMonitorRequest,
    resolveRebootMonitorRequiredServices,
} from "../src/components/noona/rebootMonitorOperations.mjs";

test("required lifecycle monitor services always include Warden, Sage, and Moon, with data services only when targeted", () => {
    assert.deepEqual(
        resolveRebootMonitorRequiredServices(["noona-mongo", "noona-portal"]),
        ["noona-warden", "noona-sage", "noona-moon", "noona-mongo"],
    );
    assert.deepEqual(
        resolveRebootMonitorMonitoredServices(["noona-mongo", "noona-portal"]),
        ["noona-warden", "noona-sage", "noona-moon", "noona-mongo", "noona-portal"],
    );
});

test("operation helpers normalize unknown values and build the correct lifecycle request targets", () => {
    assert.equal(normalizeRebootMonitorOperation(""), REBOOT_MONITOR_OPERATION_UPDATE_SERVICES);
    assert.deepEqual(
        resolveRebootMonitorRequest(REBOOT_MONITOR_OPERATION_BOOT_START, {body: {force: false}}),
        {path: "/api/noona/boot/start", method: "POST", body: {force: false}},
    );
    assert.deepEqual(
        resolveRebootMonitorRequest(REBOOT_MONITOR_OPERATION_ECOSYSTEM_RESTART, {}),
        {path: "/api/noona/settings/ecosystem/restart", method: "POST", body: {}},
    );
});
