import assert from "node:assert/strict";
import test from "node:test";

import {
    areVpnDraftsEqual,
    buildVpnRotateRequestBody,
    buildVpnSaveRequestBody,
    createVpnDraftSnapshot,
    formatVpnLoginOutcomeMessage,
    formatVpnRotationOutcomeMessage,
    hasVpnSettingsSnapshot,
    isVpnRuntimeBusy,
    resolveVpnMessageAfterRefresh,
    shouldDisableVpnControls,
    waitForVpnRuntimeToSettle,
} from "../src/components/noona/vpnSettingsFlow.mjs";

test("vpn controls stay locked while Raven reports connecting or rotating", () => {
    assert.equal(shouldDisableVpnControls({status: {connectionState: "connecting"}}), true);
    assert.equal(shouldDisableVpnControls({status: {rotating: true}}), true);
    assert.equal(shouldDisableVpnControls({status: {connectionState: "connected"}}), false);
    assert.equal(isVpnRuntimeBusy({connectionState: "rotating"}), true);
});

test("vpn message can survive a follow-up refresh when requested", () => {
    assert.equal(resolveVpnMessageAfterRefresh("VPN settings saved.", true), "VPN settings saved.");
    assert.equal(resolveVpnMessageAfterRefresh("VPN settings saved.", false), null);
});

test("vpn draft snapshots normalize values and track stored-password state", () => {
    const draft = createVpnDraftSnapshot({
        enabled: true,
        onlyDownloadWhenVpnOn: true,
        autoRotate: false,
        rotateEveryMinutes: "45",
        region: " us_texas ",
        piaUsername: " pia-user ",
        piaPassword: "",
        passwordConfigured: true,
    });

    assert.deepEqual(draft, {
        enabled: true,
        onlyDownloadWhenVpnOn: true,
        autoRotate: false,
        rotateEveryMinutes: 45,
        region: "us_texas",
        piaUsername: "pia-user",
        piaPassword: "",
        passwordConfigured: true,
    });
    assert.equal(areVpnDraftsEqual(draft, createVpnDraftSnapshot({...draft})), true);
    assert.equal(areVpnDraftsEqual(draft, {...draft, piaPassword: "new-secret"}), false);
});

test("vpn request builders send the current draft for save and rotate actions", () => {
    const draft = createVpnDraftSnapshot({
        enabled: true,
        onlyDownloadWhenVpnOn: true,
        autoRotate: true,
        rotateEveryMinutes: 30,
        region: "us_california",
        piaUsername: "pia-user",
        piaPassword: "",
        passwordConfigured: true,
    });

    assert.deepEqual(buildVpnSaveRequestBody({
        draft,
        applyNow: true,
        triggeredBy: "moon-settings",
    }), {
        enabled: true,
        onlyDownloadWhenVpnOn: true,
        autoRotate: true,
        rotateEveryMinutes: 30,
        region: "us_california",
        piaUsername: "pia-user",
        piaPassword: "",
        applyNow: true,
        triggeredBy: "moon-settings",
    });
    assert.deepEqual(buildVpnRotateRequestBody({
        draft: {...draft, piaPassword: "fresh-secret"},
        triggeredBy: "moon-settings",
    }), {
        enabled: true,
        onlyDownloadWhenVpnOn: true,
        autoRotate: true,
        rotateEveryMinutes: 30,
        region: "us_california",
        piaUsername: "pia-user",
        piaPassword: "fresh-secret",
        triggeredBy: "moon-settings",
    });
});

test("vpn settings payload detection ignores pure error payloads", () => {
    assert.equal(hasVpnSettingsSnapshot({error: "boom"}), false);
    assert.equal(hasVpnSettingsSnapshot({key: "downloads.vpn", enabled: true}), true);
});

test("vpn rotation polling waits for the runtime to settle", async () => {
    const snapshots = [
        {status: {connectionState: "connecting", rotating: true}},
        {status: {connectionState: "connected", rotating: false, region: "us_texas", publicIp: "198.51.100.12"}},
    ];
    let calls = 0;

    const settled = await waitForVpnRuntimeToSettle({
        refresh: async () => snapshots[Math.min(calls++, snapshots.length - 1)],
        timeoutMs: 1_000,
        pollMs: 0,
    });

    assert.equal(calls, 2);
    assert.deepEqual(settled, snapshots[1]);
});

test("vpn rotation outcome messages reflect success and failure", () => {
    assert.equal(
        formatVpnRotationOutcomeMessage({
            connectionState: "connected",
            region: "us_texas",
            publicIp: "198.51.100.12",
        }),
        "VPN rotation complete. (region us_texas, public IP 198.51.100.12)",
    );
    assert.equal(
        formatVpnRotationOutcomeMessage({
            connectionState: "error",
            lastError: "OpenVPN did not complete initialization in time.",
        }),
        "VPN rotation failed: OpenVPN did not complete initialization in time.",
    );
});

test("vpn login outcome messages keep the final probe result visible", () => {
    assert.equal(
        formatVpnLoginOutcomeMessage({
            message: "PIA login succeeded for region us_california.",
            region: "us_california",
            endpoint: "212.56.53.84",
            reportedIp: "198.51.100.42",
        }),
        "PIA login succeeded for region us_california. us_california (212.56.53.84)",
    );
    assert.equal(
        formatVpnLoginOutcomeMessage({
            ok: false,
            message: "",
            error: "PIA authentication failed.",
        }),
        "PIA authentication failed.",
    );
});
