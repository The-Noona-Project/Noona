import {createRouter, createWebHistory} from 'vue-router';

const routes = [
    {
        path: '/',
        name: 'Home',
        component: () => import('../pages/Home.vue'),
    },
    {
        path: '/setup',
        name: 'Setup',
        component: () => import('../pages/Setup.vue'), // lazy-loaded
    },
    {
        path: '/warden',
        name: 'Warden',
        component: () => import('../pages/Warden.vue'),
    },
    {
        path: '/vault',
        name: 'Vault',
        component: () => import('../pages/Vault.vue'),
    },
    {
        path: '/portal',
        name: 'Portal',
        component: () => import('../pages/Portal.vue'),
    },
    {
        path: '/sage',
        name: 'Sage',
        component: () => import('../pages/Sage.vue'),
    },
    {
        path: '/moon-service',
        name: 'Moon Service',
        component: () => import('../pages/MoonService.vue'),
    },
    {
        path: '/raven',
        name: 'Raven',
        component: () => import('../pages/Raven.vue'),
    },
    {
        path: '/oracle',
        name: 'Oracle',
        component: () => import('../pages/Oracle.vue'),
    },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

export default router;
