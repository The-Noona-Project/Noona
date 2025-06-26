<script setup>
import {onMounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import {useTheme} from 'vuetify';

const drawer = ref(true); // Sidebar open/closed
const theme = useTheme();
const router = useRouter();
const route = useRoute();

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
        <v-list-item prepend-icon="mdi-cog" @click="navigate('/setup')">
          <v-list-item-title>Go to Setup</v-list-item-title>
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
