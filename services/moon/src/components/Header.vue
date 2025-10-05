<script setup>
import {onMounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import {useTheme} from 'vuetify';

const drawer = ref(true); // Sidebar open/closed
const theme = useTheme();
const router = useRouter();
const route = useRoute();

const navigationItems = [
  {title: 'Home', icon: 'mdi-home', path: '/', description: 'Overview of the Moon control center.'},
  {title: 'Setup', icon: 'mdi-cog-play', path: '/setup', description: 'Guide for configuring your deployment.'},
  {title: 'Warden', icon: 'mdi-shield-crown', path: '/warden', description: 'Orchestrator for the entire stack.'},
  {title: 'Vault', icon: 'mdi-safe-square', path: '/vault', description: 'Authentication and data access gateway.'},
  {title: 'Portal', icon: 'mdi-transit-connection-variant', path: '/portal', description: 'External integrations hub.'},
  {title: 'Sage', icon: 'mdi-chart-box-outline', path: '/sage', description: 'Monitoring and logging backbone.'},
  {title: 'Moon Service', icon: 'mdi-moon-waning-crescent', path: '/moon-service', description: 'Web-based control center features.'},
  {title: 'Raven', icon: 'mdi-crow', path: '/raven', description: 'Custom Java-based scraper/downloader.'},
  {title: 'Oracle', icon: 'mdi-crystal-ball', path: '/oracle', description: 'AI assistant layer for insights.'},
];

// Collapse sidebar after navigation (especially for mobile)
const navigate = (path) => {
  router.push(path);
  drawer.value = false;
};

// Toggle theme and persist it
const toggleDark = () => {
  const isDark = theme.global.current.value.dark;
  const newTheme = isDark ? 'light' : 'dark';
  theme.global.name.value = newTheme;
  localStorage.setItem('noona-theme', newTheme);
};

// Load persisted theme
onMounted(() => {
  const saved = localStorage.getItem('noona-theme');
  if (saved) theme.global.name.value = saved;

  const savedDrawer = localStorage.getItem('noona-drawer');
  if (savedDrawer !== null) drawer.value = savedDrawer === 'true';
});

// Persist drawer state
watch(drawer, (val) => {
  localStorage.setItem('noona-drawer', val.toString());
});
</script>

<template>
  <v-app>
    <!-- Sidebar -->
    <v-navigation-drawer
        v-model="drawer"
        app
        mobile-breakpoint="sm"
        touch
    >
      <v-list dense nav>
        <v-list-item-title class="text-h6 text-center">Noona</v-list-item-title>
        <v-divider class="my-2"/>
        <v-list-item prepend-icon="mdi-theme-light-dark" @click="toggleDark">
          <v-list-item-title>Toggle Dark Mode</v-list-item-title>
        </v-list-item>
        <v-divider class="my-4"/>
        <v-list-subheader>Explore Services</v-list-subheader>
        <v-list-item
            v-for="item in navigationItems"
            :key="item.path"
            :prepend-icon="item.icon"
            :active="route.path === item.path"
            rounded
            @click="navigate(item.path)"
        >
          <v-list-item-title>{{ item.title }}</v-list-item-title>
          <v-list-item-subtitle>{{ item.description }}</v-list-item-subtitle>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>

    <!-- Top App Bar -->
    <v-app-bar app color="primary" dark>
      <v-app-bar-nav-icon @click="drawer = !drawer"/>
      <v-img class="mr-4" max-height="40" max-width="40" src="/logo.svg"/>
      <v-toolbar-title>{{ route.name ?? 'Noona' }}</v-toolbar-title>
    </v-app-bar>

    <!-- Page Content -->
    <v-main>
      <slot/>
    </v-main>
  </v-app>
</template>
