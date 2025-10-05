import {computed, reactive} from 'vue';

export const SERVICE_NAVIGATION_CONFIG = [
    {
        title: 'Home',
        icon: 'mdi-home',
        path: '/',
        description: 'Overview of the Moon control center.',
        requiredService: null,
    },
    {
        title: 'Setup',
        icon: 'mdi-cog-play',
        path: '/setup',
        description: 'Guide for configuring your deployment.',
        requiredService: null,
    },
    {
        title: 'Warden',
        icon: 'mdi-shield-crown',
        path: '/warden',
        description: 'Orchestrator for the entire stack.',
        requiredService: 'noona-warden',
    },
    {
        title: 'Vault',
        icon: 'mdi-safe-square',
        path: '/vault',
        description: 'Authentication and data access gateway.',
        requiredService: 'noona-vault',
    },
    {
        title: 'Portal',
        icon: 'mdi-transit-connection-variant',
        path: '/portal',
        description: 'External integrations hub.',
        requiredService: 'noona-portal',
    },
    {
        title: 'Sage',
        icon: 'mdi-chart-box-outline',
        path: '/sage',
        description: 'Monitoring and logging backbone.',
        requiredService: 'noona-sage',
    },
    {
        title: 'Moon Service',
        icon: 'mdi-moon-waning-crescent',
        path: '/moon-service',
        description: 'Web-based control center features.',
        requiredService: 'noona-moon',
    },
    {
        title: 'Raven',
        icon: 'mdi-crow',
        path: '/raven',
        description: 'Custom Java-based scraper/downloader.',
        requiredService: 'noona-raven',
    },
    {
        title: 'Oracle',
        icon: 'mdi-crystal-ball',
        path: '/oracle',
        description: 'AI assistant layer for insights.',
        requiredService: 'noona-oracle',
    },
];

const state = reactive({
    loading: false,
    services: [],
    error: '',
});

let loadPromise = null;

const servicesList = computed(() => state.services);

const installedServiceNames = computed(() => {
    const installed = new Set();
    for (const service of state.services) {
        if (service && typeof service.name === 'string' && service.installed === true) {
            installed.add(service.name);
        }
    }
    return installed;
});

const hasPendingSetup = computed(() =>
    SERVICE_NAVIGATION_CONFIG.some(
        (item) =>
            !!item.requiredService &&
            !installedServiceNames.value.has(item.requiredService),
    ),
);

const navigationItems = computed(() =>
    SERVICE_NAVIGATION_CONFIG.filter((item) => {
        if (item.path === '/setup') {
            return hasPendingSetup.value;
        }
        if (!item.requiredService) {
            return true;
        }
        return installedServiceNames.value.has(item.requiredService);
    }),
);

function normaliseServices(payload) {
    if (!payload || typeof payload !== 'object') {
        return [];
    }

    const rawServices = Array.isArray(payload.services) ? payload.services : [];
    const normalised = [];

    for (const entry of rawServices) {
        if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') {
            continue;
        }

        normalised.push({
            ...entry,
            installed: entry.installed === true,
        });
    }

    return normalised;
}

async function fetchServices(force = false) {
    if (state.loading) {
        return loadPromise;
    }

    if (!force && state.services.length > 0) {
        return state.services;
    }

    state.loading = true;
    state.error = '';

    loadPromise = (async () => {
        try {
            const response = await fetch('/api/setup/services', {
                headers: {
                    accept: 'application/json',
                },
            });

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            const payload = await response.json();
            state.services = normaliseServices(payload);
            return state.services;
        } catch (error) {
            state.services = [];
            state.error = error instanceof Error ? error.message : 'Failed to load services';
            throw error;
        } finally {
            state.loading = false;
            loadPromise = null;
        }
    })();

    return loadPromise;
}

function ensureLoaded() {
    if (state.services.length > 0) {
        return Promise.resolve(state.services);
    }
    if (loadPromise) {
        return loadPromise;
    }
    return fetchServices(false).catch(() => []);
}

function refresh() {
    return fetchServices(true);
}

function isServiceInstalled(name) {
    if (!name) {
        return true;
    }
    return installedServiceNames.value.has(name);
}

export function useServiceInstallationStore() {
    return {
        services: servicesList,
        loading: computed(() => state.loading),
        error: computed(() => state.error),
        navigationItems,
        hasPendingSetup,
        ensureLoaded,
        refresh,
        isServiceInstalled,
    };
}

export function getRequiredServiceForPath(path) {
    const match = SERVICE_NAVIGATION_CONFIG.find((item) => item.path === path);
    return match?.requiredService || null;
}

export function __resetServiceInstallationStore() {
    state.loading = false;
    state.services = [];
    state.error = '';
    loadPromise = null;
}
