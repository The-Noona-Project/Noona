import test from "node:test";
import assert from "node:assert/strict";

import {
    buildLiveNotificationStorageKey,
    buildMoonMusicNotification,
    buildMoonMusicNotificationMessage,
    buildRecommendationDecisionToast,
    buildSubscriptionUpdateMessage,
    buildSubscriptionUpdateToast,
    collectRecommendationDecisionChanges,
    collectSubscriptionNotificationChanges,
    LIVE_NOTIFICATION_SEEN_STATE_STORAGE_PREFIX,
    NOONA_OPEN_MUSIC_CONTROLS_EVENT,
    parseLiveNotificationSeenState,
} from "../src/components/noona/siteNotificationLive.mjs";

test("recommendation decision helpers detect changed approval and denial states", () => {
    const entries = [
        {
            id: "req-approved",
            status: "accepted",
            title: "Blue Box",
            approvedAt: "2026-03-01T10:00:00.000Z",
        },
        {
            id: "req-denied",
            status: "declined",
            query: "Dandadan",
            deniedAt: "2026-03-02T11:30:00.000Z",
        },
        {
            id: "req-pending",
            status: "pending",
            title: "No toast yet",
        },
    ];

    const {changes, nextItems} = collectRecommendationDecisionChanges(entries, {
        "req-approved": "approval:2026-03-01T09:00:00.000Z",
    });

    assert.deepEqual(
        changes.map((entry) => ({id: entry.id, decisionKind: entry.decisionKind})),
        [
            {id: "req-approved", decisionKind: "approval"},
            {id: "req-denied", decisionKind: "denial"},
        ],
    );
    assert.deepEqual(nextItems, {
        "req-approved": "approval:2026-03-01T10:00:00.000Z",
        "req-denied": "denial:2026-03-02T11:30:00.000Z",
    });

    assert.deepEqual(buildRecommendationDecisionToast(entries[0]), {
        title: "Request approved",
        message: "Blue Box was approved.",
        variant: "success",
        clickLabel: "Open request timeline",
        dedupeKey: "recommendation-decision:req-approved:approval:2026-03-01T10:00:00.000Z",
        action: {
            type: "href",
            href: "/myrecommendations/req-approved",
        },
    });
    assert.deepEqual(buildRecommendationDecisionToast(entries[1]), {
        title: "Request denied",
        message: "Dandadan was denied.",
        variant: "danger",
        clickLabel: "Open request timeline",
        dedupeKey: "recommendation-decision:req-denied:denial:2026-03-02T11:30:00.000Z",
        action: {
            type: "href",
            href: "/myrecommendations/req-denied",
        },
    });
});

test("subscription helpers detect chapter DM advances and build generic count-delta messages", () => {
    const entries = [
        {
            id: "sub-library",
            title: "Blue Lock",
            titleUuid: "title-uuid-1",
            notifications: {
                chapterDmCount: 5,
                lastChapterDmAt: "2026-03-03T12:00:00.000Z",
            },
        },
        {
            id: "sub-list",
            titleQuery: "Kaiju No. 8",
            notifications: {
                chapterDmCount: 7,
                lastChapterDmAt: "2026-03-04T13:00:00.000Z",
            },
        },
    ];

    const {changes, nextItems} = collectSubscriptionNotificationChanges(entries, {
        "sub-library": {
            chapterDmCount: 3,
            lastChapterDmAt: "2026-03-01T12:00:00.000Z",
        },
        "sub-list": {
            chapterDmCount: 7,
            lastChapterDmAt: "2026-03-02T13:00:00.000Z",
        },
    });

    assert.deepEqual(
        changes.map((entry) => ({id: entry.id, deltaCount: entry.deltaCount})),
        [
            {id: "sub-library", deltaCount: 2},
            {id: "sub-list", deltaCount: 1},
        ],
    );
    assert.deepEqual(nextItems, {
        "sub-library": {
            chapterDmCount: 5,
            lastChapterDmAt: "2026-03-03T12:00:00.000Z",
        },
        "sub-list": {
            chapterDmCount: 7,
            lastChapterDmAt: "2026-03-04T13:00:00.000Z",
        },
    });

    assert.equal(
        buildSubscriptionUpdateMessage({title: "Blue Lock", deltaCount: 2}),
        "Blue Lock has 2 new chapter updates.",
    );
    assert.equal(
        buildSubscriptionUpdateMessage({title: "Kaiju No. 8", deltaCount: 1}),
        "Kaiju No. 8 has 1 new chapter update.",
    );

    assert.deepEqual(buildSubscriptionUpdateToast(entries[0], 2), {
        title: "Subscription update",
        message: "Blue Lock has 2 new chapter updates.",
        variant: "info",
        clickLabel: "Open library title",
        dedupeKey: "subscription-update:sub-library:5:2026-03-03T12:00:00.000Z",
        action: {
            type: "href",
            href: "/libraries/title-uuid-1",
        },
    });
    assert.deepEqual(buildSubscriptionUpdateToast(entries[1], 1), {
        title: "Subscription update",
        message: "Kaiju No. 8 has 1 new chapter update.",
        variant: "info",
        clickLabel: "Open subscriptions",
        dedupeKey: "subscription-update:sub-list:7:2026-03-04T13:00:00.000Z",
        action: {
            type: "href",
            href: "/mysubscriptions",
        },
    });
});

test("live notification seen-state helpers namespace by user and normalize stored signatures", () => {
    assert.equal(
        buildLiveNotificationStorageKey({discordUserId: "123456789", username: "Nohea"}),
        `${LIVE_NOTIFICATION_SEEN_STATE_STORAGE_PREFIX}:discord.123456789`,
    );
    assert.equal(
        buildLiveNotificationStorageKey({username: "  Moon User  "}),
        `${LIVE_NOTIFICATION_SEEN_STATE_STORAGE_PREFIX}:user.moon user`,
    );

    const state = parseLiveNotificationSeenState(JSON.stringify({
        recommendations: {
            seeded: true,
            items: {
                "req-1": "approval:2026-03-01T10:00:00.000Z",
                "": "ignored",
            },
        },
        subscriptions: {
            seeded: true,
            items: {
                "sub-1": {
                    chapterDmCount: "4",
                    lastChapterDmAt: " 2026-03-05T09:00:00.000Z ",
                },
            },
        },
    }));

    assert.deepEqual(state, {
        version: 1,
        recommendations: {
            seeded: true,
            items: {
                "req-1": "approval:2026-03-01T10:00:00.000Z",
            },
        },
        subscriptions: {
            seeded: true,
            items: {
                "sub-1": {
                    chapterDmCount: 4,
                    lastChapterDmAt: "2026-03-05T09:00:00.000Z",
                },
            },
        },
    });
});

test("music notification helpers preserve multiline attribution and the internal click event", () => {
    assert.equal(
        buildMoonMusicNotificationMessage(),
        "Song: Dosi & Aisake - Cruising [NCS Release]\nMusic provided by NoCopyrightSounds",
    );

    assert.deepEqual(buildMoonMusicNotification("play-session-1"), {
        title: "Now Playing",
        message: "Song: Dosi & Aisake - Cruising [NCS Release]\nMusic provided by NoCopyrightSounds",
        variant: "info",
        clickLabel: "Open music controls",
        dedupeKey: "moon-music:play-session-1",
        action: {
            type: "event",
            eventName: NOONA_OPEN_MUSIC_CONTROLS_EVENT,
        },
    });
});
