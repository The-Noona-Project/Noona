<script setup>
import Header from '../components/Header.vue';

const service = {
  title: 'Sage',
  summary:
    'Monitoring and logging backbone using Prometheus for metrics collection and Grafana for visualization.',
  points: [
    'Collect detailed metrics with Prometheus scraping.',
    'Visualize service health and performance in Grafana dashboards.',
    'Centralize logs to keep operational insights close at hand.',
  ],
};
</script>

<template>
  <Header>
    <section class="service-page">
      <h1 class="service-title">{{ service.title }}</h1>
      <p class="service-summary">{{ service.summary }}</p>
      <ul class="service-points">
        <li v-for="point in service.points" :key="point">
          {{ point }}
        </li>
      </ul>
    </section>
  </Header>
</template>

<style scoped>
.service-page {
  display: grid;
  gap: 1.5rem;
  max-width: 720px;
  margin: 0 auto;
  padding: 3rem 1rem 4rem;
  text-align: center;
}

.service-title {
  font-size: clamp(2rem, 4vw, 2.75rem);
  font-weight: 700;
}

.service-summary {
  font-size: 1.125rem;
  line-height: 1.7;
}

.service-points {
  display: grid;
  gap: 0.75rem;
  padding-left: 1.25rem;
  text-align: left;
}
</style>
