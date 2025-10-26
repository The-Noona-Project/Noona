<script setup>
import { onMounted, ref, watch } from 'vue';
import QueuePanel from './components/QueuePanel.vue';
import SchedulerPanel from './components/SchedulerPanel.vue';
import ContainersPanel from './components/ContainersPanel.vue';
import LogsPanel from './components/LogsPanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';

const tabs = [
  { label: 'Queue', value: 'queue', description: 'Queue metrics and pending workloads' },
  { label: 'Scheduler', value: 'scheduler', description: 'Scheduling cadence and windows' },
  { label: 'Containers', value: 'containers', description: 'Runtime container lifecycle' },
  { label: 'Logs', value: 'logs', description: 'Aggregated runtime output' },
  { label: 'Settings', value: 'settings', description: 'Control plane toggles' }
];

const panelIds = {
  queue: 'queue-panel',
  scheduler: 'scheduler-panel',
  containers: 'containers-panel',
  logs: 'logs-panel',
  settings: 'settings-panel'
};

const activeTab = ref(tabs[0].value);

const scrollToPanel = (value) => {
  const id = panelIds[value];
  if (!id) return;
  const element = document.getElementById(id);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

watch(activeTab, scrollToPanel);

onMounted(() => {
  scrollToPanel(activeTab.value);
});
</script>

<template>
  <v-app>
    <v-main class="app-shell">
      <header class="app-header">
        <div class="app-title">
          <h1>Warden Deployment Console</h1>
          <p>Mirrors the CLI navigation while keeping each operational layer pinned in view.</p>
        </div>
        <v-tabs
          v-model="activeTab"
          class="app-tabs"
          density="comfortable"
          height="64"
          grow
        >
          <v-tab
            v-for="tab in tabs"
            :key="tab.value"
            :value="tab.value"
            class="text-none"
          >
            <span class="tab-label">{{ tab.label }}</span>
            <span class="tab-caption">{{ tab.description }}</span>
          </v-tab>
        </v-tabs>
      </header>
      <section class="panels-grid" aria-label="Process panels">
        <QueuePanel :panel-id="panelIds.queue" />
        <SchedulerPanel :panel-id="panelIds.scheduler" />
        <ContainersPanel :panel-id="panelIds.containers" />
        <LogsPanel :panel-id="panelIds.logs" />
        <SettingsPanel :panel-id="panelIds.settings" />
      </section>
    </v-main>
  </v-app>
</template>

<style scoped>
.app-shell {
  background: radial-gradient(circle at top, rgba(79, 70, 229, 0.12), transparent 45%), #0f172a;
  min-height: 100vh;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.app-header {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 16px;
}

.app-title h1 {
  margin: 0;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 1.1rem;
}

.app-title p {
  margin: 4px 0 0;
  color: rgba(255, 255, 255, 0.6);
}

.app-tabs {
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px);
}

.tab-label {
  display: block;
  font-weight: 600;
}

.tab-caption {
  display: block;
  font-size: 0.7rem;
  opacity: 0.6;
}

.panels-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 20px;
  align-items: stretch;
}
</style>
