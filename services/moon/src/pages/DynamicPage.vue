<!-- DynamicPage.vue -->
<template>
  <v-container class="py-8">
    <v-row justify="center">
      <v-col cols="12" md="10">
        <!-- Show the page content if loaded -->
        <div v-if="htmlContent" class="page-html" v-html="htmlContent"></div>

        <!-- Show loader while waiting -->
        <div v-else class="text-center">
          <v-progress-circular color="primary" indeterminate size="64"/>
          <p class="mt-4">Loading page...</p>
        </div>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
/**
 * DynamicPage.vue
 * This component loads dynamic HTML content from Sage via the /dynamic/:slug endpoint.
 * The slug is extracted from the route and used to request content (e.g. from Redis).
 * Content is rendered using v-html after basic loading/error handling.
 */

import {onMounted, ref, watch} from 'vue'
import {useRoute} from 'vue-router'

const route = useRoute()
const htmlContent = ref(null)

/**
 * Fetch page content by slug from Moon proxy to Sage.
 * @param {string} slug - the dynamic route parameter
 */
async function loadPage(slug) {
  htmlContent.value = null
  try {
    const res = await fetch(`/dynamic/${slug}`)
    if (res.ok) {
      htmlContent.value = await res.text()
    } else {
      htmlContent.value = `<h2 class="text-error">404: Page Not Found</h2>`
    }
  } catch (err) {
    htmlContent.value = `<h2 class="text-error">Error loading page: ${err.message}</h2>`
  }
}

// On initial mount
onMounted(() => {
  loadPage(route.params.slug)
})

// If slug changes dynamically (e.g. user clicks another dynamic page link)
watch(() => route.params.slug, (newSlug) => {
  if (newSlug) loadPage(newSlug)
})
</script>

<style scoped>
.page-html :deep(h1),
.page-html :deep(h2),
.page-html :deep(h3) {
  margin-top: 1.5rem;
}

.page-html :deep(p) {
  margin: 0.75rem 0;
}

.text-error {
  color: #f44336;
}
</style>
