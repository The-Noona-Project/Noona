<!-- SetupWizard.vue -->
<template>
  <v-container class="py-8">
    <v-row justify="center">
      <v-col class="text-center" cols="12" md="8">
        <h1 class="mb-4">🧙 Noona Setup Wizard</h1>

        <v-alert
            v-if="error"
            border="start"
            class="mb-4"
            prominent
            type="error"
        >
          {{ error }}
        </v-alert>

        <v-progress-circular
            v-if="loading"
            class="my-8"
            color="primary"
            indeterminate
            size="64"
        />

        <v-row v-else>
          <v-col
              v-for="page in pages"
              :key="page.path"
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
              <v-card-title class="text-center">{{ page.name }}</v-card-title>
            </v-card>
          </v-col>

          <v-col v-if="pages.length === 0" class="text-grey text-center" cols="12">
            <v-icon size="48">mdi-folder-open</v-icon>
            <p>No setup pages available.</p>
          </v-col>
        </v-row>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import {onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'

const pages = ref([])
const loading = ref(true)
const error = ref(null)
const router = useRouter()

onMounted(async () => {
  try {
    const res = await fetch('/api/pages')
    if (!res.ok) throw new Error(`API returned ${res.status}`)
    pages.value = await res.json()
  } catch (err) {
    error.value = `Failed to load pages: ${err.message}`
  } finally {
    loading.value = false
  }
})

function goTo(path) {
  router.push(path)
}
</script>

<style scoped>
h1 {
  font-weight: bold;
}

.hoverable {
  cursor: pointer;
  transition: transform 0.2s ease;
}

.hoverable:hover {
  transform: scale(1.02);
}
</style>
