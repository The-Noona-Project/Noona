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
