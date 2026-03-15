/**
 * @fileoverview Covers Portal's private Discord DM downloadall command parsing and routing.
 * Related files:
 * - discord/directMessageRouter.mjs
 * - clients/ravenClient.mjs
 * Times this file has been edited: 1
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDirectMessageHandler,
    formatBulkQueueSummary,
    parseDownloadAllCommand,
} from '../discord/directMessageRouter.mjs';

const createDirectMessage = ({content, authorId = '1234567890'} = {}) => {
    const replies = [];
    return {
        message: {
            content,
            guildId: null,
            inGuild: () => false,
            author: {
                id: authorId,
                bot: false,
            },
            reply: async payload => {
                replies.push(payload);
                return payload;
            },
        },
        replies,
    };
};

test('parseDownloadAllCommand normalizes the DM command filters', () => {
    const parsed = parseDownloadAllCommand('downloadall type:managa nsfw:false titlegroup:a');

    assert.equal(parsed.matched, true);
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.filters, {
        type: 'Manga',
        nsfw: false,
        titlePrefix: 'a',
    });
});

test('createDirectMessageHandler accepts downloadall prefixes for the configured superuser DM', async () => {
    const calls = [];
    const handler = createDirectMessageHandler({
        superuserId: '1234567890',
        raven: {
            bulkQueueDownload: async filters => {
                calls.push(filters);
                return {
                    status: 'queued',
                    message: 'Queued matching titles.',
                    filters,
                    pagesScanned: 2,
                    matchedCount: 1,
                    queuedCount: 1,
                    skippedActiveCount: 0,
                    failedCount: 0,
                    queuedTitles: ['Alpha Start'],
                    skippedActiveTitles: [],
                    failedTitles: [],
                };
            },
        },
    });

    for (const command of [
        'downloadall type:managa nsfw:false titlegroup:a',
        '/downloadall type:managa nsfw:false titlegroup:a',
        '!downloadall type:managa nsfw:false titlegroup:a',
    ]) {
        const {message, replies} = createDirectMessage({content: command});
        await handler(message);

        assert.equal(replies.length, 2);
        assert.match(replies[0].content, /Queueing Raven bulk download/i);
        assert.match(replies[1].content, /Raven bulk queue finished/i);
        assert.match(replies[1].content, /Queued titles \(first 10\)/i);
    }

    assert.deepEqual(calls, [
        {type: 'Manga', nsfw: false, titlePrefix: 'a'},
        {type: 'Manga', nsfw: false, titlePrefix: 'a'},
        {type: 'Manga', nsfw: false, titlePrefix: 'a'},
    ]);
});

test('createDirectMessageHandler returns a friendly validation reply for superuser mistakes', async () => {
    let called = false;
    const handler = createDirectMessageHandler({
        superuserId: '1234567890',
        raven: {
            bulkQueueDownload: async () => {
                called = true;
                return {};
            },
        },
    });
    const {message, replies} = createDirectMessage({
        content: 'downloadall type:manga titlegroup:a',
    });

    await handler(message);

    assert.equal(called, false);
    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /Use `downloadall type:manga nsfw:false titlegroup:a`/);
    assert.match(replies[0].content, /nsfw must be true or false/i);
});

test('createDirectMessageHandler ignores downloadall attempts from non-superusers', async () => {
    let called = false;
    const handler = createDirectMessageHandler({
        superuserId: '1234567890',
        raven: {
            bulkQueueDownload: async () => {
                called = true;
                return {};
            },
        },
    });
    const {message, replies} = createDirectMessage({
        content: 'downloadall type:manga nsfw:false titlegroup:a',
        authorId: '9988776655',
    });

    await handler(message);

    assert.equal(called, false);
    assert.deepEqual(replies, []);
});

test('formatBulkQueueSummary only includes the first ten titles in each result bucket', () => {
    const titles = Array.from({length: 11}, (_, index) => `Title ${index + 1}`);
    const summary = formatBulkQueueSummary({
        status: 'partial',
        message: 'Queued some titles.',
        filters: {
            type: 'Manga',
            nsfw: false,
            titlePrefix: 'a',
        },
        pagesScanned: 4,
        matchedCount: 11,
        queuedCount: 11,
        skippedActiveCount: 11,
        failedCount: 11,
        queuedTitles: titles,
        skippedActiveTitles: titles,
        failedTitles: titles,
    });

    assert.match(summary, /Title 10/);
    assert.doesNotMatch(summary, /Title 11/);
});
