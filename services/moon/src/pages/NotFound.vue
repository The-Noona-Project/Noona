<!-- NotFound.vue -->
<template>
  <v-container class="text-center py-10">
    <h1 class="text-h2 font-weight-bold mb-4">404 - Page Not Found</h1>
    <p class="mb-6">
      The page you’re looking for doesn’t exist or has been moved.
    </p>
    <v-btn
        :to="'/'"
        color="primary"
        variant="tonal"
    >
      Back to Home
    </v-btn>
  </v-container>
</template>

<script setup>
// This component handles unknown or invalid routes.
</script>
