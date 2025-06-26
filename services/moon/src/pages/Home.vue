<script setup>
import Header from '../components/Header.vue';
</script>

<template>
  <Header>
    <v-container class="fill-height d-flex align-center justify-center">
      <v-card class="pa-10 text-center" elevation="12" width="500">
        <v-img class="mx-auto mb-6" max-width="100" src="/logo.svg"/>
        <v-card-title class="text-h4 mb-2">Welcome to Noona</v-card-title>
        <v-card-subtitle>Let’s get started by exploring the setup wizard.</v-card-subtitle>
        <v-btn class="mt-6" color="primary" @click="$router.push('/setup')">Go to Setup</v-btn>
      </v-card>
    </v-container>
  </Header>
</template>
