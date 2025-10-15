// services/warden/tests/dockerUtilties.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    pullImageIfNeeded,
    normalizeDockerProgressEvent,
    formatDockerProgressMessage,
} from '../docker/dockerUtilties.mjs';

test('normalizeDockerProgressEvent preserves layer metadata and formats message', () => {
    const event = normalizeDockerProgressEvent(
        {
            id: 'layer-a',
            status: 'Downloading',
            progressDetail: { current: 12, total: 24 },
        },
        { fallbackId: 'redis:latest' },
    );

    assert.equal(event.layerId, 'layer-a');
    assert.equal(event.phase, 'Downloading');
    assert.equal(event.status, 'Downloading');
    assert.equal(event.detail, '12/24');
    assert.equal(event.progressDetail.current, 12);
    assert.equal(event.progressDetail.total, 24);
    assert.equal(event.id, 'layer-a');
    assert.ok(event.message?.includes('[layer-a]'));
});

test('formatDockerProgressMessage omits empty parts', () => {
    const message = formatDockerProgressMessage({ layerId: 'layer-b', status: 'Waiting' });
    assert.equal(message, '[layer-b] Waiting');
});

test('pullImageIfNeeded emits layer-aware progress payloads', async () => {
    const events = [];
    const dockerInstance = {
        listImages: async () => [],
        pull: (_image, callback) => {
            callback(null, { id: 'stream' });
        },
        modem: {
            followProgress: (_stream, onFinished, onProgress) => {
                onProgress({
                    id: 'layer-c',
                    status: 'Downloading',
                    progressDetail: { current: 5, total: 10 },
                });
                onProgress({ status: 'Pull complete' });
                onFinished();
            },
        },
    };

    await pullImageIfNeeded('library/redis:latest', {
        dockerInstance,
        onProgress: (event) => events.push(event),
    });

    assert.ok(events.length >= 2, 'Expected multiple progress events');

    const first = events[0];
    assert.equal(first.layerId, 'layer-c');
    assert.equal(first.phase, 'Downloading');
    assert.equal(first.status, 'Downloading');
    assert.equal(first.detail, '5/10');
    assert.ok(first.message?.includes('[layer-c]'));

    const last = events.at(-1);
    assert.equal(last.layerId, 'library/redis:latest');
    assert.equal(last.status, 'complete');
    assert.equal(last.detail, 'Image pulled successfully');
    assert.ok(last.message?.includes('[library/redis:latest]'));
});
