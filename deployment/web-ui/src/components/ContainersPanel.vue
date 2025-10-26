<script setup>
const props = defineProps({
  panelId: {
    type: String,
    default: undefined
  }
});

const containers = [
  { name: 'warden-api', image: 'registry/noona/warden:1.8.2', status: 'Running', uptime: '3h 14m' },
  { name: 'portal-edge', image: 'registry/noona/portal:2.4.1', status: 'Running', uptime: '3h 15m' },
  { name: 'moon-ui', image: 'registry/noona/moon:0.9.5', status: 'Restarting', uptime: '2m 12s' },
  { name: 'sage-analytics', image: 'registry/noona/sage:3.2.0', status: 'Running', uptime: '3h 02m' }
];

const statusColor = (status) => {
  if (status === 'Running') return 'success';
  if (status === 'Restarting') return 'warning';
  return 'error';
};

const containerLog = `07:41:07  warden-api heartbeat OK (67ms)
07:41:22  moon-ui restart triggered by deploy CLI
07:41:30  moon-ui container healthy after 2 probes
07:41:44  portal-edge scaled to 3 replicas`;
</script>

<template>
  <v-card :id="props.panelId" class="panel-card" elevation="8">
    <v-card-title>
      Containers
      <v-spacer />
      <v-chip color="accent" density="compact" label variant="flat">
        {{ containers.filter((container) => container.status === 'Running').length }} / {{ containers.length }} healthy
      </v-chip>
    </v-card-title>
    <v-divider />
    <v-card-text>
      <section class="panel-section" aria-labelledby="container-status">
        <header class="panel-section__title" id="container-status">Runtime</header>
        <div class="panel-scroll">
          <v-list density="compact" bg-color="transparent">
            <v-list-item v-for="container in containers" :key="container.name">
              <template #title>
                <span class="font-weight-medium">{{ container.name }}</span>
              </template>
              <template #subtitle>
                {{ container.image }}
              </template>
              <template #append>
                <div class="d-flex flex-column align-end text-caption">
                  <v-chip
                    :color="statusColor(container.status)"
                    density="comfortable"
                    label
                    variant="flat"
                  >
                    {{ container.status }}
                  </v-chip>
                  <span class="mt-1">Uptime {{ container.uptime }}</span>
                </div>
              </template>
            </v-list-item>
          </v-list>
        </div>
      </section>
      <v-divider />
      <section class="panel-section" aria-labelledby="container-logs">
        <header class="panel-section__title" id="container-logs">Logs</header>
        <div class="panel-scroll log-output">
          {{ containerLog }}
        </div>
      </section>
    </v-card-text>
  </v-card>
</template>
