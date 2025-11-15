<script setup>
const props = defineProps({
  panelId: {
    type: String,
    default: undefined
  }
});

const logStreams = [
  { name: 'Warden', level: 'info', lastEntry: 'Provisioned deployment bundle', lines: 128 },
  { name: 'Portal', level: 'warn', lastEntry: 'Rate limit rising on /deploy', lines: 42 },
  { name: 'Moon', level: 'info', lastEntry: 'Serving UI build 0.9.5', lines: 98 },
  { name: 'Raven', level: 'debug', lastEntry: 'Queue flush completed', lines: 167 }
];

const aggregateLog = `07:40:11  [info]  warden  bootstrap checks finished
07:40:58  [warn]  portal  burst limit at 72% for /deploy
07:41:16  [info]  moon    UI bundle 0.9.5 served to cli
07:41:39  [debug] raven   dispatch metrics: p95=184ms`;
</script>

<template>
  <v-card :id="props.panelId" class="panel-card" elevation="8">
    <v-card-title>
      Logs
      <v-spacer />
      <v-chip color="primary" density="compact" label variant="tonal">
        {{ logStreams.reduce((acc, stream) => acc + stream.lines, 0) }} lines buffered
      </v-chip>
    </v-card-title>
    <v-divider />
    <v-card-text>
      <section class="panel-section" aria-labelledby="log-streams">
        <header class="panel-section__title" id="log-streams">Streams</header>
        <div class="panel-scroll">
          <v-table density="compact" class="text-caption">
            <thead>
              <tr>
                <th scope="col" class="text-left">Service</th>
                <th scope="col" class="text-left">Level</th>
                <th scope="col" class="text-left">Last Entry</th>
                <th scope="col" class="text-right">Lines</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="stream in logStreams" :key="stream.name">
                <td>{{ stream.name }}</td>
                <td class="text-uppercase">{{ stream.level }}</td>
                <td>{{ stream.lastEntry }}</td>
                <td class="text-right">{{ stream.lines }}</td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </section>
      <v-divider />
      <section class="panel-section" aria-labelledby="log-aggregate">
        <header class="panel-section__title" id="log-aggregate">Recent Activity</header>
        <div class="panel-scroll log-output">
          {{ aggregateLog }}
        </div>
      </section>
    </v-card-text>
  </v-card>
</template>
