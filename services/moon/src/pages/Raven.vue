<script setup>
import Header from '../components/Header.vue';
</script>

<template>
  <Header>
    <v-container class="py-12">
      <v-row class="justify-center">
        <v-col cols="12" md="8" lg="6">
          <v-card class="pa-8 text-center" elevation="10">
            <v-icon class="mb-4" color="primary" size="48">mdi-crow</v-icon>
            <v-card-title class="text-h4 mb-2">Raven Operations</v-card-title>
            <v-card-subtitle class="mb-4">Monitoring and insights for your Noona services.</v-card-subtitle>
            <v-card-text>
              The Raven console is under construction. Check back soon for dashboards, alerts, and telemetry to keep your deployment healthy.
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </Header>
</template>
