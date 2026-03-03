export const MANAGED_KOMF_CONFIG_FILE_NAME = 'application.yml';

export const DEFAULT_MANAGED_KOMF_APPLICATION_YML = `# Managed by Noona. Edit this in Moon if you need different metadata providers.
kavita:
  metadataUpdate:
    default:
      libraryType: MANGA
      updateModes:
        - API
      aggregate: false
      mergeTags: false
      mergeGenres: false
      bookCovers: false
      seriesCovers: true
      overrideExistingCovers: true
      lockCovers: false
      postProcessing:
        seriesTitle: false
        alternativeSeriesTitles: false

metadataProviders:
  defaultProviders:
    aniList:
      priority: 10
      enabled: true
    mal:
      priority: 20
      enabled: true
    mangaUpdates:
      priority: 30
      enabled: true
`;

export const normalizeManagedKomfConfigContent = (value) => {
    const raw = typeof value === 'string'
        ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        : '';
    const trimmed = raw.trim();
    const next = trimmed ? trimmed : DEFAULT_MANAGED_KOMF_APPLICATION_YML.trimEnd();
    return next.endsWith('\n') ? next : `${next}\n`;
};
