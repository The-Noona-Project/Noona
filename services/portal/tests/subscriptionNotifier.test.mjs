import assert from 'node:assert/strict';
import test from 'node:test';

import {createSubscriptionNotifier} from '../discord/subscriptionNotifier.mjs';

const getPathValue = (doc, path) => path.split('.').reduce((current, key) => {
    if (!current || typeof current !== 'object') {
        return undefined;
    }

    return current[key];
}, doc);

const setPathValue = (doc, path, value) => {
    const keys = path.split('.');
    let current = doc;
    for (let index = 0; index < keys.length - 1; index += 1) {
        const key = keys[index];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
};

const matchesQuery = (doc, query = {}) =>
    Object.entries(query).every(([key, value]) => getPathValue(doc, key) === value);

const applyUpdate = (doc, update = {}) => {
    const next = {...doc};
    if (update?.$set && typeof update.$set === 'object') {
        for (const [key, value] of Object.entries(update.$set)) {
            setPathValue(next, key, value);
        }
    }

    return next;
};

test('subscription notifier DMs subscribers for newly completed chapters and persists sent markers', async () => {
    const subscriptions = [
        {
            _id: 'sub-1',
            status: 'active',
            title: 'Solo Leveling',
            titleUuid: 'title-uuid-1',
            sourceUrl: 'https://source.example/solo-leveling',
            subscriber: {
                discordId: 'discord-user-1',
            },
            notifications: {
                chapterDmCount: 1,
                sentChapterKeys: ['uuid:title-uuid-1:1'],
            },
        },
    ];
    const messages = [];

    const notifier = createSubscriptionNotifier({
        discordClient: {
            sendDirectMessage: async (userId, payload) => {
                messages.push({userId, payload});
                return {id: `dm-${messages.length}`};
            },
        },
        vaultClient: {
            findSubscriptions: async () => subscriptions.map(entry => ({...entry})),
            updateSubscription: async ({query, update} = {}) => {
                const index = subscriptions.findIndex(entry => matchesQuery(entry, query));
                if (index < 0) {
                    return {status: 'ok', matched: 0, modified: 0};
                }

                subscriptions[index] = applyUpdate(subscriptions[index], update);
                return {status: 'ok', matched: 1, modified: 1};
            },
        },
        ravenClient: {
            getDownloadStatus: async () => [
                {
                    title: 'Solo Leveling',
                    titleUuid: 'title-uuid-1',
                    sourceUrl: 'https://source.example/solo-leveling',
                    completedChapterNumbers: ['1', '2'],
                    lastUpdated: '2026-03-08T00:05:00.000Z',
                },
            ],
            getDownloadHistory: async () => [
                {
                    title: 'Solo Leveling',
                    titleUuid: 'title-uuid-1',
                    sourceUrl: 'https://source.example/solo-leveling',
                    completedChapterNumbers: ['3'],
                    completedAt: '2026-03-08T00:10:00.000Z',
                },
            ],
        },
        pollMs: 60000,
        logger: {},
    });

    notifier.start();
    await notifier.refresh();
    notifier.stop();

    assert.equal(messages.length, 2);
    assert.equal(messages[0].userId, 'discord-user-1');
    assert.match(messages[0].payload.content, /Chapter 2/i);
    assert.match(messages[1].payload.content, /Chapter 3/i);
    assert.equal(subscriptions[0]?.notifications?.chapterDmCount, 3);
    assert.ok(typeof subscriptions[0]?.notifications?.lastChapterDmAt === 'string');
    assert.deepEqual(
        subscriptions[0]?.notifications?.sentChapterKeys,
        [
            'uuid:title-uuid-1:1',
            'uuid:title-uuid-1:2',
            'uuid:title-uuid-1:3',
        ],
    );
});

test('subscription notifier does not resend chapter DMs already recorded in sentChapterKeys', async () => {
    const subscriptions = [
        {
            _id: 'sub-2',
            status: 'active',
            title: 'Omniscient Reader',
            titleUuid: 'title-uuid-2',
            sourceUrl: 'https://source.example/omniscient',
            subscriber: {
                discordId: 'discord-user-2',
            },
            notifications: {
                chapterDmCount: 0,
                sentChapterKeys: [],
            },
        },
    ];
    const messages = [];

    const notifier = createSubscriptionNotifier({
        discordClient: {
            sendDirectMessage: async (userId, payload) => {
                messages.push({userId, payload});
                return {id: `dm-${messages.length}`};
            },
        },
        vaultClient: {
            findSubscriptions: async () => subscriptions.map(entry => ({...entry})),
            updateSubscription: async ({query, update} = {}) => {
                const index = subscriptions.findIndex(entry => matchesQuery(entry, query));
                if (index < 0) {
                    return {status: 'ok', matched: 0, modified: 0};
                }

                subscriptions[index] = applyUpdate(subscriptions[index], update);
                return {status: 'ok', matched: 1, modified: 1};
            },
        },
        ravenClient: {
            getDownloadStatus: async () => [
                {
                    title: 'Omniscient Reader',
                    titleUuid: 'title-uuid-2',
                    sourceUrl: 'https://source.example/omniscient',
                    completedChapterNumbers: ['120', '121'],
                    lastUpdated: '2026-03-08T01:00:00.000Z',
                },
            ],
            getDownloadHistory: async () => [],
        },
        pollMs: 60000,
        logger: {},
    });

    notifier.start();
    await notifier.refresh();
    await notifier.refresh();
    notifier.stop();

    assert.equal(messages.length, 2);
    assert.match(messages[0].payload.content, /Chapter 120/i);
    assert.match(messages[1].payload.content, /Chapter 121/i);
    assert.equal(subscriptions[0]?.notifications?.chapterDmCount, 2);
    assert.deepEqual(
        subscriptions[0]?.notifications?.sentChapterKeys,
        ['uuid:title-uuid-2:120', 'uuid:title-uuid-2:121'],
    );
});
