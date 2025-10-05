<script setup>
import Header from '../components/Header.vue';

const servicePages = [
  {
    title: 'Warden',
    summary:
      'Orchestrator for the entire stack. Builds Docker images, provisions containers, enforces boot order, performs health checks, and manages rolling updates across master and node deployments.',
    path: '/warden',
    icon: 'mdi-shield-crown',
  },
  {
    title: 'Vault',
    summary:
      'Authentication and data access gateway. Issues JWTs to services, brokers reads/writes to MongoDB and Redis, and secures internal APIs.',
    path: '/vault',
    icon: 'mdi-safe-square',
  },
  {
    title: 'Portal',
    summary:
      "External integrations hub. Handles Discord command logic, listens for guild events, and bridges to Kavita's APIs.",
    path: '/portal',
    icon: 'mdi-transit-connection-variant',
  },
  {
    title: 'Sage',
    summary:
      'Monitoring and logging backbone using Prometheus for metrics collection and Grafana for visualization.',
    path: '/sage',
    icon: 'mdi-chart-box-outline',
  },
  {
    title: 'Moon Service',
    summary:
      'Web-based control center built with React. Provides dashboards for admins and readers, Discord authentication, AI chat, request management, and service status.',
    path: '/moon-service',
    icon: 'mdi-moon-waning-crescent',
  },
  {
    title: 'Raven',
    summary:
      'Custom Java-based scraper/downloader. Automates content acquisition, metadata enrichment, and CBZ packaging.',
    path: '/raven',
    icon: 'mdi-crow',
  },
  {
    title: 'Oracle',
    summary:
      'AI assistant layer powered by LangChain, LocalAI/AnythingLLM for conversational insights and recommendations.',
    path: '/oracle',
    icon: 'mdi-crystal-ball',
  },
];
</script>

<template>
  <Header>
    <v-container class="py-12">
      <v-row justify="center" class="mb-12">
        <v-col cols="12" md="8" lg="6">
          <v-card class="pa-10 text-center" elevation="12">
            <v-img class="mx-auto mb-6" max-width="100" src="/logo.svg"/>
            <v-card-title class="text-h4 mb-2">Welcome to Noona</v-card-title>
            <v-card-subtitle class="mb-6">
              Explore the control surfaces for every service or jump straight into the setup wizard.
            </v-card-subtitle>
            <v-btn color="primary" size="large" @click="$router.push('/setup')">
              Launch Setup Wizard
            </v-btn>
          </v-card>
        </v-col>
      </v-row>

      <v-row class="service-grid" dense>
        <v-col
            v-for="service in servicePages"
            :key="service.path"
            cols="12"
            md="6"
            lg="4"
        >
          <v-card class="h-100 d-flex flex-column justify-space-between" elevation="4">
            <div class="pa-6">
              <v-icon :icon="service.icon" size="40" class="mb-4 text-primary"/>
              <h2 class="text-h5 mb-3">{{ service.title }}</h2>
              <p class="text-body-2 mb-6">{{ service.summary }}</p>
            </div>
            <v-divider/>
            <v-card-actions>
              <v-btn block color="secondary" variant="text" @click="$router.push(service.path)">
                View {{ service.title }}
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </Header>
</template>
