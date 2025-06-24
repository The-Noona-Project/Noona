<template>
  <v-app>
    <v-app-bar color="primary" dark>
      <v-toolbar-title>Noona Moon</v-toolbar-title>
    </v-app-bar>

    <!-- Loading bar while routes load -->
    <v-progress-linear
        v-if="loading"
        absolute
        color="secondary"
        indeterminate
        top
    />

    <v-main class="pa-4">
      <router-view/>
    </v-main>
  </v-app>
</template>

<script setup>
import {onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'

const loading = ref(true)
const router = useRouter()

onMounted(async () => {
  try {
    const res = await fetch('http://noona-sage:3004/api/pages')
    const pages = await res.json()

    const dynamicRoutes = pages.map((page) => ({
      path: page.path,
      name: page.name,
      component: () => import(`./pages/dynamic/${page.name.replace(/\s+/g, '')}.vue`)
    }))

    dynamicRoutes.forEach(route => router.addRoute(route))
  } catch (err) {
    console.warn('[App.vue] Failed to load dynamic pages:', err)
  } finally {
    loading.value = false
  }
})
</script>
