<template>
  <v-container class="py-10">
    <v-row justify="center">
      <v-col class="text-center" cols="12" md="8">
        <h1 class="mb-4">📘 Available Pages</h1>
        <p class="mb-8">Choose a dynamic page below to launch it.</p>
      </v-col>
    </v-row>

    <!-- Cards grid -->
    <v-row dense>
      <v-col
          v-for="page in pages"
          :key="page.path"
          cols="12"
          lg="3"
          md="4"
          sm="6"
      >
        <v-card
            class="hoverable"
            color="primary"
            dark
            @click="goTo(page.path)"
        >
          <v-card-title class="justify-center">
            {{ page.name }}
          </v-card-title>
        </v-card>
      </v-col>
    </v-row>

    <!-- No pages fallback -->
    <v-row v-if="pages.length === 0">
      <v-col class="text-center text-grey" cols="12">
        <v-icon size="48">mdi-folder-open</v-icon>
        <div class="mt-2">No pages available yet.</div>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import {onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'

const router = useRouter()
const pages = ref([])

onMounted(async () => {
  try {
    const res = await fetch('http://noona-sage:3004/api/pages')
    pages.value = await res.json()
  } catch (err) {
    console.warn('[Home.vue] Failed to fetch dynamic pages:', err)
    pages.value = []
  }
})

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
  transform: scale(1.03);
}
</style>
