export const MANAGED_KOMF_CONFIG_FILE_NAME = 'application.yml';

export const DEFAULT_MANAGED_KOMF_APPLICATION_YML = `# Managed by Noona. Edit this in Moon if you need different metadata providers.
kavita:
  eventListener:
    enabled: true
    metadataLibraryFilter: []
    metadataSeriesExcludeFilter: []
    notificationsLibraryFilter: []
  metadataUpdate:
    default:
      libraryType: MANGA
      updateModes:
        - API
      aggregate: true
      mergeTags: true
      mergeGenres: true
      bookCovers: true
      seriesCovers: true
      overrideExistingCovers: true
      lockCovers: false
      postProcessing:
        seriesTitle: true
        alternativeSeriesTitles: true
        alternativeSeriesTitleLanguages:
          - en
        languageValue: en

database:
  file: /config/database.sqlite

metadataProviders:
  malClientId: ""
  comicVineApiKey: ""
  defaultProviders:
    aniList:
      priority: 10
      enabled: true
    mangaUpdates:
      priority: 20
      enabled: true
    mal:
      priority: 30
      enabled: false
    mangaDex:
      priority: 40
      enabled: false
    nautiljon:
      priority: 50
      enabled: false
    yenPress:
      priority: 60
      enabled: false
    kodansha:
      priority: 70
      enabled: false
    viz:
      priority: 80
      enabled: false
    bookWalker:
      priority: 90
      enabled: false
    bangumi:
      priority: 100
      enabled: false
    comicVine:
      priority: 110
      enabled: false
`;

export const normalizeManagedKomfConfigContent = (value) => {
    const raw = typeof value === 'string'
        ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
        : '';
    const trimmed = raw.trim();
    const next = trimmed ? trimmed : DEFAULT_MANAGED_KOMF_APPLICATION_YML.trimEnd();
    return next.endsWith('\n') ? next : `${next}\n`;
};
