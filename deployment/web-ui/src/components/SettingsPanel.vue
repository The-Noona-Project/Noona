<script setup>
import { reactive } from 'vue';

const props = defineProps({
  panelId: {
    type: String,
    default: undefined
  }
});

const toggles = reactive([
  { key: 'autoPromote', label: 'Auto-promote green builds', enabled: true },
  { key: 'freezeDeploys', label: 'Freeze production deploys', enabled: false },
  { key: 'captureMetrics', label: 'Capture extended metrics', enabled: true },
  { key: 'verboseLogging', label: 'Enable verbose CLI logs', enabled: false }
]);

const settingsLog = `07:39:50  Feature flag autoPromote enabled by ci-bot
07:40:22  Metrics stream pointed at us-west-2
07:40:45  Verbose logging left disabled (operator preference)`;
</script>

<template>
  <v-card :id="props.panelId" class="panel-card" elevation="8">
    <v-card-title>
      Settings
      <v-spacer />
      <v-chip color="secondary" density="compact" label variant="flat">
        {{ toggles.filter((toggle) => toggle.enabled).length }} active
      </v-chip>
    </v-card-title>
    <v-divider />
    <v-card-text>
      <section class="panel-section" aria-labelledby="settings-flags">
        <header class="panel-section__title" id="settings-flags">Feature Flags</header>
        <div class="panel-scroll">
          <v-list bg-color="transparent" density="compact">
            <v-list-item v-for="toggle in toggles" :key="toggle.key">
              <template #title>
                {{ toggle.label }}
              </template>
              <template #append>
                <v-switch
                  v-model="toggle.enabled"
                  color="primary"
                  density="compact"
                  hide-details
                />
              </template>
            </v-list-item>
          </v-list>
        </div>
      </section>
      <v-divider />
      <section class="panel-section" aria-labelledby="settings-logs">
        <header class="panel-section__title" id="settings-logs">Audit Trail</header>
        <div class="panel-scroll log-output">
          {{ settingsLog }}
        </div>
      </section>
    </v-card-text>
  </v-card>
</template>
