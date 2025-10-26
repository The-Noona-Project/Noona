<script setup>
const props = defineProps({
  panelId: {
    type: String,
    default: undefined
  }
});

const queueLayers = [
  { name: 'Ingress', status: 'Healthy', pending: 4 },
  { name: 'Dispatch', status: 'Healthy', pending: 2 },
  { name: 'Retries', status: 'Draining', pending: 8 },
  { name: 'Archival', status: 'Idle', pending: 0 }
];

const queueLog = `07:41:12  QUEUE accepted build #1047 from portal
07:41:17  QUEUE dispatched container seed job
07:41:33  RETRIES flagged 1 job for requeue
07:41:58  ARCHIVAL completed prune sweep`;
</script>

<template>
  <v-card :id="props.panelId" class="panel-card" elevation="8">
    <v-card-title>
      Queue
      <v-spacer />
      <v-chip color="primary" density="compact" label variant="flat">
        {{ queueLayers.reduce((acc, layer) => acc + layer.pending, 0) }} pending
      </v-chip>
    </v-card-title>
    <v-divider />
    <v-card-text>
      <section class="panel-section" aria-labelledby="queue-layers">
        <header class="panel-section__title" id="queue-layers">Layers</header>
        <div class="panel-scroll">
          <v-list density="compact" bg-color="transparent">
            <v-list-item
              v-for="layer in queueLayers"
              :key="layer.name"
            >
              <template #title>
                <span class="font-weight-medium">{{ layer.name }}</span>
              </template>
              <template #subtitle>
                Status: {{ layer.status }}
              </template>
              <template #append>
                <v-chip
                  :color="layer.pending ? 'warning' : 'secondary'"
                  density="comfortable"
                  label
                  variant="flat"
                >
                  {{ layer.pending }}
                </v-chip>
              </template>
            </v-list-item>
          </v-list>
        </div>
      </section>
      <v-divider />
      <section class="panel-section" aria-labelledby="queue-logs">
        <header class="panel-section__title" id="queue-logs">Logs</header>
        <div class="panel-scroll log-output">
          {{ queueLog }}
        </div>
      </section>
    </v-card-text>
  </v-card>
</template>
