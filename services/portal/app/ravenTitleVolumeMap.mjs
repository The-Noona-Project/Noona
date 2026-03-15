/**
 * @fileoverview Derives and applies Raven chapter-to-volume mappings from Komf series metadata.
 * Related files:
 * - routes/registerPortalRoutes.mjs
 * - clients/ravenClient.mjs
 * - clients/komfClient.mjs
 * - discord/recommendationNotifier.mjs
 * Times this file has been edited: 2
 */

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizePositiveInteger = (value) => {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeIntegerList = (value) => {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set();
    const out = [];
    for (const entry of value) {
        const parsed = normalizePositiveInteger(entry);
        if (parsed == null || seen.has(parsed)) {
            continue;
        }

        seen.add(parsed);
        out.push(parsed);
    }

    out.sort((left, right) => left - right);
    return out;
};

const buildInclusiveRange = (start, end) => {
    const normalizedStart = normalizePositiveInteger(start);
    const normalizedEnd = normalizePositiveInteger(end);
    if (normalizedStart == null || normalizedEnd == null || normalizedEnd < normalizedStart) {
        return [];
    }

    const out = [];
    for (let value = normalizedStart; value <= normalizedEnd; value += 1) {
        out.push(value);
    }
    return out;
};

const resolveBookVolumeNumber = (book = {}) => {
    const direct = normalizePositiveInteger(book?.volumeNumber);
    if (direct != null) {
        return direct;
    }

    const rangeStart = normalizePositiveInteger(book?.volumeRangeStart);
    const rangeEnd = normalizePositiveInteger(book?.volumeRangeEnd);
    if (rangeStart != null && rangeEnd != null && rangeStart === rangeEnd) {
        return rangeStart;
    }

    return null;
};

const resolveBookChapterCoverage = (book = {}) => {
    const explicitChapters = normalizeIntegerList(book?.chapters);
    if (explicitChapters.length > 0) {
        return explicitChapters;
    }

    return buildInclusiveRange(book?.startChapter, book?.endChapter);
};

const sortChapterVolumeEntries = (entries = []) =>
    [...entries].sort((left, right) => Number(left[0]) - Number(right[0]));

const buildAppliedMessage = (renameSummary = {}) => {
    const renamed = normalizePositiveInteger(renameSummary?.renamed) ?? 0;
    if (renamed > 0) {
        return `Stored the Raven volume map and renamed ${renamed} existing file${renamed === 1 ? '' : 's'}.`;
    }

    if (renameSummary?.attempted === false) {
        return 'Stored the Raven volume map without renaming existing files.';
    }

    return 'Stored the Raven volume map. Existing files already matched the current naming settings.';
};

/**
 * Derives Raven chapter-to-volume mappings from Komf series details.
 *
 * @param {*} seriesDetails - Input passed to the function.
 * @returns {*} The function result.
 */
export const deriveChapterVolumeMapFromSeriesDetails = (seriesDetails = {}) => {
    const chapterVolumes = new Map();
    const ambiguousChapters = new Set();
    const books = Array.isArray(seriesDetails?.books) ? seriesDetails.books : [];

    for (const book of books) {
        const volumeNumber = resolveBookVolumeNumber(book);
        const chapterCoverage = resolveBookChapterCoverage(book);
        if (volumeNumber == null || chapterCoverage.length === 0) {
            continue;
        }

        for (const chapterNumber of chapterCoverage) {
            const chapterKey = String(chapterNumber);
            if (ambiguousChapters.has(chapterKey)) {
                continue;
            }

            const previousVolume = chapterVolumes.get(chapterKey);
            if (previousVolume == null) {
                chapterVolumes.set(chapterKey, volumeNumber);
                continue;
            }

            if (previousVolume !== volumeNumber) {
                chapterVolumes.delete(chapterKey);
                ambiguousChapters.add(chapterKey);
            }
        }
    }

    return Object.fromEntries(sortChapterVolumeEntries(Array.from(chapterVolumes.entries())));
};

/**
 * Applies a derived chapter-to-volume map to Raven.
 *
 * @param {object} options - Named function inputs.
 * @returns {Promise<*>} The asynchronous result.
 */
export const applyRavenTitleVolumeMap = async ({
                                                   titleUuid,
                                                   provider,
                                                   providerSeriesId,
                                                   libraryId = null,
                                                   autoRename = true,
                                                   komfClient,
                                                   ravenClient,
                                               } = {}) => {
    const normalizedTitleUuid = normalizeString(titleUuid);
    const normalizedProvider = normalizeString(provider);
    const normalizedProviderSeriesId = normalizeString(providerSeriesId);
    if (!normalizedTitleUuid || !normalizedProvider || !normalizedProviderSeriesId) {
        throw new Error('titleUuid, provider, and providerSeriesId are required.');
    }

    if (typeof komfClient?.getSeriesMetadataDetails !== 'function') {
        throw new Error('Komf series-details lookup is not configured.');
    }

    if (typeof ravenClient?.applyTitleVolumeMap !== 'function') {
        throw new Error('Raven title volume-map API is not configured.');
    }

    const normalizedLibraryId = normalizePositiveInteger(libraryId);
    const seriesDetails = await komfClient.getSeriesMetadataDetails({
        provider: normalizedProvider,
        providerSeriesId: normalizedProviderSeriesId,
        libraryId: normalizedLibraryId,
    });
    const chapterVolumeMap = deriveChapterVolumeMapFromSeriesDetails(seriesDetails);
    const mappedChapterCount = Object.keys(chapterVolumeMap).length;
    const shouldAutoRename = autoRename !== false;

    const ravenPayload = await ravenClient.applyTitleVolumeMap(normalizedTitleUuid, {
        provider: normalizedProvider,
        providerSeriesId: normalizedProviderSeriesId,
        chapterVolumeMap,
        autoRename: shouldAutoRename,
    });

    const renameSummary = mappedChapterCount > 0 ? ravenPayload?.renameSummary ?? null : null;
    const status = mappedChapterCount > 0 ? 'applied' : 'no-op';
    return {
        status,
        titleUuid: normalizedTitleUuid,
        provider: normalizedProvider,
        providerSeriesId: normalizedProviderSeriesId,
        libraryId: normalizedLibraryId,
        mappedChapterCount,
        chapterVolumeMap,
        title: ravenPayload?.title ?? null,
        renameSummary,
        message:
            status === 'applied'
                ? buildAppliedMessage(renameSummary)
                : 'Metadata applied, but the provider had no usable chapter-to-volume coverage, so Raven kept fallback v01 file names.',
    };
};

export default applyRavenTitleVolumeMap;
