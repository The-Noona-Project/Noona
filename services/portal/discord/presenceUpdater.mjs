import {ActivityType} from 'discord.js';

const ACTIVE_WARDEN_STATUSES = new Set([
    'configuring',
    'installing',
    'pending',
    'pulling',
    'recreating',
    'restarting',
    'starting',
    'testing',
    'updating',
]);

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const truncate = (value, max = 120) => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return '';
    }

    if (normalized.length <= max) {
        return normalized;
    }

    return `${normalized.slice(0, Math.max(1, max - 3)).trimEnd()}...`;
};

const isActiveWardenStatus = (value) => ACTIVE_WARDEN_STATUSES.has(normalizeString(value).toLowerCase());
const formatServiceLabel = (value) => {
    const normalized = normalizeString(value);
    if (!normalized) {
        return '';
    }

    return normalized
        .replace(/^noona-/, '')
        .split('-')
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ');
};

const firstActiveInstallationItem = (progress) => {
    const items = Array.isArray(progress?.items) ? progress.items : [];
    return items.find((entry) => isActiveWardenStatus(entry?.status)) ?? null;
};

const normalizeInstalledServices = (payload) =>
    Array.isArray(payload?.services)
        ? payload.services.filter((entry) => entry?.installed === true && normalizeString(entry?.name))
        : [];

export const resolveDiscordPresenceSnapshot = ({serviceActivity = null, ravenSummary = null} = {}) => {
    const serviceLabel = formatServiceLabel(serviceActivity?.label) || formatServiceLabel(serviceActivity?.name);
    if (serviceLabel) {
        return {
            activityType: ActivityType.Watching,
            name: truncate(`Updating ${serviceLabel}`),
            status: 'dnd',
        };
    }

    const activeDownloads = Number(ravenSummary?.activeDownloads);
    const downloadTitle =
        normalizeString(ravenSummary?.currentDownload?.title)
        || normalizeString(ravenSummary?.currentDownload?.currentChapter);
    if (Number.isFinite(activeDownloads) && activeDownloads > 0) {
        return {
            activityType: ActivityType.Watching,
            name: truncate(downloadTitle ? `Downloading ${downloadTitle}` : 'Downloading from Raven'),
            status: 'online',
        };
    }

    const currentCheckTitle = normalizeString(ravenSummary?.currentCheck?.title);
    const ravenState = normalizeString(ravenSummary?.state).toLowerCase();
    if (ravenState === 'checking') {
        return {
            activityType: ActivityType.Watching,
            name: truncate(currentCheckTitle ? `Checking ${currentCheckTitle}` : 'Checking for new titles'),
            status: 'idle',
        };
    }

    return {
        activityType: ActivityType.Watching,
        name: 'Idle',
        status: 'idle',
    };
};

const loadActiveServiceActivity = async (wardenClient) => {
    if (!wardenClient) {
        return null;
    }

    const installProgress = await wardenClient.getInstallationProgress().catch(() => null);
    const activeInstallItem = firstActiveInstallationItem(installProgress);
    if (activeInstallItem) {
        return activeInstallItem;
    }

    const servicesPayload = await wardenClient.listServices({includeInstalled: true}).catch(() => null);
    const installedServices = normalizeInstalledServices(servicesPayload);

    for (const service of installedServices) {
        const serviceName = normalizeString(service?.name);
        if (!serviceName) {
            continue;
        }

        const history = await wardenClient.getServiceHistory(serviceName, {limit: 1}).catch(() => null);
        const summaryStatus = normalizeString(history?.summary?.status).toLowerCase();
        if (!isActiveWardenStatus(summaryStatus)) {
            continue;
        }

        return {
            name: serviceName,
            label: serviceName,
            status: history.summary.status,
            detail: history.summary.detail ?? null,
            updatedAt: history.summary.updatedAt ?? null,
        };
    }

    return null;
};

export const createDiscordPresenceUpdater = ({
                                                 client,
                                                 ravenClient,
                                                 wardenClient,
                                                 pollMs = 15000,
                                                 logger = {},
                                             } = {}) => {
    let intervalId = null;
    let lastPresenceKey = '';
    let running = false;

    const refresh = async () => {
        if (!running || !client?.user?.setPresence) {
            return;
        }

        try {
            const [serviceActivity, ravenSummary] = await Promise.all([
                loadActiveServiceActivity(wardenClient),
                ravenClient?.getDownloadSummary?.().catch(() => null),
            ]);
            const nextPresence = resolveDiscordPresenceSnapshot({serviceActivity, ravenSummary});
            const nextKey = JSON.stringify(nextPresence);
            if (nextKey === lastPresenceKey) {
                return;
            }

            lastPresenceKey = nextKey;
            await client.user.setPresence({
                activities: [{
                    name: nextPresence.name,
                    type: nextPresence.activityType,
                }],
                status: nextPresence.status,
            });
        } catch (error) {
            logger.warn?.(`[Portal/Discord] Failed to refresh bot presence: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    return {
        start() {
            if (running) {
                return;
            }

            running = true;
            void refresh();
            intervalId = setInterval(() => {
                void refresh();
            }, Math.max(5000, Number(pollMs) || 15000));
            intervalId?.unref?.();
        },
        stop() {
            running = false;
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        },
        refresh,
    };
};

export default createDiscordPresenceUpdater;
