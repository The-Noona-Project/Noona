/**
 * @fileoverview Covers Portal slash-command, autocomplete, and recommendation selection flows.
 * Related files:
 * - commands/index.mjs
 * - commands/recommendCommand.mjs
 * Times this file has been edited: 12
 */

import assert from 'node:assert/strict';
import {test} from 'node:test';

import createPortalSlashCommands from '../commands/index.mjs';
import {createRecommendCommand} from '../commands/recommendCommand.mjs';

const createScanInteraction = ({library = null, force = false} = {}) => {
    const edits = [];
    const interaction = {
        deferred: false,
        replied: false,
        options: {
            getString: name => (name === 'library' ? library : null),
            getBoolean: name => (name === 'force' ? force : null),
        },
        deferReply: async () => {
            interaction.deferred = true;
        },
        editReply: async payload => {
            interaction.replied = true;
            edits.push(payload);
        },
    };

    return {interaction, edits};
};

const createAutocompleteInteraction = value => {
    const responses = [];
    return {
        interaction: {
            options: {
                getFocused: (withMeta) => (withMeta ? {name: 'library', value} : value),
            },
            respond: async payload => {
                responses.push(payload);
            },
        },
        responses,
    };
};

const createSearchInteraction = title => {
    const edits = [];
    const interaction = {
        deferred: false,
        replied: false,
        options: {
            getString: name => (name === 'title' ? title : null),
        },
        deferReply: async () => {
            interaction.deferred = true;
        },
        editReply: async payload => {
            interaction.replied = true;
            edits.push(payload);
        },
    };

    return {interaction, edits};
};

const createSubscribeInteraction = ({
                                        title = 'Solo Leveling',
                                        discordId = 'discord-user-1',
                                        tag = 'Member#0001',
                                    } = {}) => {
    const edits = [];
    const interaction = {
        user: {
            id: discordId,
            tag,
        },
        deferred: false,
        replied: false,
        options: {
            getString: name => (name === 'title' ? title : null),
        },
        deferReply: async () => {
            interaction.deferred = true;
        },
        editReply: async payload => {
            interaction.replied = true;
            edits.push(payload);
        },
    };

    return {interaction, edits};
};

const createRecommendInteraction = ({
                                        title = 'Solo Leveling',
                                        discordId = 'discord-user-1',
                                        tag = 'Member#0001',
                                        guildId = 'guild-1',
                                        channelId = 'channel-1',
                                    } = {}) => {
    const edits = [];
    const dms = [];
    const interaction = {
        user: {
            id: discordId,
            tag,
            send: async payload => {
                dms.push(payload);
            },
        },
        guildId,
        channelId,
        deferred: false,
        replied: false,
        options: {
            getString: name => (name === 'title' ? title : null),
        },
        deferReply: async () => {
            interaction.deferred = true;
        },
        editReply: async payload => {
            interaction.replied = true;
            edits.push(payload);
        },
    };

    return {interaction, edits, dms};
};

const createRecommendButtonInteraction = ({
                                              customId,
                                              discordId = 'discord-user-1',
                                              tag = 'Member#0001',
                                          } = {}) => {
    const edits = [];
    const replies = [];
    const dms = [];
    const interaction = {
        customId,
        user: {
            id: discordId,
            tag,
            send: async payload => {
                dms.push(payload);
            },
        },
        deferred: false,
        replied: false,
        deferUpdate: async () => {
            interaction.deferred = true;
        },
        editReply: async payload => {
            interaction.replied = true;
            edits.push(payload);
        },
        reply: async payload => {
            interaction.replied = true;
            replies.push(payload);
        },
    };

    return {interaction, edits, replies, dms};
};

test('portal slash command registry excludes the legacy join command', () => {
    const commands = createPortalSlashCommands();

    assert.deepEqual([...commands.keys()], ['ding', 'scan', 'search', 'recommend', 'subscribe']);
    assert.equal(commands.has('join'), false);
});

test('scan command definition requires an autocompleted library option', () => {
    const commands = createPortalSlashCommands({
        kavita: {
            fetchLibraries: async () => [],
            scanLibrary: async () => null,
        },
    });
    const command = commands.get('scan');

    assert.ok(command, 'Expected scan command to be registered.');
    assert.equal(command.definition.description, 'Trigger a Kavita scan for a library.');
    assert.deepEqual(command.definition.options, [
        {
            name: 'library',
            description: 'Library to scan in Kavita.',
            type: 3,
            required: true,
            autocomplete: true,
        },
        {
            name: 'force',
            description: 'Force a full scan for the selected library.',
            type: 5,
            required: false,
        },
    ]);
});

test('scan command autocomplete returns matching Kavita libraries', async () => {
    const kavita = {
        fetchLibraries: async () => [
            {id: 1, name: 'Manga'},
            {id: 2, name: 'Light Novels'},
            {id: 3, name: 'Comics'},
        ],
        scanLibrary: async () => null,
    };

    const commands = createPortalSlashCommands({kavita});
    const command = commands.get('scan');
    const {interaction, responses} = createAutocompleteInteraction('nov');

    await command.autocomplete(interaction);

    assert.equal(responses.length, 1);
    assert.deepEqual(responses[0], [
        {name: 'Light Novels', value: '2'},
    ]);
});

test('scan command queues a Kavita library scan from an autocompleted id', async () => {
    const calls = [];
    const kavita = {
        fetchLibraries: async () => [
            {id: 11, name: 'Manga'},
            {id: 12, name: 'Light Novels'},
        ],
        scanLibrary: async (libraryId, options) => {
            calls.push({libraryId, options});
            return null;
        },
    };

    const commands = createPortalSlashCommands({kavita});
    const command = commands.get('scan');
    const {interaction, edits} = createScanInteraction({library: '12', force: true});

    await command.execute(interaction);

    assert.deepEqual(calls, [{libraryId: 12, options: {force: true}}]);
    assert.equal(edits.length, 1);
    assert.equal(edits[0].ephemeral, undefined);
    assert.match(edits[0].content, /Queued a forced Kavita scan for \*\*Light Novels\*\*/i);
});

test('scan command resolves a typed library name and reports available libraries when missing', async () => {
    const kavita = {
        fetchLibraries: async () => [
            {id: 11, name: 'Manga'},
            {id: 12, name: 'Light Novels'},
        ],
        scanLibrary: async () => {
            throw new Error('scanLibrary should not be called when a library is missing');
        },
    };

    const commands = createPortalSlashCommands({kavita});
    const command = commands.get('scan');
    const {interaction, edits} = createScanInteraction({library: 'unknown'});

    await command.execute(interaction);

    assert.equal(edits.length, 1);
    assert.equal(edits[0].ephemeral, undefined);
    assert.match(edits[0].content, /Available libraries: Manga, Light Novels/);
});

test('search command definition requires a title option', () => {
    const commands = createPortalSlashCommands({kavita: {searchTitles: async () => ({series: []})}});
    const command = commands.get('search');

    assert.ok(command, 'Expected search command to be registered.');
    assert.equal(command.definition.description, 'Search Kavita for matching series titles.');
    assert.deepEqual(command.definition.options, [
        {
            name: 'title',
            description: 'Series title to search for in Kavita.',
            type: 3,
            required: true,
        },
    ]);
});

test('search command returns friendly response when Kavita title is missing', async () => {
    const kavita = {
        searchTitles: async () => ({series: []}),
    };

    const commands = createPortalSlashCommands({kavita});
    const command = commands.get('search');
    assert.ok(command, 'Expected search command to be registered.');

    const {interaction, edits} = createSearchInteraction('missing title');

    await command.execute(interaction);

    assert.equal(edits.length, 1);
    assert.equal(edits[0].ephemeral, undefined);
    assert.match(edits[0].content, /No Kavita titles found/i);
});

test('search command queries Kavita and formats title matches', async () => {
    const calls = [];
    const kavita = {
        searchTitles: async title => {
            calls.push(title);
            return {
                series: [
                    {
                        seriesId: 12,
                        name: 'One Piece',
                        originalName: 'ワンピース',
                        libraryName: 'Shonen Jump',
                    },
                    {
                        seriesId: 42,
                        localizedName: 'Frieren: Beyond Journey\'s End',
                        libraryName: 'Fantasy',
                    },
                ],
            };
        },
    };

    const commands = createPortalSlashCommands({kavita});
    const command = commands.get('search');
    const {interaction, edits} = createSearchInteraction('  one piece  ');

    await command.execute(interaction);

    assert.deepEqual(calls, ['one piece']);
    assert.equal(edits.length, 1);
    assert.equal(edits[0].ephemeral, undefined);
    assert.match(edits[0].content, /Found 2 Kavita title matches for "one piece"/i);
    assert.match(edits[0].content, /1\. One Piece \| library: Shonen Jump \| aka: ワンピース/);
    assert.match(edits[0].content, /2\. Frieren: Beyond Journey's End \| library: Fantasy/);
});

test('search command rejects blank titles', async () => {
    const kavita = {
        searchTitles: async () => {
            throw new Error('searchTitles should not be called for blank titles');
        },
    };

    const commands = createPortalSlashCommands({kavita});
    const command = commands.get('search');
    const {interaction, edits} = createSearchInteraction('   ');

    await command.execute(interaction);

    assert.equal(edits.length, 1);
    assert.equal(edits[0].ephemeral, undefined);
    assert.match(edits[0].content, /Provide a title to search/i);
});

test('subscribe command definition requires a title option', () => {
    const commands = createPortalSlashCommands();
    const command = commands.get('subscribe');

    assert.ok(command, 'Expected subscribe command to be registered.');
    assert.equal(command.definition.description, 'Subscribe to a title and get DMs for newly downloaded chapters.');
    assert.deepEqual(command.definition.options, [
        {
            name: 'title',
            description: 'Title to subscribe to for chapter download DMs.',
            type: 3,
            required: true,
        },
    ]);
});

test('subscribe command rejects blank titles', async () => {
    const commands = createPortalSlashCommands({
        raven: {},
        vault: {
            findSubscriptions: async () => [],
            storeSubscription: async () => {
                throw new Error('storeSubscription should not be called for blank titles');
            },
            updateSubscription: async () => {
                throw new Error('updateSubscription should not be called for blank titles');
            },
        },
    });
    const command = commands.get('subscribe');
    const {interaction, edits} = createSubscribeInteraction({title: '   '});

    await command.execute(interaction);

    assert.equal(edits.length, 1);
    assert.match(edits[0].content, /Provide a title to subscribe/i);
});

test('subscribe command stores a new active subscription with baseline chapter markers', async () => {
    const storedSubscriptions = [];
    const commands = createPortalSlashCommands({
        raven: {
            getLibrary: async () => [
                {
                    uuid: 'title-uuid-1',
                    title: 'Solo Leveling',
                    sourceUrl: 'https://source.example/solo-leveling',
                },
            ],
            getDownloadStatus: async () => [
                {
                    titleUuid: 'title-uuid-1',
                    title: 'Solo Leveling',
                    completedChapterNumbers: ['1', '2'],
                },
            ],
            getDownloadHistory: async () => [
                {
                    titleUuid: 'title-uuid-1',
                    title: 'Solo Leveling',
                    completedChapterNumbers: ['2', '3'],
                },
            ],
        },
        vault: {
            findSubscriptions: async () => [],
            storeSubscription: async (payload, options) => {
                storedSubscriptions.push({payload, options});
                return {insertedId: 'subscription-1'};
            },
            updateSubscription: async () => {
                throw new Error('updateSubscription should not be called for a new subscription');
            },
        },
    });
    const command = commands.get('subscribe');
    const {interaction, edits} = createSubscribeInteraction();

    await command.execute(interaction);

    assert.equal(storedSubscriptions.length, 1);
    assert.deepEqual(storedSubscriptions[0].options, {collection: 'portal_subscriptions'});
    assert.equal(storedSubscriptions[0].payload.status, 'active');
    assert.equal(storedSubscriptions[0].payload.source, 'discord');
    assert.equal(storedSubscriptions[0].payload.titleQuery, 'Solo Leveling');
    assert.equal(storedSubscriptions[0].payload.title, 'Solo Leveling');
    assert.equal(storedSubscriptions[0].payload.titleUuid, 'title-uuid-1');
    assert.equal(storedSubscriptions[0].payload.sourceUrl, 'https://source.example/solo-leveling');
    assert.equal(storedSubscriptions[0].payload.subscriber.discordId, 'discord-user-1');
    assert.deepEqual(
        storedSubscriptions[0].payload.notifications.sentChapterKeys,
        [
            'uuid:title-uuid-1:1',
            'uuid:title-uuid-1:2',
            'uuid:title-uuid-1:3',
        ],
    );
    assert.equal(edits.length, 1);
    assert.match(edits[0].content, /Subscribed to \*\*Solo Leveling\*\*/i);
});

test('subscribe command reports when an active matching subscription already exists', async () => {
    const commands = createPortalSlashCommands({
        raven: {
            getLibrary: async () => [
                {
                    uuid: 'title-uuid-1',
                    title: 'Solo Leveling',
                    sourceUrl: 'https://source.example/solo-leveling',
                },
            ],
        },
        vault: {
            findSubscriptions: async () => [
                {
                    _id: 'sub-1',
                    status: 'active',
                    title: 'Solo Leveling',
                    titleUuid: 'title-uuid-1',
                    subscriber: {
                        discordId: 'discord-user-1',
                    },
                },
            ],
            storeSubscription: async () => {
                throw new Error('storeSubscription should not be called when subscription is already active');
            },
            updateSubscription: async () => {
                throw new Error('updateSubscription should not be called when subscription is already active');
            },
        },
    });
    const command = commands.get('subscribe');
    const {interaction, edits} = createSubscribeInteraction();

    await command.execute(interaction);

    assert.equal(edits.length, 1);
    assert.match(edits[0].content, /already subscribed/i);
});

test('subscribe command reactivates an existing inactive subscription', async () => {
    const updates = [];
    const commands = createPortalSlashCommands({
        raven: {
            getLibrary: async () => [
                {
                    uuid: 'title-uuid-1',
                    title: 'Solo Leveling',
                    sourceUrl: 'https://source.example/solo-leveling',
                },
            ],
        },
        vault: {
            findSubscriptions: async () => [
                {
                    _id: 'sub-1',
                    status: 'paused',
                    title: 'Solo Leveling',
                    titleUuid: 'title-uuid-1',
                    subscriber: {
                        discordId: 'discord-user-1',
                    },
                    notifications: {
                        chapterDmCount: 4,
                        sentChapterKeys: ['uuid:title-uuid-1:1'],
                    },
                },
            ],
            storeSubscription: async () => {
                throw new Error('storeSubscription should not be called when reactivating existing subscription');
            },
            updateSubscription: async payload => {
                updates.push(payload);
                return {matched: 1, modified: 1};
            },
        },
    });
    const command = commands.get('subscribe');
    const {interaction, edits} = createSubscribeInteraction();

    await command.execute(interaction);

    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].query, {_id: 'sub-1'});
    assert.equal(updates[0].update?.$set?.status, 'active');
    assert.equal(updates[0].update?.$set?.titleUuid, 'title-uuid-1');
    assert.equal(updates[0].update?.$set?.notifications?.chapterDmCount, 4);
    assert.deepEqual(
        updates[0].update?.$set?.notifications?.sentChapterKeys,
        ['uuid:title-uuid-1:1'],
    );
    assert.equal(edits.length, 1);
    assert.match(edits[0].content, /Subscribed to \*\*Solo Leveling\*\*/i);
});

test('recommend command definition requires a title option', () => {
    const commands = createPortalSlashCommands({raven: {searchTitle: async () => ({options: []})}});
    const command = commands.get('recommend');

    assert.ok(command, 'Expected recommend command to be registered.');
    assert.equal(command.definition.description, 'Recommend a new title from Raven search results.');
    assert.deepEqual(command.definition.options, [
        {
            name: 'title',
            description: 'Title to search for in Raven before saving a recommendation.',
            type: 3,
            required: true,
        },
    ]);
});

test('recommend command rejects blank titles', async () => {
    const commands = createPortalSlashCommands({
        raven: {
            searchTitle: async () => {
                throw new Error('searchTitle should not be called for blank recommendation titles');
            },
        },
    });
    const command = commands.get('recommend');
    const {interaction, edits} = createRecommendInteraction({title: '   '});

    await command.execute(interaction);

    assert.equal(edits.length, 1);
    assert.equal(edits[0].ephemeral, undefined);
    assert.match(edits[0].content, /Provide a title to recommend/i);
});

test('recommend command searches Raven and stores the selected recommendation in Vault', async () => {
    const ravenCalls = [];
    const storedRecommendations = [];
    const command = createRecommendCommand({
        raven: {
            searchTitle: async query => {
                ravenCalls.push(query);
                return {
                    searchId: 'search-42',
                    options: [
                        {index: '1', title: 'Solo Leveling', href: 'https://source.example/solo-leveling'},
                        {
                            index: '2',
                            title: 'Solo Leveling: Side Story',
                            href: 'https://source.example/solo-leveling-side'
                        },
                    ],
                };
            },
            getTitleDetails: async (sourceUrl) => {
                assert.equal(sourceUrl, 'https://source.example/solo-leveling');
                return {
                    sourceUrl,
                    adultContent: true,
                };
            },
        },
        vault: {
            storeRecommendation: async recommendation => {
                storedRecommendations.push(recommendation);
                return {insertedId: 99};
            },
        },
        now: () => Date.parse('2026-03-04T00:00:00.000Z'),
    });
    const {interaction, edits} = createRecommendInteraction();

    await command.execute(interaction);

    assert.deepEqual(ravenCalls, ['Solo Leveling']);
    assert.equal(edits.length, 1);
    assert.match(edits[0].content, /Select the Raven match to recommend/i);
    assert.equal(edits[0].components.length, 2);

    const [selectionRow] = edits[0].components.map(row => row.toJSON());
    assert.equal(selectionRow.components.length, 3);
    const firstButton = selectionRow.components[0];
    assert.equal(selectionRow.components[2].label, "Can't find your title?");

    const button = createRecommendButtonInteraction({customId: firstButton.custom_id});
    await command.handleComponent(button.interaction);

    assert.equal(storedRecommendations.length, 1);
    assert.deepEqual(storedRecommendations[0], {
        source: 'discord',
        status: 'pending',
        requestedAt: '2026-03-04T00:00:00.000Z',
        query: 'Solo Leveling',
        searchId: 'search-42',
        selectedOptionIndex: 1,
        title: 'Solo Leveling',
        href: 'https://source.example/solo-leveling',
        sourceAdultContent: true,
        requestedBy: {
            discordId: 'discord-user-1',
            tag: 'Member#0001',
        },
        discordContext: {
            guildId: 'guild-1',
            channelId: 'channel-1',
        },
    });
    assert.equal(button.edits.length, 1);
    assert.match(button.edits[0].content, /Thanks for your recommendation for \*\*Solo Leveling\*\*/);
    assert.match(button.edits[0].content, /approved or denied/i);
    assert.match(button.edits[0].content, /I also sent this as a DM/i);
    assert.deepEqual(button.edits[0].components, []);
    assert.equal(button.dms.length, 1);
    assert.match(button.dms[0].content, /Thanks for your recommendation for \*\*Solo Leveling\*\*/i);
    assert.match(button.dms[0].content, /approved or denied/i);
});

test('recommend command saves an unmatched recommendation when the user cannot find the title', async () => {
    const storedRecommendations = [];
    const command = createRecommendCommand({
        raven: {
            searchTitle: async () => ({
                searchId: 'search-missing-42',
                options: [
                    {index: '1', title: 'Solo Leveling', href: 'https://source.example/solo-leveling'},
                    {index: '2', title: 'Solo Leveling: Side Story', href: 'https://source.example/solo-leveling-side'},
                ],
            }),
        },
        vault: {
            storeRecommendation: async recommendation => {
                storedRecommendations.push(recommendation);
                return {insertedId: 'missing-100'};
            },
        },
        now: () => Date.parse('2026-03-04T00:00:00.000Z'),
    });
    const {interaction, edits} = createRecommendInteraction({title: 'Only I Level Up'});

    await command.execute(interaction);

    const [selectionRow] = edits[0].components.map(row => row.toJSON());
    const missingButton = selectionRow.components.find((component) => component.label === "Can't find your title?");
    assert.ok(missingButton);

    const button = createRecommendButtonInteraction({customId: missingButton.custom_id});
    await command.handleComponent(button.interaction);

    assert.deepEqual(storedRecommendations, [
        {
            source: 'discord',
            status: 'pending',
            requestedAt: '2026-03-04T00:00:00.000Z',
            query: 'Only I Level Up',
            searchId: null,
            selectedOptionIndex: null,
            title: 'Only I Level Up',
            href: null,
            sourceAdultContent: null,
            requestedBy: {
                discordId: 'discord-user-1',
                tag: 'Member#0001',
            },
            discordContext: {
                guildId: 'guild-1',
                channelId: 'channel-1',
            },
        },
    ]);
    assert.equal(button.edits.length, 1);
    assert.match(button.edits[0].content, /expand our content reach/i);
    assert.equal(button.dms.length, 1);
    assert.match(button.dms[0].content, /couldn't find a Raven source/i);
});

test('recommend command lets users save titles for later when Raven returns no matches', async () => {
    const storedRecommendations = [];
    const command = createRecommendCommand({
        raven: {
            searchTitle: async () => ({
                searchId: null,
                options: [],
            }),
        },
        vault: {
            storeRecommendation: async recommendation => {
                storedRecommendations.push(recommendation);
                return {insertedId: 'missing-101'};
            },
        },
        now: () => Date.parse('2026-03-04T00:00:00.000Z'),
    });
    const {interaction, edits} = createRecommendInteraction({title: 'Unknown Hunter Story'});

    await command.execute(interaction);

    assert.equal(edits.length, 1);
    assert.match(edits[0].content, /No Raven titles were found/i);
    const [selectionRow] = edits[0].components.map(row => row.toJSON());
    assert.equal(selectionRow.components.length, 1);
    assert.equal(selectionRow.components[0].label, "Can't find your title?");

    const button = createRecommendButtonInteraction({customId: selectionRow.components[0].custom_id});
    await command.handleComponent(button.interaction);

    assert.equal(storedRecommendations.length, 1);
    assert.equal(storedRecommendations[0].title, 'Unknown Hunter Story');
    assert.equal(storedRecommendations[0].searchId, null);
    assert.equal(storedRecommendations[0].selectedOptionIndex, null);
    assert.match(button.edits[0].content, /saved for later/i);
});

test('recommend command initial DM includes a Moon myrecommendations link when MOON_BASE_URL is configured', async () => {
    const command = createRecommendCommand({
        raven: {
            searchTitle: async () => ({
                searchId: 'search-98',
                options: [
                    {index: '1', title: 'Naruto', href: 'https://source.example/naruto'},
                ],
            }),
        },
        vault: {
            storeRecommendation: async () => ({insertedId: '69ab9c2b86235ade34fee0c4'}),
        },
        moonBaseUrl: 'http://moon.example:3000',
        now: () => Date.parse('2026-03-04T00:00:00.000Z'),
    });
    const {interaction, edits} = createRecommendInteraction({title: 'Naruto'});

    await command.execute(interaction);

    const [selectionRow] = edits[0].components.map(row => row.toJSON());
    const firstButton = selectionRow.components[0];
    const button = createRecommendButtonInteraction({customId: firstButton.custom_id});

    await command.handleComponent(button.interaction);

    assert.equal(button.dms.length, 1);
    assert.match(
        button.dms[0].content,
        /Track it in Moon: http:\/\/moon\.example:3000\/myrecommendations\/69ab9c2b86235ade34fee0c4/i,
    );
});

test('recommend command reports existing library titles and returns a Kavita link without writing to Vault', async () => {
    const storedRecommendations = [];
    const kavitaSearchCalls = [];
    const command = createRecommendCommand({
        raven: {
            searchTitle: async () => ({
                searchId: 'search-77',
                options: [
                    {index: '1', title: 'Solo Leveling', href: 'https://source.example/solo-leveling'},
                ],
            }),
            getLibrary: async () => [
                {
                    uuid: 'library-title-1',
                    title: 'Solo Leveling',
                    sourceUrl: 'https://source.example/solo-leveling',
                },
            ],
        },
        kavita: {
            searchTitles: async title => {
                kavitaSearchCalls.push(title);
                return {
                    series: [
                        {
                            name: 'Solo Leveling',
                            url: 'https://kavita.example/library/3/series/12',
                        },
                    ],
                };
            },
        },
        vault: {
            storeRecommendation: async recommendation => {
                storedRecommendations.push(recommendation);
                return {insertedId: 100};
            },
        },
        now: () => Date.parse('2026-03-04T00:00:00.000Z'),
    });
    const {interaction, edits} = createRecommendInteraction();

    await command.execute(interaction);

    const [selectionRow] = edits[0].components.map(row => row.toJSON());
    const firstButton = selectionRow.components[0];
    const button = createRecommendButtonInteraction({customId: firstButton.custom_id});

    await command.handleComponent(button.interaction);

    assert.equal(storedRecommendations.length, 0);
    assert.deepEqual(kavitaSearchCalls, ['Solo Leveling']);
    assert.equal(button.edits.length, 1);
    assert.match(button.edits[0].content, /\*\*Solo Leveling\*\* is already on this server/i);
    assert.match(button.edits[0].content, /Open in Kavita: https:\/\/kavita\.example\/library\/3\/series\/12/i);
    assert.deepEqual(button.edits[0].components, []);
});

test('recommend command prefers configured external Kavita URL for existing-title links', async () => {
    const command = createRecommendCommand({
        raven: {
            searchTitle: async () => ({
                searchId: 'search-88',
                options: [
                    {index: '1', title: 'Solo Leveling', href: 'https://source.example/solo-leveling'},
                ],
            }),
            getLibrary: async () => [
                {
                    uuid: 'library-title-1',
                    title: 'Solo Leveling',
                    sourceUrl: 'https://source.example/solo-leveling',
                },
            ],
        },
        kavita: {
            searchTitles: async () => ({
                series: [
                    {
                        libraryId: 3,
                        seriesId: 12,
                        name: 'Solo Leveling',
                    },
                ],
            }),
        },
        vault: {
            storeRecommendation: async () => ({insertedId: 100}),
        },
        kavitaBaseUrl: 'https://kavita.example.com',
        now: () => Date.parse('2026-03-04T00:00:00.000Z'),
    });
    const {interaction, edits} = createRecommendInteraction();

    await command.execute(interaction);

    const [selectionRow] = edits[0].components.map(row => row.toJSON());
    const firstButton = selectionRow.components[0];
    const button = createRecommendButtonInteraction({customId: firstButton.custom_id});

    await command.handleComponent(button.interaction);

    assert.equal(button.edits.length, 1);
    assert.match(button.edits[0].content, /Open in Kavita: https:\/\/kavita\.example\.com\/library\/3\/series\/12/i);
});

test('recommend command cancels pending selections without writing to Vault', async () => {
    const storedRecommendations = [];
    const command = createRecommendCommand({
        raven: {
            searchTitle: async () => ({
                searchId: 'search-42',
                options: [
                    {index: '1', title: 'Solo Leveling', href: 'https://source.example/solo-leveling'},
                ],
            }),
        },
        vault: {
            storeRecommendation: async recommendation => {
                storedRecommendations.push(recommendation);
                return {insertedId: 100};
            },
        },
        now: () => Date.parse('2026-03-04T00:00:00.000Z'),
    });
    const {interaction, edits} = createRecommendInteraction();

    await command.execute(interaction);

    const [, cancelRow] = edits[0].components.map(row => row.toJSON());
    const cancelButton = cancelRow.components[0];
    const button = createRecommendButtonInteraction({customId: cancelButton.custom_id});

    await command.handleComponent(button.interaction);

    assert.equal(storedRecommendations.length, 0);
    assert.equal(button.edits.length, 1);
    assert.match(button.edits[0].content, /Recommendation cancelled/i);
});
