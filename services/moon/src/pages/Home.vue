<!-- src/pages/Home.vue -->

<template>
  <v-container class="py-8">
    <v-row>
      <!-- Render one card per page dynamically -->
      <v-col
          v-for="page in pages"
          :key="page.name"
          cols="12"
          md="4"
          sm="6"
      >
        <v-card
            class="hoverable"
            color="primary"
            dark
            @click="goTo(page.path)"
        >
          <v-card-title>{{ page.name }}</v-card-title>
        </v-card>
      </v-col>
    </v-row>

    <!-- Show fallback message if no pages -->
    <v-row v-if="pages.length === 0">
      <v-col class="text-center text-grey" cols="12">
        <v-icon size="48">mdi-folder-open</v-icon>
        <div>No pages available.</div>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
/**
 * Home.vue
 * Displays all dynamic pages fetched from the Sage API.
 * Each page appears as a clickable Vuetify card.
 */

import {onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'

const router = useRouter()

/**
 * Reactive array of page links
 * @type {import('vue').Ref<Array<{ name: string, path: string }>>}
 */
const pages = ref([])

/**
 * Fetch dynamic page data from the Sage service.
 * If the request fails, show fallback sample pages.
 */
onMounted(async () => {
  try {
    const res = await fetch('http://noona-sage:3004/api/pages')
    pages.value = await res.json()
  } catch (err) {
    console.warn('[Home.vue] Failed to fetch pages from Sage:', err)

    // Dev fallback
    pages.value = [
      {name: 'Test Page', path: '/dynamic/test'},
      {name: 'Setup Wizard', path: '/dynamic/setupwizard'}
    ]
  }
})

/**
 * Navigate to selected dynamic page
 * @param {string} path
 */
function goTo(path) {
  router.push(path)
}
</script>

<style scoped>
.v-card {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.v-card:hover {
  transform: scale(1.02);
}
</style>
