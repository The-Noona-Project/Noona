<script setup>
const props = defineProps({
  panelId: {
    type: String,
    default: undefined
  }
});

const windows = [
  { window: '00:00 - 02:00 UTC', task: 'Security patches', cadence: 'Daily' },
  { window: '04:00 - 06:00 UTC', task: 'Database compaction', cadence: 'Tues & Fri' },
  { window: '09:00 - 11:00 UTC', task: 'Canary rollouts', cadence: 'Hourly' },
  { window: '14:00 - 15:00 UTC', task: 'Backlog rebalancing', cadence: 'On demand' }
];

const schedulerLog = `07:40:03  NEXT WINDOW 09:00 UTC canary rollout
07:40:05  SCHEDULER acked queue drain request
07:40:41  WINDOW 04:00 UTC compaction succeeded
07:41:22  All cron expressions evaluated in 36ms`;
</script>

<template>
  <v-card :id="props.panelId" class="panel-card" elevation="8">
    <v-card-title>
      Scheduler
      <v-spacer />
      <v-chip color="secondary" density="compact" label variant="flat">
        {{ windows.length }} active windows
      </v-chip>
    </v-card-title>
    <v-divider />
    <v-card-text>
      <section class="panel-section" aria-labelledby="scheduler-windows">
        <header class="panel-section__title" id="scheduler-windows">Windows</header>
        <div class="panel-scroll">
          <v-table density="compact" class="text-caption">
            <thead>
              <tr>
                <th scope="col" class="text-left">Window</th>
                <th scope="col" class="text-left">Task</th>
                <th scope="col" class="text-left">Cadence</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="window in windows" :key="window.window">
                <td>{{ window.window }}</td>
                <td>{{ window.task }}</td>
                <td>{{ window.cadence }}</td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </section>
      <v-divider />
      <section class="panel-section" aria-labelledby="scheduler-logs">
        <header class="panel-section__title" id="scheduler-logs">Logs</header>
        <div class="panel-scroll log-output">
          {{ schedulerLog }}
        </div>
      </section>
    </v-card-text>
  </v-card>
</template>
