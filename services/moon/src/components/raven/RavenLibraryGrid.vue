<script setup>
import {computed} from 'vue';
import RavenLibraryCard from './RavenLibraryCard.vue';

const props = defineProps({
  items: {
    type: Array,
    default: () => [],
  },
  statuses: {
    type: Array,
    default: () => [],
  },
});

const itemKey = (item, index) => {
  const candidate = item?.id ?? item?.slug ?? item?.seriesId ?? item?.title;
  return candidate != null ? String(candidate) : `item-${index}`;
};

const statusKey = (status) => {
  if (!status) return null;
  const key =
    status.libraryId ??
    status.id ??
    status.searchId ??
    status.seriesId ??
    status.title ??
    null;
  return key != null ? String(key) : null;
};

const statusMap = computed(() => {
  const map = new Map();
  props.statuses?.forEach((status) => {
    const key = statusKey(status);
    if (key !== null) {
      map.set(key, status);
    }
  });
  return map;
});

const combinedEntries = computed(() => {
  const seen = new Set();
  const entries = [];

  props.items?.forEach((item, index) => {
    const key = itemKey(item, index);
    const normalizedKey = key != null ? String(key) : `item-${index}`;
    const status = statusMap.value.get(normalizedKey) ?? null;
    entries.push({key: normalizedKey, item, status});
    seen.add(normalizedKey);
  });

  statusMap.value.forEach((status, key) => {
    if (seen.has(key)) return;
    entries.push({
      key,
      item: {
        id: key,
        title: status.title ?? 'Processing download',
        description: status.message ?? 'This title is being prepared.',
      },
      status,
    });
  });

  return entries;
});
</script>

<template>
  <v-row dense>
    <v-col
        v-for="entry in combinedEntries"
        :key="entry.key"
        cols="12"
        sm="6"
        md="4"
        class="d-flex"
    >
      <RavenLibraryCard :item="entry.item" :status="entry.status" class="flex-grow-1" />
    </v-col>
  </v-row>
</template>
