<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import Header from '../components/Header.vue';
import SetupListItem from '../components/SetupListItem.vue';
import { buildServiceEndpointCandidates } from '../utils/serviceEndpoints.js';
import { isServiceRequired, mergeRequiredSelections } from '../utils/serviceSelection.js';

const DEFAULT_INSTALL_ENDPOINT = '/api/services/install';
const ABSOLUTE_URL_REGEX = /^https?:\/\//i;
const ALLOWED_SERVICE_NAMES = new Set([
  'noona-portal',
  'noona-vault',
  'noona-raven',
  'noona-redis',
  'noona-mongo',
]);

const state = reactive({
  loading: true,
  services: [],
  loadError: '',
});

const envForms = reactive({});
const selectedServices = ref([]);
const installEndpoint = ref(DEFAULT_INSTALL_ENDPOINT);
const installing = ref(false);
const installError = ref('');
const installResults = ref(null);

const installableServices = computed(() =>
  state.services.filter((service) => service.installed !== true),
);

const groupedServices = computed(() => {
  return state.services.reduce((groups, service) => {
    if (!service || typeof service.name !== 'string') {
      return groups;
    }

    const category = service.category || 'other';
    if (!groups[category]) {
      groups[category] = { services: [], installableCount: 0 };
    }

    groups[category].services.push(service);
    if (service.installed !== true) {
      groups[category].installableCount += 1;
    }

    return groups;
  }, {});
});

const sortedCategoryEntries = computed(() => {
  const entries = Object.entries(groupedServices.value).map(
    ([category, { services, installableCount }]) => {
      const sortedServices = [...services].sort((a, b) =>
        a.name.localeCompare(b.name),
      );

      return {
        category,
        services: sortedServices,
        installableCount,
        totalCount: sortedServices.length,
      };
    },
  );

  const order = ['core', 'addon'];
  entries.sort((a, b) => {
    const aIndex = order.indexOf(a.category);
    const bIndex = order.indexOf(b.category);

    if (aIndex === -1 && bIndex === -1) {
      return a.category.localeCompare(b.category);
    }

    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  return entries;
});

const installableNameSet = computed(
  () => new Set(installableServices.value.map((service) => service.name)),
);

const normalizedSelection = computed(() =>
  selectedServices.value.filter((name) => installableNameSet.value.has(name)),
);

const selectedSet = computed(() => new Set(normalizedSelection.value));
const hasSelection = computed(() => normalizedSelection.value.length > 0);
const selectedCount = computed(() => normalizedSelection.value.length);
const availableCount = computed(() => installableServices.value.length);
const totalCount = computed(() => state.services.length);

const serviceMap = computed(() => {
  const map = new Map();
  for (const service of state.services) {
    if (service?.name) {
      map.set(service.name, service);
    }
  }
  return map;
});

const selectedServiceDetails = computed(() =>
  normalizedSelection.value
    .map((name) => serviceMap.value.get(name))
    .filter(Boolean),
);

const categoryLabel = (category) => {
  if (category === 'core') return 'Core Services';
  if (category === 'addon') return 'Add-ons';
  return category.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

const toggleService = (name) => {
  if (installing.value) return;

  const service = serviceMap.value.get(name);
  if (!service || service.installed === true || isServiceRequired(service)) {
    return;
  }

  const next = new Set(normalizedSelection.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }

  selectedServices.value = Array.from(next);
};

const ensureEnvForm = (service) => {
  if (!service || typeof service.name !== 'string') {
    return;
  }

  const existing = envForms[service.name];
  const config = Array.isArray(service.envConfig) ? service.envConfig : [];

  if (!existing) {
    const defaults = {};
    for (const field of config) {
      if (!field || typeof field.key !== 'string') {
        continue;
      }

      const key = field.key;
      defaults[key] = field.defaultValue != null ? String(field.defaultValue) : '';
    }

    envForms[service.name] = defaults;
    return;
  }

  for (const field of config) {
    if (!field || typeof field.key !== 'string') {
      continue;
    }

    const key = field.key;
    if (!(key in existing)) {
      existing[key] = field.defaultValue != null ? String(field.defaultValue) : '';
    }
  }
};

const syncEnvForms = (services) => {
  const validNames = new Set();

  for (const service of services) {
    if (!service || typeof service.name !== 'string') {
      continue;
    }

    validNames.add(service.name);
    ensureEnvForm(service);
  }

  for (const name of Object.keys(envForms)) {
    if (!validNames.has(name)) {
      delete envForms[name];
    }
  }
};

const buildEnvPayload = (service) => {
  if (!service || typeof service.name !== 'string') {
    return {};
  }

  const config = Array.isArray(service.envConfig) ? service.envConfig : [];
  if (!config.length) {
    return {};
  }

  const values = envForms[service.name] || {};
  const payload = {};

  for (const field of config) {
    if (!field || typeof field.key !== 'string') {
      continue;
    }

    const key = field.key;
    const rawValue = values[key];
    payload[key] = rawValue != null ? String(rawValue) : '';
  }

  return payload;
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
  const sanitized = withoutQuery.replace(/\/+$/, '');

  if (!sanitized) {
    return DEFAULT_INSTALL_ENDPOINT;
  }

  const setupSuffix = '/setup/services';
  const servicesSuffix = '/services';

  const ensureLeadingSlash = (value) =>
    value.startsWith('/') ? value : `/${value}`;

  let comparable = sanitized;
  if (!ABSOLUTE_URL_REGEX.test(comparable)) {
    comparable = ensureLeadingSlash(comparable);
  }

  let target;

  if (comparable.endsWith(setupSuffix)) {
    target = `${comparable.slice(0, -setupSuffix.length)}/setup/install`;
  } else if (comparable.endsWith(servicesSuffix)) {
    target = `${comparable}/install`;
  } else {
    return DEFAULT_INSTALL_ENDPOINT;
  }

  if (ABSOLUTE_URL_REGEX.test(comparable)) {
    return target;
  }

  return ensureLeadingSlash(target);
};

const loadServicesFromEndpoint = async (endpoint) => {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`[${endpoint}] Request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const services = Array.isArray(payload.services) ? payload.services : [];
  const filtered = services.filter(
    (service) =>
      service &&
      typeof service.name === 'string' &&
      ALLOWED_SERVICE_NAMES.has(service.name),
  );
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  return filtered;
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
        syncEnvForms(services);
        installEndpoint.value = deriveInstallEndpoint(endpoint);
        selectedServices.value = mergeRequiredSelections(
          services,
          normalizedSelection.value,
        );
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
      }
    }

    state.services = [];
    syncEnvForms([]);
    selectedServices.value = [];
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

  const descriptors = selectedServiceDetails.value;
  const servicePayload = descriptors.map((service) => {
    const env = buildEnvPayload(service);
    if (!Object.keys(env).length) {
      return { name: service.name };
    }

    return { name: service.name, env };
  });
  const requestedNames = servicePayload.map((item) => item.name);

  try {
    const response = await fetch(installEndpoint.value || DEFAULT_INSTALL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ services: servicePayload }),
    });

    const responsePayload = await response.json().catch(() => ({}));
    const results = Array.isArray(responsePayload.results) ? responsePayload.results : [];
    installResults.value = {
      status: response.status,
      results,
    };

    if (response.ok) {
      const successful = new Set(results.filter((item) => item.status === 'installed').map((item) => item.name));
      const remaining = requestedNames.filter((name) => !successful.has(name));
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
              <div v-if="state.loading" class="setup-loading py-10">
                <v-progress-linear
                  color="primary"
                  height="6"
                  indeterminate
                  aria-label="Downloading services"
                />
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
                  <div class="text-subtitle-1 font-weight-medium d-flex flex-column flex-sm-row">
                    <span>Registered services: {{ totalCount }}</span>
                    <span class="registered-services__installable text-body-2 text-medium-emphasis">
                      {{ availableCount }} installable
                    </span>
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
                  <template v-if="totalCount">
                    All {{ totalCount }} registered services have already been installed.
                  </template>
                  <template v-else>
                    No services are available for installation yet.
                  </template>
                </v-alert>

                <div v-else>
                  <div
                    v-for="(entry, index) in sortedCategoryEntries"
                    :key="entry.category"
                    :class="index > 0 ? 'mt-8' : ''"
                    class="setup-category"
                  >
                    <div class="setup-category__header">
                      <v-chip color="primary" variant="tonal" class="text-uppercase font-weight-bold">
                        {{ categoryLabel(entry.category) }}
                      </v-chip>
                      <span class="text-body-2 text-medium-emphasis ml-3">
                        {{ entry.installableCount }} installable ·
                        {{ entry.totalCount }} total
                      </span>
                    </div>

                    <v-list class="setup-list" density="comfortable" lines="three">
                      <template
                        v-for="(service, serviceIndex) in entry.services"
                        :key="service.name"
                      >
                        <SetupListItem
                          :service="service"
                          :selected="selectedSet.has(service.name)"
                          :disabled="installing"
                          :installed="service.installed === true"
                          @toggle="toggleService"
                        />
                        <v-divider
                          v-if="serviceIndex < entry.services.length - 1"
                          class="setup-list__divider"
                        />
                      </template>
                    </v-list>
                  </div>
                </div>
                <v-expand-transition>
                  <div v-if="hasSelection" class="mt-8">
                    <v-alert
                      type="warning"
                      variant="tonal"
                      border="start"
                      class="mb-4"
                    >
                      Change environment values only if you know exactly how the service should be configured.
                    </v-alert>

                    <div
                      v-for="service in selectedServiceDetails"
                      :key="service.name"
                      class="mb-6"
                    >
                      <v-card variant="tonal" color="primary" class="pa-4">
                        <div class="text-subtitle-1 font-weight-medium mb-2">
                          {{ service.name }} environment
                        </div>
                        <div
                          v-if="!service.envConfig || service.envConfig.length === 0"
                          class="text-body-2 text-medium-emphasis"
                        >
                          This service does not expose configurable environment variables.
                        </div>
                        <v-row v-else dense class="mt-1">
                          <v-col
                            v-for="field in service.envConfig"
                            :key="field.key"
                            cols="12"
                            md="6"
                          >
                            <v-text-field
                              v-model="envForms[service.name][field.key]"
                              :label="field.readOnly ? `${field.label || field.key} (read only)` : field.label || field.key"
                              :hint="field.description || field.warning || ''"
                              :persistent-hint="Boolean(field.description || field.warning)"
                              :readonly="field.readOnly"
                              :disabled="installing"
                              density="comfortable"
                              variant="outlined"
                              color="primary"
                            >
                              <template #append-inner v-if="field.readOnly">
                                <v-icon icon="mdi-lock-outline" />
                              </template>
                            </v-text-field>
                          </v-col>
                        </v-row>
                      </v-card>
                    </div>
                  </div>
                </v-expand-transition>
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

<style scoped>
.setup-category__header {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.registered-services__installable {
  margin-top: 4px;
}

.setup-list {
  background: transparent;
  padding: 0;
}

.setup-list__divider {
  margin: 4px 0;
}

.setup-loading {
  width: 100%;
}

@media (max-width: 600px) {
  .setup-category__header {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
}

@media (min-width: 600px) {
  .registered-services__installable {
    margin-top: 0;
    margin-left: 16px;
  }
}
</style>
