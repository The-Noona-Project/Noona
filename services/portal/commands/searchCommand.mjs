import {ApplicationCommandOptionType} from 'discord.js';
import {errMSG} from '../../../utilities/etc/logger.mjs';
import {respondWithError} from './utils.mjs';

const MAX_VISIBLE_RESULTS = 8;
const MAX_FIELD_LENGTH = 48;

const normalizeSearchValue = value => (typeof value === 'string' ? value.trim() : '');

const truncateValue = (value, maxLength = MAX_FIELD_LENGTH) => {
    if (!value || value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
};

const buildSeriesLabel = series => {
    const primaryName = normalizeSearchValue(series?.name)
        || normalizeSearchValue(series?.localizedName)
        || normalizeSearchValue(series?.originalName)
        || `Series ${series?.seriesId ?? 'unknown'}`;

    const aliases = [];
    const seenNames = new Set([primaryName.toLowerCase()]);

    for (const candidate of [series?.localizedName, series?.originalName]) {
        const normalized = normalizeSearchValue(candidate);
        if (!normalized) {
            continue;
        }

        const key = normalized.toLowerCase();
        if (seenNames.has(key)) {
            continue;
        }

        seenNames.add(key);
        aliases.push(truncateValue(normalized));
    }

    const parts = [truncateValue(primaryName)];
    const libraryName = normalizeSearchValue(series?.libraryName);
    if (libraryName) {
        parts.push(`library: ${truncateValue(libraryName)}`);
    }

    if (aliases.length) {
        parts.push(`aka: ${aliases.slice(0, 2).join(' / ')}`);
    }

    return parts.join(' | ');
};

export const createSearchCommand = ({
                                        kavita,
                                    } = {}) => ({
    definition: {
        name: 'search',
        description: 'Search Kavita for matching series titles.',
        options: [
            {
                name: 'title',
                description: 'Series title to search for in Kavita.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    execute: async interaction => {
        await interaction.deferReply?.({ephemeral: true});

        if (!kavita?.searchTitles) {
            throw new Error('Kavita client is not configured for search.');
        }

        const title = normalizeSearchValue(interaction.options?.getString('title') ?? null);

        if (!title) {
            await respondWithError(interaction, 'Provide a title to search.');
            return;
        }

        let results;
        try {
            results = await kavita.searchTitles(title);
        } catch (error) {
            errMSG(`[Portal/Discord] Kavita title search failed: ${error.message}`);
            throw error;
        }

        const seriesMatches = Array.isArray(results?.series) ? results.series.filter(Boolean) : [];
        if (!seriesMatches.length) {
            await interaction.editReply?.({
                content: `No Kavita titles found for "${title}".`,
                ephemeral: true,
            });
            return;
        }

        const visibleMatches = seriesMatches
            .slice(0, MAX_VISIBLE_RESULTS)
            .map((series, index) => `${index + 1}. ${buildSeriesLabel(series)}`);

        const content = [
            `Found ${seriesMatches.length} Kavita title ${seriesMatches.length === 1 ? 'match' : 'matches'} for "${title}":`,
            ...visibleMatches,
            seriesMatches.length > MAX_VISIBLE_RESULTS ? `Showing first ${MAX_VISIBLE_RESULTS} results.` : null,
        ]
            .filter(Boolean)
            .join('\n');

        await interaction.editReply?.({content, ephemeral: true});
    },
});

export default createSearchCommand;
