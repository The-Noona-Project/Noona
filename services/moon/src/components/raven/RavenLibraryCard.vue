<script setup>
import {computed} from 'vue';

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  status: {
    type: Object,
    default: null,
  },
});

const hasCover = computed(() => Boolean(props.item?.coverImage));

const statusState = computed(() => props.status?.state ?? null);

const isInProgress = computed(() => {
  const state = statusState.value;
  return state === 'pending' || state === 'downloading' || state === 'queued';
});

const isFailed = computed(() => statusState.value === 'failed');

const isCompleted = computed(() => statusState.value === 'completed');

const progressValue = computed(() => {
  const value = props.status?.progress;
  return typeof value === 'number' ? Math.min(100, Math.max(0, value)) : null;
});

const statusMessage = computed(() => {
  if (!props.status) return '';
  if (props.status.message) return props.status.message;
  if (isCompleted.value) return 'Download completed';
  if (isFailed.value) return 'Download failed';
  if (isInProgress.value) return 'Downloading';
  if (statusState.value === 'queued') return 'Queued';
  return '';
});

const subtitle = computed(() => props.item?.subtitle ?? props.item?.author ?? props.item?.series);
</script>

<template>
  <v-card data-test="raven-library-card" class="h-100 d-flex flex-column" elevation="6">
    <v-img
        v-if="hasCover"
        :src="item.coverImage"
        height="160"
        cover
        class="rounded-t"
    />
    <v-card-title class="text-h6">{{ item.title ?? 'Untitled series' }}</v-card-title>
    <v-card-subtitle v-if="subtitle">{{ subtitle }}</v-card-subtitle>
    <v-card-text class="flex-grow-1">
      <p v-if="item.description" class="mb-4 text-body-2">{{ item.description }}</p>
      <div v-if="statusState" class="mb-2">
        <v-chip
            v-if="isCompleted"
            color="success"
            size="small"
            variant="tonal"
            class="mr-2"
        >
          Ready
        </v-chip>
        <v-chip
            v-else-if="isFailed"
            color="error"
            size="small"
            variant="tonal"
            class="mr-2"
        >
          Failed
        </v-chip>
        <v-chip
            v-else
            color="primary"
            size="small"
            variant="tonal"
            class="mr-2"
        >
          {{ isInProgress ? 'Downloading' : statusState }}
        </v-chip>
      </div>
      <v-progress-linear
          v-if="progressValue !== null"
          :model-value="progressValue"
          height="6"
          color="primary"
          rounded
          data-test="download-progress"
      />
      <div
          v-if="statusMessage"
          class="mt-2 text-body-2"
          :class="{'text-error': isFailed}"
      >
        {{ statusMessage }}
      </div>
    </v-card-text>
    <v-divider v-if="item.downloadedAt" />
    <v-card-text v-if="item.downloadedAt" class="text-caption text-medium-emphasis">
      Downloaded {{ new Date(item.downloadedAt).toLocaleString?.() ?? item.downloadedAt }}
    </v-card-text>
  </v-card>
</template>
