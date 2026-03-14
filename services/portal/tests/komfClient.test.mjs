/**
 * @fileoverview Covers Komf client search and series-detail handling.
 * Related files:
 * - clients/komfClient.mjs
 * Times this file has been edited: 3
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import createKomfClient from '../clients/komfClient.mjs';

test('searchSeriesMetadata queries Komf Kavita metadata search with the selected series id', async () => {
    const calls = [];
    const komf = createKomfClient({
        baseUrl: 'http://noona-komf:8085',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify([
                {
                    title: 'Solo Leveling',
                    provider: 'MANGA_UPDATES',
                    resultId: '15180124327',
                },
            ]), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const results = await komf.searchSeriesMetadata('Solo Leveling', {seriesId: 17});

    assert.equal(Array.isArray(results), true);
    assert.equal(results[0].title, 'Solo Leveling');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.pathname, '/api/kavita/metadata/search');
    assert.equal(requestUrl.searchParams.get('name'), 'Solo Leveling');
    assert.equal(requestUrl.searchParams.get('seriesId'), '17');
});

test('identifySeriesMetadata posts the Komf identify payload', async () => {
    const calls = [];
    const komf = createKomfClient({
        baseUrl: 'http://noona-komf:8085',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({
                jobId: 'job-123',
            }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        },
    });

    const result = await komf.identifySeriesMetadata({
        seriesId: 17,
        libraryId: 4,
        provider: 'MANGADEX',
        providerSeriesId: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0',
    });

    assert.equal(result.jobId, 'job-123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'POST');
    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.pathname, '/api/kavita/metadata/identify');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
        libraryId: '4',
        seriesId: '17',
        provider: 'MANGADEX',
        providerSeriesId: '32d76d19-8a05-4db0-9fc2-e0b0648fe9d0',
    });
});

test('getSeriesMetadataDetails queries the Komf series-details route', async () => {
    const calls = [];
    const komf = createKomfClient({
        baseUrl: 'http://noona-komf:8085',
        fetchImpl: async (url, options) => {
            calls.push({url, options});
            return new Response(JSON.stringify({
                provider: 'MANGA_UPDATES',
                providerSeriesId: '15180124327',
                libraryId: '4',
                books: [
                    {
                        providerBookId: 'book-1',
                        volumeNumber: 1,
                        startChapter: 1,
                        endChapter: 12,
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

    const result = await komf.getSeriesMetadataDetails({
        provider: 'MANGA_UPDATES',
        providerSeriesId: '15180124327',
        libraryId: 4,
    });

    assert.equal(result.provider, 'MANGA_UPDATES');
    assert.equal(result.providerSeriesId, '15180124327');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.pathname, '/api/kavita/metadata/series-details');
    assert.equal(requestUrl.searchParams.get('provider'), 'MANGA_UPDATES');
    assert.equal(requestUrl.searchParams.get('providerSeriesId'), '15180124327');
    assert.equal(requestUrl.searchParams.get('libraryId'), '4');
});
