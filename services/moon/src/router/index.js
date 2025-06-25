// 🌕 Noona Moon — Vue Router
//
// This file sets up all frontend routes for the Noona Moon interface.
// Dynamic pages are registered under /dynamic/:slug, served from Redis.
// The setup wizard can be accessed at /setup.

import {createRouter, createWebHistory} from 'vue-router'

// Lazy-loaded page views
const Home = () => import('@/pages/Home.vue')
const SetupWizard = () => import('@/pages/SetupWizard.vue')
const DynamicPage = () => import('@/pages/DynamicPage.vue')
const NotFound = () => import('@/pages/NotFound.vue')

const routes = [
    {
        path: '/',
        name: 'Home',
        component: Home
    },
    {
        path: '/setup',
        name: 'SetupWizard',
        component: SetupWizard
    },
    {
        path: '/dynamic/:slug',
        name: 'DynamicPage',
        component: DynamicPage,
        props: true
    },
    {
        path: '/:pathMatch(.*)*',
        name: 'NotFound',
        component: NotFound
    }
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

export default router
