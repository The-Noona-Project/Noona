/**
 * @fileoverview Covers Raven client request construction and payload handling.
 * Related files:
 * - clients/ravenClient.mjs
 * Times this file has been edited: 10
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import createPortalRavenClient from '../clients/ravenClient.mjs';

test('searchTitle requests the Raven search endpoint and returns the payload', async () => {
    const calls = [];
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({
                searchId: 'search-1',
                options: [
                    {index: '1', title: 'Solo Leveling', href: 'https://source.example/solo-leveling'},
                ],
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const payload = await raven.searchTitle('Solo Leveling');

    assert.equal(payload.searchId, 'search-1');
    assert.equal(payload.options[0].title, 'Solo Leveling');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(new URL(calls[0].url).pathname, '/v1/download/search/Solo%20Leveling');
});

test('getTitleDetails requests the Raven title-details endpoint and normalizes adult-content', async () => {
    const calls = [];
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({
                sourceUrl: 'https://source.example/solo-leveling',
                summary: 'A hunter rises.',
                type: 'Manhwa',
                adultContent: 'yes',
                associatedNames: ['Only I level up'],
                status: 'Complete',
                released: '2018',
                officialTranslation: 'yes',
                animeAdaptation: 'yes',
                relatedSeries: [
                    {
                        title: 'Solo Leveling: Ragnarok',
                        sourceUrl: 'https://source.example/ragnarok',
                        relation: 'Sequel',
                    },
                ],
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const payload = await raven.getTitleDetails('https://source.example/solo-leveling');

    assert.deepEqual(payload, {
        sourceUrl: 'https://source.example/solo-leveling',
        summary: 'A hunter rises.',
        type: 'Manhwa',
        adultContent: true,
        associatedNames: ['Only I level up'],
        status: 'Complete',
        released: '2018',
        officialTranslation: true,
        animeAdaptation: true,
        relatedSeries: [
            {
                title: 'Solo Leveling: Ragnarok',
                sourceUrl: 'https://source.example/ragnarok',
                relation: 'Sequel',
            },
        ],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(new URL(calls[0].url).pathname, '/v1/download/title-details');
    assert.equal(new URL(calls[0].url).searchParams.get('url'), 'https://source.example/solo-leveling');
});

test('getLibrary requests the Raven library endpoint and returns titles', async () => {
    const calls = [];
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify([
                {
                    uuid: 'title-1',
                    title: 'Solo Leveling',
                    sourceUrl: 'https://source.example/solo-leveling',
                },
            ]), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const titles = await raven.getLibrary();

    assert.equal(Array.isArray(titles), true);
    assert.equal(titles.length, 1);
    assert.equal(titles[0].uuid, 'title-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(new URL(calls[0].url).pathname, '/v1/library/getall');
});

test('getDownloadStatus requests the Raven download status endpoint and returns tasks', async () => {
    const calls = [];
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify([
                {
                    title: 'Solo Leveling',
                    status: 'downloading',
                },
            ]), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const tasks = await raven.getDownloadStatus();

    assert.equal(Array.isArray(tasks), true);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'downloading');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(new URL(calls[0].url).pathname, '/v1/download/status');
});

test('getDownloadHistory requests the Raven download history endpoint and returns tasks', async () => {
    const calls = [];
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify([
                {
                    title: 'Solo Leveling',
                    status: 'completed',
                },
            ]), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const tasks = await raven.getDownloadHistory();

    assert.equal(Array.isArray(tasks), true);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'completed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(new URL(calls[0].url).pathname, '/v1/download/status/history');
});

test('getTitle requests the Raven title endpoint and returns the payload', async () => {
    const calls = [];
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({
                uuid: 'title-1',
                title: 'Solo Leveling',
                coverUrl: 'https://covers.example/solo-leveling.jpg',
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const title = await raven.getTitle('title-1');

    assert.equal(title.uuid, 'title-1');
    assert.equal(title.coverUrl, 'https://covers.example/solo-leveling.jpg');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    assert.equal(new URL(calls[0].url).pathname, '/v1/library/title/title-1');
});

test('getTitle returns null when Raven responds with 404', async () => {
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async () => new Response(JSON.stringify({error: 'Not found'}), {
            status: 404,
            headers: {
                'Content-Type': 'application/json',
            },
        }),
    });

    const title = await raven.getTitle('missing-title');

    assert.equal(title, null);
});

test('updateTitle patches Raven title cover metadata', async () => {
    const calls = [];
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({
                uuid: 'title-1',
                coverUrl: 'https://covers.example/solo-leveling.jpg',
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const title = await raven.updateTitle('title-1', {
        coverUrl: 'https://covers.example/solo-leveling.jpg',
    });

    assert.equal(title.uuid, 'title-1');
    assert.equal(title.coverUrl, 'https://covers.example/solo-leveling.jpg');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'PATCH');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.equal(new URL(calls[0].url).pathname, '/v1/library/title/title-1');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        coverUrl: 'https://covers.example/solo-leveling.jpg',
    });
});

test('applyTitleVolumeMap posts Raven volume-map payloads', async () => {
    const calls = [];
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({
                title: {uuid: 'title-1'},
                renameSummary: {attempted: true, renamed: 2},
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const payload = await raven.applyTitleVolumeMap('title-1', {
        provider: 'MANGA_UPDATES',
        providerSeriesId: '15180124327',
        chapterVolumeMap: {'1': 1, '2': 1, '3': 2},
        autoRename: false,
    });

    assert.equal(payload.title.uuid, 'title-1');
    assert.equal(payload.renameSummary.renamed, 2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.equal(new URL(calls[0].url).pathname, '/v1/library/title/title-1/volume-map');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        provider: 'MANGA_UPDATES',
        providerSeriesId: '15180124327',
        chapterVolumeMap: {'1': 1, '2': 1, '3': 2},
        autoRename: false,
    });
});

test('bulkQueueDownload posts Raven bulk queue filters and accepts maintenance responses', async () => {
    const calls = [];
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({
                status: 'maintenance_paused',
                message: 'Bulk queue paused while VPN rotation completes.',
                filters: {
                    type: 'Manga',
                    nsfw: false,
                    titlePrefix: 'a',
                },
                pagesScanned: '2',
                matchedCount: '4',
                queuedCount: '0',
                skippedActiveCount: '3',
                failedCount: '1',
                queuedTitles: [],
                skippedActiveTitles: ['Another Dawn'],
                failedTitles: ['Abyss Reset'],
            }), {
                status: 409,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const result = await raven.bulkQueueDownload({
        type: 'Manga',
        nsfw: false,
        titlePrefix: 'a',
    });

    assert.equal(result.status, 'maintenance_paused');
    assert.equal(result.filters.type, 'Manga');
    assert.equal(result.filters.nsfw, false);
    assert.equal(result.pagesScanned, 2);
    assert.equal(result.skippedActiveTitles[0], 'Another Dawn');
    assert.equal(result.failedTitles[0], 'Abyss Reset');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.equal(new URL(calls[0].url).pathname, '/v1/download/bulk-queue');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        type: 'Manga',
        nsfw: false,
        titlePrefix: 'a',
    });
});


test('bulkQueueDownload requests the Raven bulk-queue endpoint and normalizes results for partial success (207)', async () => {
    const calls = [];
    const raven = createPortalRavenClient({
        baseUrl: 'http://noona-raven:8080',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({
                status: 'partial',
                message: 'Queued some titles.',
                filters: {
                    type: 'Manga',
                    nsfw: false,
                    titlePrefix: 'a',
                },
                pagesScanned: 2,
                matchedCount: 2,
                queuedCount: 1,
                skippedCount: 2,
                failedCount: 1,
                queuedTitles: ['Alpha Start'],
                skippedTitles: ['Another Dawn', 'Azure Echo'],
                failedTitles: ['Beta End'],
            }), {
                status: 207,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const result = await raven.bulkQueueDownload({
        type: 'Manga',
        nsfw: false,
        titlePrefix: 'a',
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.message, 'Queued some titles.');
    assert.equal(result.queuedCount, 1);
    assert.equal(result.skippedActiveCount, 2);
    assert.equal(result.failedCount, 1);
    assert.deepEqual(result.queuedTitles, ['Alpha Start']);
    assert.deepEqual(result.skippedActiveTitles, ['Another Dawn', 'Azure Echo']);
    assert.deepEqual(result.failedTitles, ['Beta End']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        type: 'Manga',
        nsfw: false,
        titlePrefix: 'a',
    });
});
