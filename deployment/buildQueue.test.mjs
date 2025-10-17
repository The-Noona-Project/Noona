import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildQueue } from './buildQueue.mjs';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('build queue honors FIFO ordering under constrained capacity', async () => {
    const queue = new BuildQueue({ workerThreads: 2, subprocessesPerWorker: 1, logger: silentLogger });
    const starts = [];

    const schedule = (name, wait) => queue.enqueue({
        name,
        run: async report => {
            starts.push(name);
            report({ message: `${name} underway` });
            await delay(wait);
            return name;
        }
    });

    const promises = [
        schedule('moon', 60),
        schedule('warden', 20),
        schedule('portal', 10)
    ];

    await Promise.allSettled(promises);
    await queue.drain();

    assert.deepEqual(starts.slice(0, 2), ['moon', 'warden']);
    assert.equal(starts[2], 'portal');

    const results = queue.getResults();
    assert.equal(results.length, 3);
    assert.ok(results.every(entry => entry.status === 'fulfilled'));
    assert.ok(results.every(entry => typeof entry.duration === 'number'));
});

test('raven jobs execute after others with expanded capacity', async () => {
    const queue = new BuildQueue({ workerThreads: 2, subprocessesPerWorker: 2, logger: silentLogger });
    const order = [];
    const capacities = [];

    const schedule = name => queue.enqueue({
        name,
        run: () => {
            order.push(name);
            capacities.push(queue.getCurrentCapacity());
            return name;
        }
    });

    await Promise.allSettled([
        schedule('moon'),
        schedule('sage')
    ]);
    await queue.drain();

    assert.deepEqual(order, ['moon', 'sage']);
    assert.deepEqual(capacities, [2, 2]);

    queue.useMaxCapacity();

    await schedule('raven');
    await queue.drain();

    assert.deepEqual(order, ['moon', 'sage', 'raven']);
    assert.equal(capacities[2], 4);
});
