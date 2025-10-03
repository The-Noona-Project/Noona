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

const chipColor = computed(() => {
  if (props.service.category === 'core') return 'deep-purple';
  if (props.service.category === 'addon') return 'teal';
  return 'primary';
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
  <v-card
    :elevation="selected ? 8 : 2"
    class="setup-card"
    :class="{
      'setup-card--selected': selected,
      'setup-card--disabled': disabled,
    }"
    role="checkbox"
    :aria-checked="selected"
    :aria-disabled="disabled"
    tabindex="0"
    @click="handleToggle"
    @keydown.enter.prevent="handleToggle"
    @keydown.space.prevent="handleToggle"
  >
    <v-card-item class="pb-0">
      <div class="d-flex align-center justify-space-between">
        <div>
          <div class="text-subtitle-1 font-weight-medium mb-1">
            {{ service.name }}
          </div>
          <v-chip :color="chipColor" size="small" variant="tonal" class="text-uppercase font-weight-bold">
            {{ categoryLabel }}
          </v-chip>
        </div>
        <v-checkbox-btn
          :model-value="selected"
          :disabled="disabled"
          color="primary"
          @click.stop="handleToggle"
          @update:modelValue="handleToggle"
        />
      </div>
    </v-card-item>

    <v-card-text class="pt-3">
      <p class="text-body-2 text-medium-emphasis mb-3">
        {{ descriptionText }}
      </p>

      <div class="text-body-2 text-medium-emphasis">
        <span class="font-weight-medium">Image:</span>
        <span class="ml-1">{{ service.image ?? 'Unknown' }}</span>
      </div>

      <div v-if="service.hostServiceUrl" class="text-body-2 text-medium-emphasis mt-1">
        <span class="font-weight-medium">Host URL:</span>
        <a
          :href="service.hostServiceUrl"
          target="_blank"
          rel="noopener"
          class="setup-card__link ml-1"
          @click.stop
        >
          {{ service.hostServiceUrl }}
        </a>
      </div>
      <div v-else-if="service.port != null" class="text-body-2 text-medium-emphasis mt-1">
        <span class="font-weight-medium">Port:</span>
        <span class="ml-1">{{ service.port }}</span>
      </div>

      <div v-if="service.health" class="text-body-2 text-medium-emphasis mt-1">
        <span class="font-weight-medium">Health:</span>
        <span class="ml-1">{{ service.health }}</span>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.setup-card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  cursor: pointer;
}

.setup-card:focus-visible {
  outline: 2px solid var(--v-theme-primary);
  outline-offset: 4px;
}

.setup-card--selected {
  border: 2px solid rgba(var(--v-theme-primary), 0.4);
}

.setup-card--disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.setup-card__link {
  text-decoration: none;
}

.setup-card__link:hover {
  text-decoration: underline;
}
</style>
