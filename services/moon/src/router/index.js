import {createRouter, createWebHistory} from 'vue-router'
import Home from '../pages/Home.vue'

const routes = [
    {path: '/', component: Home},
    {
        path: '/dynamic/:slug',
        component: {
            template: `<v-container class="text-center py-12">
        <v-icon size="64">mdi-rocket-launch</v-icon>
        <h1>This is a dynamic page: {{ $route.params.slug }}</h1>
      </v-container>`,
        },
    },
]

const router = createRouter({
    history: createWebHistory(),
    routes,
})

export default router
