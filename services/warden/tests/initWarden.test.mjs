import assert from 'node:assert/strict';
import {test} from 'node:test';

import {bootstrapWarden} from '../initWarden.mjs';

test('bootstrapWarden shuts down API server and exits when init fails', async () => {
    const shutdownCalls = [];
    let capturedReadinessState = null;
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
        startWardenServerImpl: ({readinessState}) => {
            capturedReadinessState = readinessState;
            return {server};
        },
        errWriter: (message) => logMessages.push(message),
        processImpl: processStub,
        setIntervalImpl: () => {},
    });

    await initPromise;

    assert.deepEqual(exitCalls, [1]);
    assert.equal(server.closed, true);
    assert.deepEqual(shutdownCalls, ['shutdown']);
    assert.ok(logMessages.some((message) => message.includes('Fatal: boom')));
    assert.equal(capturedReadinessState.ready, false);
    assert.equal(capturedReadinessState.initializedAt, null);
    assert.equal(capturedReadinessState.error, 'boom');
});

test('bootstrapWarden keeps server alive when init succeeds', async () => {
    const fakeWarden = {
        init: () => Promise.resolve(),
        shutdownAll: () => {},
    };
    let capturedReadinessState = null;

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
        startWardenServerImpl: ({readinessState}) => {
            capturedReadinessState = readinessState;
            return {server};
        },
        processImpl: processStub,
        setIntervalImpl: (...args) => intervals.push(args),
    });

    await initPromise;

    assert.deepEqual(exitCalls, []);
    assert.equal(server.closed, false);
    assert.equal(intervals.length, 1);
    assert.equal(capturedReadinessState.ready, true);
    assert.equal(typeof capturedReadinessState.startedAt, 'string');
    assert.equal(typeof capturedReadinessState.initializedAt, 'string');
    assert.equal(capturedReadinessState.error, null);

    closeApiServer();
    assert.equal(server.closed, true);
});
