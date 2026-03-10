import assert from 'node:assert/strict';
import test from 'node:test';

import {resolveDiscordPresenceSnapshot} from '../discord/presenceUpdater.mjs';

test('resolveDiscordPresenceSnapshot prioritizes active Warden service updates', () => {
    const snapshot = resolveDiscordPresenceSnapshot({
        serviceActivity: {
            name: 'noona-moon',
            status: 'updating',
        },
        ravenSummary: {
            activeDownloads: 2,
            currentDownload: {title: 'Solo Leveling'},
        },
    });

    assert.equal(snapshot.name, 'Updating Moon');
    assert.equal(snapshot.status, 'dnd');
});

test('resolveDiscordPresenceSnapshot reports the current Raven download when active', () => {
    const snapshot = resolveDiscordPresenceSnapshot({
        serviceActivity: null,
        ravenSummary: {
            activeDownloads: 2,
            currentTask: {
                title: 'Solo Leveling',
                status: 'downloading',
            },
        },
    });

    assert.equal(snapshot.name, 'Downloading Solo Leveling (+1)');
    assert.equal(snapshot.status, 'online');
});

test('resolveDiscordPresenceSnapshot falls back to the legacy currentDownload payload', () => {
    const snapshot = resolveDiscordPresenceSnapshot({
        serviceActivity: null,
        ravenSummary: {
            activeDownloads: 1,
            currentDownload: {title: 'Omniscient Reader'},
        },
    });

    assert.equal(snapshot.name, 'Downloading Omniscient Reader');
    assert.equal(snapshot.status, 'online');
});

test('resolveDiscordPresenceSnapshot reports recovering Raven work when no active download is running', () => {
    const snapshot = resolveDiscordPresenceSnapshot({
        serviceActivity: null,
        ravenSummary: {
            activeDownloads: 0,
            currentTask: {
                title: 'Dungeon Reset',
                status: 'recovering',
            },
        },
    });

    assert.equal(snapshot.name, 'Recovering Dungeon Reset');
    assert.equal(snapshot.status, 'idle');
});

test('resolveDiscordPresenceSnapshot reports the current Raven title check when idle otherwise', () => {
    const checkingSnapshot = resolveDiscordPresenceSnapshot({
        serviceActivity: null,
        ravenSummary: {
            state: 'checking',
            currentCheck: {title: 'Omniscient Reader'},
        },
    });
    assert.equal(checkingSnapshot.name, 'Checking Omniscient Reader');
    assert.equal(checkingSnapshot.status, 'idle');

    const idleSnapshot = resolveDiscordPresenceSnapshot({
        serviceActivity: null,
        ravenSummary: {state: 'idle'},
    });
    assert.equal(idleSnapshot.name, 'Idle');
    assert.equal(idleSnapshot.status, 'idle');
});
