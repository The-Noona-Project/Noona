import {ApplicationCommandOptionType} from 'discord.js';
import {respondWithError} from './utils.mjs';

const MAX_AUTOCOMPLETE_RESULTS = 25;
const MAX_LISTED_LIBRARIES = 10;

const normalizeValue = value => (typeof value === 'string' ? value.trim() : '');

const resolveLibraryName = library =>
    normalizeValue(library?.name)
    || normalizeValue(library?.title)
    || `Library ${library?.id ?? 'unknown'}`;

const filterLibraries = (libraries, query) => {
    const normalizedQuery = normalizeValue(query).toLowerCase();
    if (!normalizedQuery) {
        return libraries;
    }

    return libraries.filter(library => {
        const name = resolveLibraryName(library).toLowerCase();
        return name.includes(normalizedQuery) || String(library?.id ?? '').includes(normalizedQuery);
    });
};

const findLibraryMatch = (libraries, rawValue) => {
    const value = normalizeValue(rawValue);
    if (!value) {
        return null;
    }

    if (/^\d+$/.test(value)) {
        return libraries.find(library => String(library?.id ?? '') === value) ?? null;
    }

    const normalizedValue = value.toLowerCase();
    return libraries.find(library => resolveLibraryName(library).toLowerCase() === normalizedValue) ?? null;
};

export const createScanCommand = ({
                                      kavita,
                                  } = {}) => ({
    definition: {
        name: 'scan',
        description: 'Trigger a Kavita scan for a library.',
        options: [
            {
                name: 'library',
                description: 'Library to scan in Kavita.',
                type: ApplicationCommandOptionType.String,
                required: true,
                autocomplete: true,
            },
            {
                name: 'force',
                description: 'Force a full scan for the selected library.',
                type: ApplicationCommandOptionType.Boolean,
                required: false,
            },
        ],
    },
    autocomplete: async interaction => {
        if (!kavita?.fetchLibraries) {
            await interaction.respond?.([]);
            return;
        }

        const focused = interaction.options?.getFocused?.(true);
        const query = typeof focused === 'object' ? focused?.value : focused;
        const libraries = await kavita.fetchLibraries();
        const results = filterLibraries(Array.isArray(libraries) ? libraries : [], query)
            .filter(library => library?.id != null)
            .slice(0, MAX_AUTOCOMPLETE_RESULTS)
            .map(library => ({
                name: resolveLibraryName(library),
                value: String(library.id),
            }));

        await interaction.respond?.(results);
    },
    execute: async interaction => {
        await interaction.deferReply?.({ephemeral: true});

        if (!kavita?.fetchLibraries || !kavita?.scanLibrary) {
            throw new Error('Kavita client is not configured.');
        }

        const rawLibrary = interaction.options?.getString('library') ?? '';
        const force = interaction.options?.getBoolean('force') === true;
        const libraryValue = normalizeValue(rawLibrary);

        if (!libraryValue) {
            await respondWithError(interaction, 'Choose a Kavita library to scan.');
            return;
        }

        const libraries = await kavita.fetchLibraries();
        if (!Array.isArray(libraries) || libraries.length === 0) {
            await interaction.editReply?.({
                content: 'No Kavita libraries are available to scan.',
                ephemeral: true,
            });
            return;
        }

        const library = findLibraryMatch(libraries, libraryValue);
        if (!library?.id) {
            const available = libraries
                .slice(0, MAX_LISTED_LIBRARIES)
                .map(resolveLibraryName)
                .join(', ');

            await interaction.editReply?.({
                content: available
                    ? `Could not find that Kavita library. Available libraries: ${available}`
                    : 'Could not find that Kavita library.',
                ephemeral: true,
            });
            return;
        }

        await kavita.scanLibrary(library.id, {force});

        await interaction.editReply?.({
            content: `Queued a ${force ? 'forced ' : ''}Kavita scan for **${resolveLibraryName(library)}**.`,
            ephemeral: true,
        });
    },
});

export default createScanCommand;
