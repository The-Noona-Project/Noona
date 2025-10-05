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
        path: '/raven',
        name: 'Raven',
        component: () => import('../pages/Raven.vue'),
    },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

export default router;
