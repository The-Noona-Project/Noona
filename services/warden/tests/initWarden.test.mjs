import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bootstrapWarden } from '../initWarden.mjs';

test('bootstrapWarden shuts down API server and exits when init fails', async () => {
    const shutdownCalls = [];
    const fakeWarden = {
        init: () => Promise.reject(new Error('boom')),
        shutdownAll: () => {
            shutdownCalls.push('shutdown');
            return Promise.resolve();
        },
    };

    const server = {
        listening: true,
        closed: false,
        close() {
            this.closed = true;
            this.listening = false;
        },
    };

    const exitCalls = [];
    const logMessages = [];
    const processStub = {
        exit: (code) => exitCalls.push(code),
        on: () => {},
    };

    const { initPromise } = bootstrapWarden({
        createWardenImpl: () => fakeWarden,
        startWardenServerImpl: () => ({ server }),
        errWriter: (message) => logMessages.push(message),
        processImpl: processStub,
        setIntervalImpl: () => {},
    });

    await initPromise;

    assert.deepEqual(exitCalls, [1]);
    assert.equal(server.closed, true);
    assert.deepEqual(shutdownCalls, ['shutdown']);
    assert.ok(logMessages.some((message) => message.includes('Fatal: boom')));
});

test('bootstrapWarden keeps server alive when init succeeds', async () => {
    const fakeWarden = {
        init: () => Promise.resolve(),
        shutdownAll: () => {},
    };

    const server = {
        listening: true,
        closed: false,
        close() {
            this.closed = true;
            this.listening = false;
        },
    };

    const exitCalls = [];
    const intervals = [];
    const processStub = {
        exit: (code) => exitCalls.push(code),
        on: () => {},
    };

    const { initPromise, closeApiServer } = bootstrapWarden({
        createWardenImpl: () => fakeWarden,
        startWardenServerImpl: () => ({ server }),
        processImpl: processStub,
        setIntervalImpl: (...args) => intervals.push(args),
    });

    await initPromise;

    assert.deepEqual(exitCalls, []);
    assert.equal(server.closed, false);
    assert.equal(intervals.length, 1);

    closeApiServer();
    assert.equal(server.closed, true);
});
