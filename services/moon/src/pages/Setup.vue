<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import Header from '../components/Header.vue';
import SetupCard from '../components/SetupCard.vue';
import { buildServiceEndpointCandidates } from '../utils/serviceEndpoints.js';

const DEFAULT_INSTALL_ENDPOINT = '/api/services/install';
const ABSOLUTE_URL_REGEX = /^https?:\/\//i;

const state = reactive({
  loading: true,
  services: [],
  loadError: '',
});

const selectedServices = ref([]);
const installEndpoint = ref(DEFAULT_INSTALL_ENDPOINT);
const installing = ref(false);
const installError = ref('');
const installResults = ref(null);

const installableServices = computed(() =>
  state.services.filter((service) => service.installed !== true),
);

const groupedServices = computed(() => {
  return installableServices.value.reduce((groups, service) => {
    const category = service.category || 'other';
    if (!groups[category]) {
      groups[category] = [];
    }

    groups[category].push(service);
    return groups;
  }, {});
});

const sortedCategoryEntries = computed(() => {
  const entries = Object.entries(groupedServices.value).map(([category, services]) => {
    return [
      category,
      [...services].sort((a, b) => a.name.localeCompare(b.name)),
    ];
  });

  const order = ['core', 'addon'];
  entries.sort((a, b) => {
    const aIndex = order.indexOf(a[0]);
    const bIndex = order.indexOf(b[0]);

    if (aIndex === -1 && bIndex === -1) {
      return a[0].localeCompare(b[0]);
    }

    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  return entries;
});

const selectedSet = computed(() => new Set(selectedServices.value));
const hasSelection = computed(() => selectedServices.value.length > 0);
const selectedCount = computed(() => selectedServices.value.length);
const availableCount = computed(() => installableServices.value.length);

const categoryLabel = (category) => {
  if (category === 'core') return 'Core Services';
  if (category === 'addon') return 'Add-ons';
  return category.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const toggleService = (name) => {
  if (installing.value) return;

  const next = new Set(selectedServices.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }

  selectedServices.value = Array.from(next);
};

const SERVICE_ENDPOINTS = buildServiceEndpointCandidates();

const deriveInstallEndpoint = (servicesEndpoint) => {
  if (typeof servicesEndpoint !== 'string') {
    return DEFAULT_INSTALL_ENDPOINT;
  }

  const trimmed = servicesEndpoint.trim();
  if (!trimmed) {
    return DEFAULT_INSTALL_ENDPOINT;
  }

  const [withoutQuery] = trimmed.split('?');
  let sanitized = withoutQuery.replace(/\/+$/, '');

  if (!sanitized) {
    return DEFAULT_INSTALL_ENDPOINT;
  }

  sanitized = sanitized.replace('/setup/services', '/services');

  if (!sanitized.endsWith('/services')) {
    return DEFAULT_INSTALL_ENDPOINT;
  }

  if (!ABSOLUTE_URL_REGEX.test(sanitized) && !sanitized.startsWith('/')) {
    sanitized = `/${sanitized}`;
  }

  return `${sanitized}/install`;
};

const loadServicesFromEndpoint = async (endpoint) => {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`[${endpoint}] Request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const services = Array.isArray(payload.services) ? payload.services : [];
  services.sort((a, b) => a.name.localeCompare(b.name));
  return services;
};

const refreshServices = async () => {
  state.loading = true;
  state.loadError = '';
  installEndpoint.value = DEFAULT_INSTALL_ENDPOINT;

  const errors = [];

  try {
    for (const endpoint of SERVICE_ENDPOINTS) {
      try {
        const services = await loadServicesFromEndpoint(endpoint);
        state.services = services;
        installEndpoint.value = deriveInstallEndpoint(endpoint);
        const validSelections = new Set(
          services.filter((service) => service.installed !== true).map((service) => service.name),
        );
        selectedServices.value = selectedServices.value.filter((name) => validSelections.has(name));
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
      }
    }

    state.services = [];
    if (errors.length) {
      state.loadError = errors.join(' | ');
    } else {
      state.loadError = 'Unable to retrieve installable services.';
    }
  } finally {
    state.loading = false;
  }
};

const submitSelection = async () => {
  if (!hasSelection.value || installing.value) return;

  installing.value = true;
  installError.value = '';
  installResults.value = null;

  const services = [...selectedServices.value];

  try {
    const response = await fetch(installEndpoint.value || DEFAULT_INSTALL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ services }),
    });

    const payload = await response.json().catch(() => ({}));
    const results = Array.isArray(payload.results) ? payload.results : [];
    installResults.value = {
      status: response.status,
      results,
    };

    if (response.ok) {
      const successful = new Set(results.filter((item) => item.status === 'installed').map((item) => item.name));
      const remaining = services.filter((name) => !successful.has(name));
      selectedServices.value = remaining;
      await refreshServices();
    }
  } catch (error) {
    installError.value = error instanceof Error ? error.message : String(error);
  } finally {
    installing.value = false;
  }
};

onMounted(() => {
  void refreshServices();
});
</script>

<template>
  <Header>
    <v-container class="py-10">
      <v-row justify="center">
        <v-col cols="12" lg="10">
          <v-card variant="elevated" class="pa-6">
            <v-card-title class="text-h5 font-weight-bold pb-2">
              Moon Setup Wizard
            </v-card-title>
            <v-card-subtitle class="text-body-2 pb-4">
              Choose the services you want Warden to install and launch.
            </v-card-subtitle>

            <v-card-text>
              <div v-if="state.loading" class="d-flex justify-center py-10">
                <v-progress-circular color="primary" size="64" indeterminate />
              </div>

              <v-alert
                v-else-if="state.loadError"
                type="error"
                variant="tonal"
                class="mb-6"
                border="start"
              >
                Unable to load services: {{ state.loadError }}
                <template #append>
                  <v-btn color="error" variant="text" @click="refreshServices">
                    Retry
                  </v-btn>
                </template>
              </v-alert>

              <div v-else>
                <div class="d-flex justify-space-between align-center mb-4">
                  <div class="text-subtitle-1 font-weight-medium">
                    Available services ({{ availableCount }})
                  </div>
                  <v-btn
                    variant="text"
                    color="primary"
                    :loading="state.loading"
                    @click="refreshServices"
                  >
                    Refresh
                  </v-btn>
                </div>

                <v-alert
                  v-if="availableCount === 0"
                  type="info"
                  variant="tonal"
                  border="start"
                  class="mb-6"
                >
                  <template v-if="state.services.length">
                    All registered services have already been installed.
                  </template>
                  <template v-else>
                    No services are available for installation yet.
                  </template>
                </v-alert>

                <div v-else>
                  <div
                    v-for="([category, services], index) in sortedCategoryEntries"
                    :key="category"
                    :class="index > 0 ? 'mt-8' : ''"
                  >
                    <div class="d-flex align-center mb-3">
                      <v-chip color="primary" variant="tonal" class="text-uppercase font-weight-bold">
                        {{ categoryLabel(category) }}
                      </v-chip>
                      <span class="text-body-2 text-medium-emphasis ml-3">
                        {{ services.length }} service{{ services.length === 1 ? '' : 's' }}
                      </span>
                    </div>

                    <v-row>
                      <v-col
                        v-for="service in services"
                        :key="service.name"
                        cols="12"
                        md="6"
                        class="d-flex"
                      >
                        <SetupCard
                          :service="service"
                          :selected="selectedSet.has(service.name)"
                          :disabled="installing"
                          class="flex-grow-1"
                          @toggle="toggleService"
                        />
                      </v-col>
                    </v-row>
                  </div>
                </div>
              </div>
            </v-card-text>

            <v-divider class="my-4" />

            <v-card-actions class="flex-column flex-sm-row justify-space-between align-stretch gap-4">
              <div class="flex-grow-1">
                <v-alert
                  v-if="installError"
                  type="error"
                  variant="tonal"
                  border="start"
                  class="mb-2"
                >
                  Failed to submit install request: {{ installError }}
                </v-alert>

                <v-alert
                  v-else-if="installResults"
                  :type="installResults.status === 200 ? 'success' : 'warning'"
                  variant="tonal"
                  border="start"
                  class="mb-2"
                >
                  <div class="font-weight-medium mb-2">
                    Installation summary (status {{ installResults.status }}):
                  </div>
                  <ul class="pl-4 mb-0">
                    <li
                      v-for="result in installResults.results"
                      :key="result.name"
                      class="text-body-2"
                    >
                      <span class="font-weight-medium">{{ result.name }}</span>
                      —
                      <span
                        :class="result.status === 'installed' ? 'text-success' : 'text-warning'"
                      >
                        {{ result.status }}
                      </span>
                      <span v-if="result.error" class="text-medium-emphasis">
                        : {{ result.error }}
                      </span>
                      <span v-else-if="result.hostServiceUrl" class="text-medium-emphasis">
                        ({{ result.hostServiceUrl }})
                      </span>
                    </li>
                  </ul>
                </v-alert>
              </div>

              <v-btn
                color="primary"
                size="large"
                class="align-self-stretch"
                :disabled="!hasSelection || installing"
                @click="submitSelection"
              >
                <template v-if="installing">
                  <v-progress-circular size="22" width="3" color="white" indeterminate class="mr-3" />
                  Installing...
                </template>
                <template v-else>
                  Install Selected
                  <span class="ml-2 font-weight-bold">({{ selectedCount }})</span>
                </template>
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </Header>
</template>
