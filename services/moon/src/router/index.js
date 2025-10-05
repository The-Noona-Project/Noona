import {createRouter, createWebHistory} from 'vue-router';
import {getRequiredServiceForPath, useServiceInstallationStore} from '../utils/serviceInstallationStore.js';

const routes = [
    {
        path: '/',
        name: 'Home',
        component: () => import('../pages/Home.vue'),
        meta: {requiredService: getRequiredServiceForPath('/')},
    },
    {
        path: '/setup',
        name: 'Setup',
        component: () => import('../pages/Setup.vue'), // lazy-loaded
        meta: {requiredService: getRequiredServiceForPath('/setup')},
    },
    {
        path: '/warden',
        name: 'Warden',
        component: () => import('../pages/Warden.vue'),
        meta: {requiredService: getRequiredServiceForPath('/warden')},
    },
    {
        path: '/vault',
        name: 'Vault',
        component: () => import('../pages/Vault.vue'),
        meta: {requiredService: getRequiredServiceForPath('/vault')},
    },
    {
        path: '/portal',
        name: 'Portal',
        component: () => import('../pages/Portal.vue'),
        meta: {requiredService: getRequiredServiceForPath('/portal')},
    },
    {
        path: '/sage',
        name: 'Sage',
        component: () => import('../pages/Sage.vue'),
        meta: {requiredService: getRequiredServiceForPath('/sage')},
    },
    {
        path: '/moon-service',
        name: 'Moon Service',
        component: () => import('../pages/MoonService.vue'),
        meta: {requiredService: getRequiredServiceForPath('/moon-service')},
    },
    {
        path: '/raven',
        name: 'Raven',
        component: () => import('../pages/Raven.vue'),
        meta: {requiredService: getRequiredServiceForPath('/raven')},
    },
    {
        path: '/oracle',
        name: 'Oracle',
        component: () => import('../pages/Oracle.vue'),
        meta: {requiredService: getRequiredServiceForPath('/oracle')},
    },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

router.beforeEach(async (to) => {
    const requiredService = to.meta?.requiredService ?? getRequiredServiceForPath(to.path);

    if (!requiredService) {
        return true;
    }

    const store = useServiceInstallationStore();

    try {
        await store.ensureLoaded();
    } catch (error) {
        return true;
    }

    if (store.isServiceInstalled(requiredService)) {
        return true;
    }

    if (to.path === '/setup') {
        return true;
    }

    return {path: '/setup'};
});

export default router;
