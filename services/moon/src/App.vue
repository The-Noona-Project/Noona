<!-- 🌕 Noona Moon — Root App Shell -->

<script setup>
</script>

<template>
  <v-app>
    <!-- Top Navigation Bar -->
    <v-app-bar color="primary" dark>
      <v-app-bar-title>Noona Moon</v-app-bar-title>
    </v-app-bar>

    <!-- Page Content -->
    <v-main>
      <v-container class="fill-height" fluid>
        <router-view/>
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
</style>
