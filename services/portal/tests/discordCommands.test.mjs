// services/portal/tests/discordCommands.test.mjs

import assert from 'node:assert/strict';
import {test} from 'node:test';

import createPortalSlashCommands from '../commands/index.mjs';
import {createRecommendCommand} from '../commands/recommendCommand.mjs';

const createJoinInteraction = ({
                                   username = 'reader',
                                   password = 'hunter2',
                                   confirmPassword = password,
                                   email = 'reader@example.com',
                                   discordId = 'discord-user-1',
                               } = {}) => {
    const edits = [];
    const interaction = {
        user: {id: discordId},
        deferred: false,
        replied: false,
        options: {
            getString: name => ({
                username,
                password,
                confirm_password: confirmPassword,
                email,
            }[name] ?? null),
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

const createRecommendInteraction = ({
                                        title = 'Solo Leveling',
                                        discordId = 'discord-user-1',
                                        tag = 'Member#0001',
                                        guildId = 'guild-1',
                                        channelId = 'channel-1',
                                    } = {}) => {
    const edits = [];
    const interaction = {
        user: {id: discordId, tag},
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

    return {interaction, edits};
};

const createRecommendButtonInteraction = ({
                                              customId,
                                              discordId = 'discord-user-1',
                                              tag = 'Member#0001',
                                          } = {}) => {
    const edits = [];
    const replies = [];
    const interaction = {
        customId,
        user: {id: discordId, tag},
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

    return {interaction, edits, replies};
};

test('join command definition requires username, password, confirm password, and email', () => {
    const commands = createPortalSlashCommands({
        kavita: {createUser: async () => ({})},
    });
    const command = commands.get('join');

    assert.ok(command, 'Expected join command to be registered.');
    assert.equal(command.definition.description, 'Create a Kavita account with the configured default access.');
    assert.deepEqual(command.definition.options, [
        {
            name: 'username',
            description: 'Username to create in Kavita.',
            type: 3,
            required: true,
        },
        {
            name: 'password',
            description: 'Password for the new Kavita account.',
            type: 3,
            required: true,
        },
        {
            name: 'confirm_password',
            description: 'Repeat the password to confirm it.',
            type: 3,
            required: true,
        },
        {
            name: 'email',
            description: 'Email address for the Kavita account.',
            type: 3,
            required: true,
        },
    ]);
});

test('join command rejects mismatched passwords', async () => {
    const commands = createPortalSlashCommands({
        kavita: {
            createUser: async () => {
                throw new Error('createUser should not run for mismatched passwords');
            },
        },
    });
    const command = commands.get('join');
    const {interaction, edits} = createJoinInteraction({
        password: 'hunter2',
        confirmPassword: 'hunter3',
    });

    await command.execute(interaction);

    assert.equal(edits.length, 1);
    assert.equal(edits[0].ephemeral, true);
    assert.match(edits[0].content, /must match/i);
});

test('join command creates a Kavita user with configured defaults', async () => {
    const createUserCalls = [];
    const vaultWrites = [];
    const assignedRoles = [];
    const commands = createPortalSlashCommands({
        kavita: {
            createUser: async payload => {
                createUserCalls.push(payload);
                return {
                    username: payload.username,
                    email: payload.email,
                    roles: ['Pleb'],
                    libraries: [2],
                };
            },
        },
        vault: {
            storePortalCredential: async (discordId, credential) => {
                vaultWrites.push({discordId, credential});
            },
        },
        discord: {
            assignDefaultRole: async discordId => {
                assignedRoles.push(discordId);
            },
        },
        joinDefaults: {
            defaultRoles: ['Pleb'],
            defaultLibraries: ['Light Novels'],
        },
    });
    const command = commands.get('join');
    const {interaction, edits} = createJoinInteraction();

    await command.execute(interaction);

    assert.deepEqual(createUserCalls, [{
        username: 'reader',
        email: 'reader@example.com',
        password: 'hunter2',
        roles: ['Pleb'],
        libraries: ['Light Novels'],
    }]);
    assert.deepEqual(assignedRoles, ['discord-user-1']);
    assert.equal(vaultWrites.length, 1);
    assert.equal(vaultWrites[0].discordId, 'discord-user-1');
    assert.deepEqual(vaultWrites[0].credential.roles, ['Pleb']);
    assert.deepEqual(vaultWrites[0].credential.libraries, [2]);
    assert.equal(edits.length, 1);
    assert.equal(edits[0].ephemeral, true);
    assert.match(edits[0].content, /Created Kavita account \*\*reader\*\*/);
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
    assert.equal(edits[0].ephemeral, true);
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
    assert.equal(edits[0].ephemeral, true);
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
    assert.equal(edits[0].ephemeral, true);
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
    assert.equal(edits[0].ephemeral, true);
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
    assert.equal(edits[0].ephemeral, true);
    assert.match(edits[0].content, /Provide a title to search/i);
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
    assert.equal(edits[0].ephemeral, true);
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
    assert.equal(selectionRow.components.length, 2);
    const firstButton = selectionRow.components[0];

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
    assert.match(button.edits[0].content, /Saved recommendation for \*\*Solo Leveling\*\*/);
    assert.deepEqual(button.edits[0].components, []);
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
