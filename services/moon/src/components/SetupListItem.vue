<script lang="ts" setup>
import { computed } from 'vue';

type ServiceCategory = 'core' | 'addon' | string;

interface ServiceOption {
  name: string;
  category?: ServiceCategory;
  image?: string | null;
  description?: string | null;
  hostServiceUrl?: string | null;
  port?: number | null;
  health?: string | null;
}

const props = defineProps<{
  service: ServiceOption;
  selected?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (event: 'toggle', name: string): void;
}>();

const categoryLabel = computed(() => {
  const category = props.service.category ?? 'service';

  if (category === 'core') return 'Core Service';
  if (category === 'addon') return 'Addon';

  return category
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
});

const handleToggle = () => {
  if (props.disabled) return;
  emit('toggle', props.service.name);
};

const descriptionText = computed(() => {
  if (props.service.description) {
    return props.service.description;
  }

  if (props.service.category === 'core') {
    return 'Essential Noona component.';
  }

  if (props.service.category === 'addon') {
    return 'Optional add-on service.';
  }

  return 'Service configuration';
});
</script>

<template>
  <v-list-item
    class="setup-list-item"
    :class="{
      'setup-list-item--selected': selected,
      'setup-list-item--disabled': disabled,
    }"
    role="checkbox"
    :aria-checked="selected"
    :aria-disabled="disabled"
    :tabindex="disabled ? -1 : 0"
    :ripple="!disabled"
    @click="handleToggle"
    @keydown.enter.prevent="handleToggle"
    @keydown.space.prevent="handleToggle"
  >
    <template #prepend>
      <v-checkbox-btn
        :model-value="selected"
        :disabled="disabled"
        color="primary"
        class="setup-list-item__checkbox"
        @click.stop="handleToggle"
        @keydown.enter.stop.prevent="handleToggle"
        @keydown.space.stop.prevent="handleToggle"
      />
    </template>

    <div class="setup-list-item__body">
      <div class="setup-list-item__header">
        <span class="setup-list-item__name">{{ service.name }}</span>
        <v-chip
          color="primary"
          size="x-small"
          variant="tonal"
          class="setup-list-item__chip text-uppercase font-weight-bold"
        >
          {{ categoryLabel }}
        </v-chip>
      </div>

      <p class="setup-list-item__description text-body-2">
        {{ descriptionText }}
      </p>

      <div class="setup-list-item__meta text-body-2 text-medium-emphasis">
        <div>
          <span class="font-weight-medium">Image:</span>
          <span class="ml-1">{{ service.image ?? 'Unknown' }}</span>
        </div>
        <div v-if="service.hostServiceUrl">
          <span class="font-weight-medium">Host URL:</span>
          <a
            :href="service.hostServiceUrl"
            target="_blank"
            rel="noopener"
            class="setup-list-item__link ml-1"
            @click.stop
          >
            {{ service.hostServiceUrl }}
          </a>
        </div>
        <div v-else-if="service.port != null">
          <span class="font-weight-medium">Port:</span>
          <span class="ml-1">{{ service.port }}</span>
        </div>
        <div v-if="service.health">
          <span class="font-weight-medium">Health:</span>
          <span class="ml-1">{{ service.health }}</span>
        </div>
      </div>
    </div>
  </v-list-item>
</template>

<style scoped>
.setup-list-item {
  border-radius: 8px;
  transition: background-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  cursor: pointer;
  padding-inline-end: 16px;
}

.setup-list-item:hover:not(.setup-list-item--disabled) {
  background-color: rgba(var(--v-theme-primary), 0.08);
}

.setup-list-item:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.6);
  outline-offset: 2px;
}

.setup-list-item--selected {
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.35);
  background-color: rgba(var(--v-theme-primary), 0.04);
}

.setup-list-item--disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.setup-list-item__checkbox {
  margin-inline-end: 12px;
}

.setup-list-item__body {
  width: 100%;
}

.setup-list-item__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.setup-list-item__name {
  font-weight: 600;
  font-size: 1.05rem;
}

.setup-list-item__chip {
  letter-spacing: 0.08em;
}

.setup-list-item__description {
  margin: 0 0 6px;
  color: rgba(var(--v-theme-on-surface), 0.74);
}

.setup-list-item__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.setup-list-item__link {
  text-decoration: none;
}

.setup-list-item__link:hover,
.setup-list-item__link:focus {
  text-decoration: underline;
}
</style>
