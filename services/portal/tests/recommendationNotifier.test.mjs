import assert from 'node:assert/strict';
import test from 'node:test';

import {createRecommendationNotifier} from '../discord/recommendationNotifier.mjs';

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

test('recommendation notifier DMs users when recommendations are approved and stores a sent marker', async () => {
    const recommendations = [
        {
            _id: 'rec-approved-1',
            status: 'approved',
            title: 'Solo Leveling',
            requestedBy: {
                discordId: 'discord-user-1',
            },
            approvedBy: {
                username: 'CaptainPax',
            },
        },
    ];
    const messages = [];

    const notifier = createRecommendationNotifier({
        discordClient: {
            sendDirectMessage: async (userId, payload) => {
                messages.push({userId, payload});
                return {id: `dm-${messages.length}`};
            },
        },
        vaultClient: {
            findRecommendations: async () => recommendations.map((entry) => ({...entry})),
            updateRecommendation: async ({query, update} = {}) => {
                const index = recommendations.findIndex((entry) => matchesQuery(entry, query));
                if (index < 0) {
                    return {status: 'ok', matched: 0, modified: 0};
                }

                recommendations[index] = applyUpdate(recommendations[index], update);
                return {status: 'ok', matched: 1, modified: 1};
            },
        },
        ravenClient: {
            getLibrary: async () => [],
        },
        kavitaClient: {},
        pollMs: 60000,
        logger: {},
    });

    notifier.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    notifier.stop();

    assert.equal(messages.length, 1);
    assert.equal(messages[0].userId, 'discord-user-1');
    assert.match(messages[0].payload.content, /approved by \*\*CaptainPax\*\*/i);
    assert.ok(typeof recommendations[0]?.notifications?.approvalDmSentAt === 'string');
    assert.equal(recommendations[0]?.notifications?.approvalDmMessageId, 'dm-1');
});

test('recommendation notifier DMs completion with Kavita link once title is available', async () => {
    const recommendations = [
        {
            _id: 'rec-complete-1',
            status: 'approved',
            title: 'Omniscient Reader',
            requestedBy: {
                discordId: 'discord-user-2',
            },
            notifications: {
                approvalDmSentAt: '2026-03-07T00:00:00.000Z',
            },
        },
    ];
    const messages = [];

    const notifier = createRecommendationNotifier({
        discordClient: {
            sendDirectMessage: async (userId, payload) => {
                messages.push({userId, payload});
                return {id: `dm-${messages.length}`};
            },
        },
        vaultClient: {
            findRecommendations: async () => recommendations.map((entry) => ({...entry})),
            updateRecommendation: async ({query, update} = {}) => {
                const index = recommendations.findIndex((entry) => matchesQuery(entry, query));
                if (index < 0) {
                    return {status: 'ok', matched: 0, modified: 0};
                }

                recommendations[index] = applyUpdate(recommendations[index], update);
                return {status: 'ok', matched: 1, modified: 1};
            },
        },
        ravenClient: {
            getLibrary: async () => [
                {
                    title: 'Omniscient Reader',
                    sourceUrl: 'https://asura.example/omniscient',
                },
            ],
        },
        kavitaClient: {
            getBaseUrl: () => 'http://noona-kavita:5000/',
            searchTitles: async () => ({
                series: [
                    {
                        libraryId: 4,
                        seriesId: 17,
                        name: 'Omniscient Reader',
                    },
                ],
            }),
        },
        pollMs: 60000,
        logger: {},
    });

    notifier.start();
    await notifier.refresh();
    notifier.stop();

    assert.equal(messages.length, 1);
    assert.equal(messages[0].userId, 'discord-user-2');
    assert.match(messages[0].payload.content, /now available in Kavita/i);
    assert.match(messages[0].payload.content, /Open in Kavita: http:\/\/noona-kavita:5000\/library\/4\/series\/17/i);
    assert.ok(typeof recommendations[0]?.notifications?.completionDmSentAt === 'string');
    assert.equal(recommendations[0]?.notifications?.completionDmMessageId, 'dm-1');
    assert.equal(recommendations[0]?.notifications?.completionKavitaUrl, 'http://noona-kavita:5000/library/4/series/17');
    assert.ok(typeof recommendations[0]?.completedAt === 'string');
});

test('recommendation notifier applies deferred metadata after Raven import is ready', async () => {
    const recommendations = [
        {
            _id: 'rec-deferred-metadata-1',
            status: 'approved',
            title: 'Solo Leveling',
            href: 'https://source.example/solo-leveling',
            metadataSelection: {
                status: 'pending',
                query: 'Solo Leveling',
                title: 'Solo Leveling',
                provider: 'mal',
                providerSeriesId: '15180124327',
                coverImageUrl: 'https://covers.example/solo-leveling.jpg',
                adultContent: true,
            },
            notifications: {
                approvalDmSentAt: '2026-03-07T00:00:00.000Z',
            },
        },
    ];
    const identifyCalls = [];
    const coverCalls = [];
    const seriesDetailsCalls = [];
    const updateTitleCalls = [];
    const volumeMapCalls = [];

    const notifier = createRecommendationNotifier({
        discordClient: {},
        vaultClient: {
            findRecommendations: async () => recommendations.map((entry) => ({...entry})),
            updateRecommendation: async ({query, update} = {}) => {
                const index = recommendations.findIndex((entry) => matchesQuery(entry, query));
                if (index < 0) {
                    return {status: 'ok', matched: 0, modified: 0};
                }

                recommendations[index] = applyUpdate(recommendations[index], update);
                return {status: 'ok', matched: 1, modified: 1};
            },
        },
        ravenClient: {
            getLibrary: async () => [
                {
                    uuid: 'title-uuid-7',
                    title: 'Solo Leveling',
                    sourceUrl: 'https://source.example/solo-leveling',
                },
            ],
            updateTitle: async (uuid, payload) => {
                updateTitleCalls.push({uuid, payload});
                return {
                    uuid,
                    coverUrl: payload?.coverUrl,
                };
            },
            applyTitleVolumeMap: async (uuid, payload) => {
                volumeMapCalls.push({uuid, payload});
                return {
                    title: {uuid},
                    renameSummary: {
                        attempted: true,
                        renamed: 2,
                        skippedCollisions: 0,
                        alreadyMatched: 0,
                    },
                };
            },
        },
        kavitaClient: {
            searchTitles: async () => ({
                series: [
                    {
                        libraryId: 4,
                        seriesId: 17,
                        name: 'Solo Leveling',
                    },
                ],
            }),
            setSeriesCover: async (payload) => {
                coverCalls.push(payload);
                return {ok: true};
            },
        },
        komfClient: {
            identifySeriesMetadata: async (payload) => {
                identifyCalls.push(payload);
                return {ok: true};
            },
            getSeriesMetadataDetails: async (payload) => {
                seriesDetailsCalls.push(payload);
                return {
                    provider: 'mal',
                    providerSeriesId: '15180124327',
                    books: [
                        {
                            providerBookId: 'book-1',
                            volumeNumber: 1,
                            startChapter: 1,
                            endChapter: 5,
                        },
                        {
                            providerBookId: 'book-2',
                            volumeNumber: 2,
                            chapters: [6],
                        },
                    ],
                };
            },
        },
        pollMs: 60000,
        logger: {},
    });

    notifier.start();
    await notifier.refresh();
    notifier.stop();

    assert.deepEqual(identifyCalls, [
        {
            seriesId: 17,
            libraryId: 4,
            provider: 'mal',
            providerSeriesId: '15180124327',
        },
    ]);
    assert.deepEqual(seriesDetailsCalls, [
        {
            provider: 'mal',
            providerSeriesId: '15180124327',
            libraryId: 4,
        },
    ]);
    assert.deepEqual(updateTitleCalls, [
        {
            uuid: 'title-uuid-7',
            payload: {
                coverUrl: 'https://covers.example/solo-leveling.jpg',
            },
        },
    ]);
    assert.deepEqual(volumeMapCalls, [
        {
            uuid: 'title-uuid-7',
            payload: {
                provider: 'mal',
                providerSeriesId: '15180124327',
                chapterVolumeMap: {'1': 1, '2': 1, '3': 1, '4': 1, '5': 1, '6': 2},
                autoRename: true,
            },
        },
    ]);
    assert.deepEqual(coverCalls, [
        {
            seriesId: 17,
            url: 'https://covers.example/solo-leveling.jpg',
            lockCover: true,
        },
    ]);
    assert.equal(recommendations[0]?.metadataSelection?.status, 'applied');
    assert.equal(recommendations[0]?.metadataSelection?.appliedSeriesId, 17);
    assert.equal(recommendations[0]?.metadataSelection?.appliedLibraryId, 4);
    assert.equal(recommendations[0]?.metadataSelection?.titleUuid, 'title-uuid-7');
    assert.equal(recommendations[0]?.metadataSelection?.adultContent, true);
    assert.ok(Array.isArray(recommendations[0]?.timeline));
    assert.ok(recommendations[0].timeline.some((event) => /saved metadata selection/i.test(event?.body ?? '')));
    assert.ok(recommendations[0].timeline.some((event) => /chapter-to-volume map/i.test(event?.body ?? '')));
});

test('recommendation notifier prefers configured external Kavita URL for completion DMs', async () => {
    const recommendations = [
        {
            _id: 'rec-complete-2',
            status: 'approved',
            title: 'Omniscient Reader',
            requestedBy: {
                discordId: 'discord-user-2',
            },
            notifications: {
                approvalDmSentAt: '2026-03-07T00:00:00.000Z',
            },
        },
    ];
    const messages = [];

    const notifier = createRecommendationNotifier({
        discordClient: {
            sendDirectMessage: async (userId, payload) => {
                messages.push({userId, payload});
                return {id: `dm-${messages.length}`};
            },
        },
        vaultClient: {
            findRecommendations: async () => recommendations.map((entry) => ({...entry})),
            updateRecommendation: async ({query, update} = {}) => {
                const index = recommendations.findIndex((entry) => matchesQuery(entry, query));
                if (index < 0) {
                    return {status: 'ok', matched: 0, modified: 0};
                }

                recommendations[index] = applyUpdate(recommendations[index], update);
                return {status: 'ok', matched: 1, modified: 1};
            },
        },
        ravenClient: {
            getLibrary: async () => [
                {
                    title: 'Omniscient Reader',
                    sourceUrl: 'https://asura.example/omniscient',
                },
            ],
        },
        kavitaClient: {
            getBaseUrl: () => 'http://noona-kavita:5000/',
            searchTitles: async () => ({
                series: [
                    {
                        libraryId: 4,
                        seriesId: 17,
                        name: 'Omniscient Reader',
                    },
                ],
            }),
        },
        kavitaBaseUrl: 'https://kavita.example.com',
        pollMs: 60000,
        logger: {},
    });

    notifier.start();
    await notifier.refresh();
    notifier.stop();

    assert.equal(messages.length, 1);
    assert.match(messages[0].payload.content, /Open in Kavita: https:\/\/kavita\.example\.com\/library\/4\/series\/17/i);
    assert.equal(recommendations[0]?.notifications?.completionKavitaUrl, 'https://kavita.example.com/library/4/series/17');
});

test('recommendation notifier still DMs when Raven finishes downloading but Kavita has no link yet', async () => {
    const recommendations = [
        {
            _id: 'rec-complete-3',
            status: 'approved',
            title: 'Omniscient Reader',
            href: 'https://asura.example/omniscient',
            approvedAt: '2026-03-07T00:00:00.000Z',
            requestedBy: {
                discordId: 'discord-user-2',
            },
            notifications: {
                approvalDmSentAt: '2026-03-07T00:01:00.000Z',
            },
        },
    ];
    const messages = [];

    const notifier = createRecommendationNotifier({
        discordClient: {
            sendDirectMessage: async (userId, payload) => {
                messages.push({userId, payload});
                return {id: `dm-${messages.length}`};
            },
        },
        vaultClient: {
            findRecommendations: async () => recommendations.map((entry) => ({...entry})),
            updateRecommendation: async ({query, update} = {}) => {
                const index = recommendations.findIndex((entry) => matchesQuery(entry, query));
                if (index < 0) {
                    return {status: 'ok', matched: 0, modified: 0};
                }

                recommendations[index] = applyUpdate(recommendations[index], update);
                return {status: 'ok', matched: 1, modified: 1};
            },
        },
        ravenClient: {
            getLibrary: async () => [],
            getDownloadStatus: async () => [],
            getDownloadHistory: async () => [
                {
                    title: 'Omniscient Reader',
                    sourceUrl: 'https://asura.example/omniscient',
                    status: 'completed',
                    completedChapters: 12,
                    completedAt: '2026-03-07T00:08:00.000Z',
                    latestChapter: 'Chapter 12',
                },
            ],
        },
        kavitaClient: {
            getBaseUrl: () => 'http://noona-kavita:5000/',
            searchTitles: async () => ({
                series: [],
            }),
        },
        moonBaseUrl: 'http://moon.example:3000',
        pollMs: 60000,
        logger: {},
    });

    notifier.start();
    await notifier.refresh();
    notifier.stop();

    assert.equal(messages.length, 1);
    assert.equal(messages[0].userId, 'discord-user-2');
    assert.match(messages[0].payload.content, /Raven finished downloading your recommendation/i);
    assert.match(messages[0].payload.content, /Kavita may still be indexing it/i);
    assert.match(messages[0].payload.content, /Track it in Moon: http:\/\/moon\.example:3000\/myrecommendations\/rec-complete-3/i);
    assert.ok(Array.isArray(recommendations[0]?.timeline));
    assert.ok(recommendations[0].timeline.some((event) => event?.type === 'download-completed'));
    assert.ok(typeof recommendations[0]?.notifications?.completionDmSentAt === 'string');
    assert.equal(recommendations[0]?.notifications?.completionDmMessageId, 'dm-1');
    assert.equal(recommendations[0]?.notifications?.completionKavitaUrl, null);
    assert.equal(recommendations[0]?.notifications?.completionMoonUrl, 'http://moon.example:3000/myrecommendations/rec-complete-3');
    assert.ok(typeof recommendations[0]?.completedAt === 'string');
});

test('recommendation notifier DMs users when admins add timeline comments and stores sent markers', async () => {
    const recommendations = [
        {
            _id: 'rec-comment-1',
            status: 'pending',
            title: 'Wind Breaker',
            requestedBy: {
                discordId: 'discord-user-3',
            },
            timeline: [
                {
                    id: 'comment-1',
                    type: 'comment',
                    createdAt: '2026-03-07T00:00:00.000Z',
                    body: 'We need one more source check before approval.',
                    actor: {
                        role: 'admin',
                        username: 'ModBot',
                    },
                },
            ],
        },
    ];
    const messages = [];

    const notifier = createRecommendationNotifier({
        discordClient: {
            sendDirectMessage: async (userId, payload) => {
                messages.push({userId, payload});
                return {id: `dm-${messages.length}`};
            },
        },
        vaultClient: {
            findRecommendations: async () => recommendations.map((entry) => ({...entry})),
            updateRecommendation: async ({query, update} = {}) => {
                const index = recommendations.findIndex((entry) => matchesQuery(entry, query));
                if (index < 0) {
                    return {status: 'ok', matched: 0, modified: 0};
                }

                recommendations[index] = applyUpdate(recommendations[index], update);
                return {status: 'ok', matched: 1, modified: 1};
            },
        },
        ravenClient: {
            getLibrary: async () => [],
        },
        kavitaClient: {},
        wardenClient: {
            listServices: async () => ({
                services: [
                    {
                        name: 'noona-moon',
                        hostServiceUrl: 'http://moon.example:3000',
                    },
                ],
            }),
        },
        pollMs: 60000,
        logger: {},
    });

    notifier.start();
    await notifier.refresh();
    await notifier.refresh();
    notifier.stop();

    assert.equal(messages.length, 1);
    assert.equal(messages[0].userId, 'discord-user-3');
    assert.match(messages[0].payload.content, /new admin comment/i);
    assert.match(messages[0].payload.content, /Open in Moon: http:\/\/moon\.example:3000\/myrecommendations\/rec-comment-1/i);
    assert.ok(typeof recommendations[0]?.timeline?.[0]?.notifications?.adminCommentDmSentAt === 'string');
    assert.equal(recommendations[0]?.timeline?.[0]?.notifications?.adminCommentDmMessageId, 'dm-1');
});

test('recommendation notifier appends Raven download timeline events for approved recommendations', async () => {
    const recommendations = [
        {
            _id: 'rec-download-1',
            status: 'approved',
            title: 'Solo Leveling',
            href: 'https://source.example/solo-leveling',
            approvedAt: '2026-03-07T00:00:00.000Z',
            requestedBy: {
                discordId: 'discord-user-4',
            },
            notifications: {
                approvalDmSentAt: '2026-03-07T00:01:00.000Z',
            },
        },
    ];

    const notifier = createRecommendationNotifier({
        discordClient: {
            sendDirectMessage: async () => ({id: 'dm-unused'}),
        },
        vaultClient: {
            findRecommendations: async () => recommendations.map((entry) => ({...entry})),
            updateRecommendation: async ({query, update} = {}) => {
                const index = recommendations.findIndex((entry) => matchesQuery(entry, query));
                if (index < 0) {
                    return {status: 'ok', matched: 0, modified: 0};
                }

                recommendations[index] = applyUpdate(recommendations[index], update);
                return {status: 'ok', matched: 1, modified: 1};
            },
        },
        ravenClient: {
            getLibrary: async () => [],
            getDownloadStatus: async () => [
                {
                    title: 'Solo Leveling',
                    sourceUrl: 'https://source.example/solo-leveling',
                    status: 'downloading',
                    totalChapters: 12,
                    completedChapters: 8,
                    currentChapter: 'Chapter 5',
                    lastUpdated: '2026-03-07T00:05:00.000Z',
                    startedAt: '2026-03-07T00:03:00.000Z',
                },
            ],
            getDownloadHistory: async () => [
                {
                    title: 'Solo Leveling',
                    sourceUrl: 'https://source.example/solo-leveling',
                    status: 'completed',
                    totalChapters: 12,
                    completedChapters: 12,
                    completedAt: '2026-03-07T00:08:00.000Z',
                    latestChapter: 'Chapter 12',
                },
            ],
        },
        kavitaClient: {},
        pollMs: 60000,
        logger: {},
    });

    notifier.start();
    await notifier.refresh();
    await notifier.refresh();
    notifier.stop();

    const timeline = Array.isArray(recommendations[0]?.timeline) ? recommendations[0].timeline : [];
    assert.equal(timeline.length, 3);
    assert.deepEqual(
        timeline.map((event) => event?.type),
        ['download-started', 'download-progress', 'download-completed'],
    );
    assert.equal(timeline[0]?.actor?.username, 'Raven');
    assert.match(timeline[0]?.body ?? '', /started downloading 12 chapters/i);
    assert.match(timeline[1]?.body ?? '', /downloaded 6 of 12 chapters so far/i);
    assert.match(timeline[2]?.body ?? '', /finished downloading 12 chapters/i);
});
