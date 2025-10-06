<script setup>
import { computed, getCurrentInstance, onMounted, reactive, ref, watch } from 'vue';
import Header from '../components/Header.vue';
import { buildServiceEndpointCandidates } from '../utils/serviceEndpoints.js';
import { isServiceRequired, mergeRequiredSelections } from '../utils/serviceSelection.js';
import {
  createPortalDiscordChannel,
  createPortalDiscordRole,
  validatePortalDiscordConfig,
} from '../utils/portalDiscordSetup.js';
import { normalizeServiceList, resolveServiceInstalled } from '../utils/serviceStatus.js';

const DEFAULT_SERVICES_ENDPOINT = '/api/setup/services';
const DEFAULT_INSTALL_ENDPOINT = '/api/setup/install';
const DEFAULT_INSTALL_PROGRESS_ENDPOINT = '/api/setup/services/install/progress';
const DEFAULT_INSTALL_LOGS_ENDPOINT = '/api/setup/services/installation/logs';
const INSTALL_LOG_DISPLAY_COUNT = 3;
const DEFAULT_INSTALL_LOG_LIMIT = INSTALL_LOG_DISPLAY_COUNT;
const DEFAULT_PORTAL_TEST_ENDPOINT = '/api/setup/services/noona-portal/test';
const PORTAL_HEALTH_ENDPOINT_CANDIDATES = [
  'http://localhost:3002/health',
  'http://127.0.0.1:3002/health',
  'http://host.docker.internal:3002/health',
];
const PORTAL_HEALTH_CHECK_TIMEOUT_MS = 5000;
const RAVEN_DETECT_ENDPOINT = '/api/setup/services/noona-raven/detect';
const RAVEN_LIBRARY_ENDPOINT = '/api/raven/library';
const RAVEN_SERVICE_NAME = 'noona-raven';
const RAVEN_PHASE_DEFINITIONS = [
  {
    key: 'dependencies',
    label: 'Validate dependencies',
    description: 'Portal and Vault must be running before Raven can launch.',
  },
  {
    key: 'installation',
    label: 'Install Raven',
    description: 'Sage coordinates with Warden to start Raven when needed.',
  },
  {
    key: 'verification',
    label: 'Verify with Sage',
    description: 'Sage checks Raven connectivity and Kavita mount detection.',
  },
];
const ABSOLUTE_URL_REGEX = /^https?:\/\//i;
const ALLOWED_SERVICE_NAMES = new Set([
  'noona-portal',
  'noona-vault',
  'noona-raven',
  'noona-redis',
  'noona-mongo',
]);

const STEP_DEFINITIONS = [
  {
    key: 'dependencies',
    label: 'Install dependencies',
    summary: 'Redis and Mongo must be ready before continuing.',
    services: ['noona-redis', 'noona-mongo'],
  },
  {
    key: 'portal',
    label: 'Configure Portal & Vault',
    summary: 'Install Portal, unlock Vault, and validate the bot connection.',
    services: ['noona-portal', 'noona-vault'],
    actionKey: 'portalTest',
  },
  {
    key: 'raven',
    label: 'Launch Raven',
    summary: 'Finish setup by enabling Raven insights.',
    services: ['noona-raven'],
    actionKey: 'ravenHandshake',
  },
];

const STEP_INFO_SECTIONS = {
  dependencies: [
    {
      title: 'Redis & MongoDB',
      description:
        'Redis keeps installation tasks responsive while MongoDB stores persistent configuration for the rest of the stack.',
    },
    {
      title: 'Order matters',
      description:
        'Install these services before Portal and Vault so authentication and caching are available when the Discord bot comes online.',
    },
  ],
  portal: [
    {
      title: 'Portal + Vault pairing',
      description:
        'Installing this step automatically starts the Portal bot and verifies the Discord handshake. If everything is already installed, click Install Step to run the verification again.',
    },
    {
      title: 'Re-run verification',
      description:
        'Click Install Step at any time to restart the Portal services and trigger the Discord handshake if you need to re-verify access.',
    },
  ],
  raven: [
    {
      title: 'Raven handshake',
      description: 'Trigger the Raven handshake to complete installation.',
    },
    {
      title: 'Why Raven waits',
      description:
        'Raven depends on Portal and Vault. Launch it last to stream library insights after authentication is configured.',
    },
    {
      title: 'Kavita detection',
      description:
        'If automatic mount discovery fails, provide manual overrides in the Raven environment form before retrying the handshake.',
    },
  ],
};

const SERVICE_DEPENDENCIES = {
  'noona-portal': ['noona-redis', 'noona-mongo'],
  'noona-vault': ['noona-redis', 'noona-mongo'],
  'noona-raven': ['noona-portal'],
};

const ALWAYS_SELECTED_SERVICES = new Set(['noona-redis', 'noona-mongo']);
const PORTAL_SERVICE_NAME = 'noona-portal';
const PORTAL_DISCORD_TOKEN_KEY = 'DISCORD_BOT_TOKEN';
const PORTAL_DISCORD_GUILD_KEY = 'DISCORD_GUILD_ID';
const PORTAL_ROLE_SUFFIX = '_ROLE_ID';
const PORTAL_CHANNEL_SUFFIX = '_CHANNEL_ID';
const PORTAL_REQUIRED_ROLE_PREFIX = 'REQUIRED_ROLE_';
const DEFAULT_PORTAL_DISCORD_ENDPOINT_BASE =
  '/api/setup/services/noona-portal/discord';
const PORTAL_SERVICE_POLL_INTERVAL_MS = 2000;
const PORTAL_SERVICE_POLL_TIMEOUT_MS = 30000;
const RAVEN_SERVICE_POLL_INTERVAL_MS = 2000;
const RAVEN_SERVICE_POLL_TIMEOUT_MS = 120000;
const PORTAL_SERVICE_TIMEOUT_MESSAGE =
  'Portal services did not become ready in time. Please try again.';
const PORTAL_CREDENTIAL_KEYS = new Set([
  PORTAL_DISCORD_TOKEN_KEY,
  PORTAL_DISCORD_GUILD_KEY,
]);

const isServiceInstalled = (service) => resolveServiceInstalled(service);

const sanitizePortalRole = (role) => {
  if (!role || !role.id) {
    return null;
  }

  const name = typeof role.name === 'string' ? role.name : '';
  return {
    id: String(role.id),
    name,
    position: typeof role.position === 'number' ? role.position : null,
    managed: Boolean(role.managed),
  };
};

const sanitizePortalChannel = (channel) => {
  if (!channel || !channel.id) {
    return null;
  }

  return {
    id: String(channel.id),
    name: typeof channel.name === 'string' ? channel.name : '',
    type: channel.type ?? null,
  };
};

const sanitizePortalGuild = (guild) => {
  if (!guild) {
    return null;
  }

  return {
    id: guild.id ? String(guild.id) : null,
    name: typeof guild.name === 'string' ? guild.name : '',
    description: typeof guild.description === 'string' ? guild.description : '',
    icon: guild.icon ?? null,
  };
};

const sortPortalRoles = (a, b) => {
  const positionA = typeof a?.position === 'number' ? a.position : 0;
  const positionB = typeof b?.position === 'number' ? b.position : 0;
  if (positionA === positionB) {
    return (a?.name || '').localeCompare(b?.name || '');
  }

  return positionB - positionA;
};

const sortPortalChannels = (a, b) => (a?.name || '').localeCompare(b?.name || '');

const normalizePortalRoles = (roles) => {
  if (!Array.isArray(roles)) {
    return [];
  }

  return roles
    .map(sanitizePortalRole)
    .filter(Boolean)
    .sort(sortPortalRoles);
};

const normalizePortalChannels = (channels) => {
  if (!Array.isArray(channels)) {
    return [];
  }

  return channels
    .map(sanitizePortalChannel)
    .filter(Boolean)
    .sort(sortPortalChannels);
};

const mergePortalResource = (collection, entry, sortFn) => {
  if (!entry || !entry.id) {
    return collection.slice();
  }

  const filtered = collection.filter((item) => item?.id !== entry.id);
  filtered.push(entry);
  if (typeof sortFn === 'function') {
    filtered.sort(sortFn);
  }

  return filtered;
};

const BOOLEAN_OPTIONS = [
  { title: 'True', value: 'true' },
  { title: 'False', value: 'false' },
];

const state = reactive({
  loading: true,
  services: [],
  loadError: '',
  progress: {
    items: [],
    percent: null,
    status: '',
    error: '',
    logError: '',
  },
});

const portalHealthFallbackState = reactive({
  checking: false,
  installed: false,
  lastError: '',
  lastEndpoint: '',
  lastCheckedAt: 0,
});

let portalHealthCheckToken = 0;

const envForms = reactive({});
const selectedServices = ref([]);
const expandedCards = ref([]);
const installEndpoint = ref(DEFAULT_INSTALL_ENDPOINT);
const installProgressEndpoint = ref(DEFAULT_INSTALL_PROGRESS_ENDPOINT);
const installLogsEndpoint = ref(DEFAULT_INSTALL_LOGS_ENDPOINT);
const activeServicesEndpoint = ref(DEFAULT_SERVICES_ENDPOINT);
const installing = ref(false);
const installError = ref('');
const installResults = ref(null);
const installSuccessMessageVisible = ref(false);
const installLogLimit = ref(DEFAULT_INSTALL_LOG_LIMIT);
const installLogs = ref('');
const showProgressDetails = ref(false);
const showStepInfo = ref(false);
const progressLogsLoading = ref(false);
const activeStepIndex = ref(0);
const wizardComplete = ref(false);
const wizardCompletionTimestamp = ref(0);

const portalDiscordEndpointBase = computed(() => {
  const endpoint = activeServicesEndpoint.value;
  if (typeof endpoint !== 'string') {
    return DEFAULT_PORTAL_DISCORD_ENDPOINT_BASE;
  }

  const trimmed = endpoint.trim();
  if (!trimmed) {
    return DEFAULT_PORTAL_DISCORD_ENDPOINT_BASE;
  }

  const [withoutQuery] = trimmed.split('?');
  const sanitized = withoutQuery.replace(/\/+$/, '');

  if (!sanitized.endsWith('/setup/services')) {
    return DEFAULT_PORTAL_DISCORD_ENDPOINT_BASE;
  }

  return `${sanitized}/noona-portal/discord`;
});

const portalTestEndpoint = computed(() =>
  deriveServiceTestEndpoint(activeServicesEndpoint.value, PORTAL_SERVICE_NAME),
);

const portalAction = reactive({
  loading: false,
  success: false,
  error: '',
  completed: false,
});

const PORTAL_STEP_SERVICE_NAMES = new Set(
  STEP_DEFINITIONS.find((step) => step.key === 'portal')?.services ?? [],
);

const resetPortalActionState = () => {
  portalAction.loading = false;
  portalAction.success = false;
  portalAction.error = '';
  portalAction.completed = false;
};

const PORTAL_INSTALL_FAILURE_KEYWORDS = [
  'fail',
  'error',
  'timeout',
  'timed out',
  'timed-out',
  'unable',
  'invalid',
  'missing',
  'denied',
  'rejected',
  'unhealthy',
];

const getPortalInstallFailureMessage = () => {
  const installMessage =
    typeof installError.value === 'string' && installError.value.trim()
      ? installError.value.trim()
      : '';
  if (installMessage) {
    return installMessage;
  }

  const results = installResults.value?.results;
  if (!Array.isArray(results)) {
    return '';
  }

  for (const entry of results) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    if (!PORTAL_STEP_SERVICE_NAMES.has(name)) {
      continue;
    }

    const resultError =
      typeof entry?.error === 'string' && entry.error.trim() ? entry.error.trim() : '';
    if (resultError) {
      return resultError;
    }

    const status =
      typeof entry?.status === 'string' && entry.status.trim()
        ? entry.status.trim()
        : '';
    if (status) {
      const normalizedStatus = status.toLowerCase();
      const hasFailureKeyword = PORTAL_INSTALL_FAILURE_KEYWORDS.some((keyword) =>
        normalizedStatus.includes(keyword),
      );
      if (hasFailureKeyword) {
        return `${name} installation ${status}`;
      }
    }
  }

  return '';
};

const verifyPortalBot = async () => {
  portalAction.loading = true;
  portalAction.success = false;
  portalAction.completed = false;
  portalAction.error = '';

  try {
    const response = await fetch(portalTestEndpoint.value, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error || `Portal test failed with status ${response.status}`);
    }

    if (payload?.success !== true) {
      throw new Error(payload?.error || 'Portal test did not succeed.');
    }

    portalAction.success = true;
    portalAction.completed = true;
  } catch (error) {
    portalAction.success = false;
    portalAction.completed = false;
    portalAction.error = error instanceof Error ? error.message : String(error);
  } finally {
    portalAction.loading = false;
  }
};

const portalDiscordState = reactive({
  verifying: false,
  verified: false,
  error: '',
  guild: null,
  roles: [],
  channels: [],
  lastVerifiedToken: '',
  lastVerifiedGuildId: '',
  createRole: {
    name: '',
    loading: false,
    error: '',
  },
  createChannel: {
    name: '',
    type: 'GUILD_TEXT',
    loading: false,
    error: '',
  },
});

const ravenAction = reactive({
  loading: false,
  success: false,
  error: '',
  completed: false,
  message: '',
});

const ravenPhaseState = reactive(
  Object.fromEntries(
    RAVEN_PHASE_DEFINITIONS.map((phase) => [phase.key, { state: 'idle', message: '' }]),
  ),
);

const resetRavenPhaseState = () => {
  for (const phase of RAVEN_PHASE_DEFINITIONS) {
    const entry = ravenPhaseState[phase.key];
    if (entry) {
      entry.state = 'idle';
      entry.message = '';
    }
  }
};

const setRavenPhaseState = (key, state, message = '') => {
  if (!Object.prototype.hasOwnProperty.call(ravenPhaseState, key)) {
    return;
  }

  ravenPhaseState[key].state = state;
  ravenPhaseState[key].message = message;
};

let progressPollHandle = null;
let logsRequestActive = false;
let pendingLogsRequestOptions = null;

const installLogsRequestUrl = computed(() => {
  const base = installLogsEndpoint.value || DEFAULT_INSTALL_LOGS_ENDPOINT;
  return `${base}?limit=${installLogLimit.value}`;
});

const serviceMap = computed(() => {
  const map = new Map();
  for (const service of state.services) {
    if (service?.name) {
      map.set(service.name, service);
    }
  }
  return map;
});

const portalService = computed(() => serviceMap.value.get(PORTAL_SERVICE_NAME));

const portalServiceInstalled = computed(() => {
  const service = portalService.value;
  return service ? isServiceInstalled(service) : false;
});

const installableServices = computed(() =>
  state.services.filter((service) => !isServiceInstalled(service)),
);

const installableNameSet = computed(
  () => new Set(installableServices.value.map((service) => service.name)),
);

const normalizedSelection = computed(() =>
  selectedServices.value.filter((name) => installableNameSet.value.has(name)),
);

const selectedSet = computed(() => new Set(normalizedSelection.value));

const portalDetectedViaFallback = computed(
  () => portalHealthFallbackState.installed && !portalServiceInstalled.value,
);

const installedSet = computed(() => {
  const installed = new Set();
  for (const service of state.services) {
    if (service?.name && isServiceInstalled(service)) {
      installed.add(service.name);
    }
  }

  if (portalDetectedViaFallback.value) {
    installed.add(PORTAL_SERVICE_NAME);
  }

  return installed;
});

const currentStep = computed(() => STEP_DEFINITIONS[activeStepIndex.value]);

const portalEnvForm = computed(
  () => envForms[PORTAL_SERVICE_NAME] ?? {},
);

const hasPortalService = computed(() => Boolean(portalService.value));

const serviceStatusSignature = computed(() =>
  state.services
    .map((service) => {
      const name = service?.name ?? '';
      const installed = isServiceInstalled(service) ? '1' : '0';
      return `${name}:${installed}`;
    })
    .join('|'),
);

const shouldCheckPortalFallback = computed(
  () => !state.loading && !portalServiceInstalled.value,
);

const resetPortalFallbackState = () => {
  portalHealthCheckToken += 1;
  portalHealthFallbackState.checking = false;
  portalHealthFallbackState.installed = false;
  portalHealthFallbackState.lastError = '';
  portalHealthFallbackState.lastEndpoint = '';
  portalHealthFallbackState.lastCheckedAt = 0;
};

const runPortalHealthRequest = async (endpoint, mode = 'cors') => {
  const controller =
    typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutHandle = null;

  try {
    if (controller) {
      timeoutHandle = setTimeout(
        () => controller.abort(),
        PORTAL_HEALTH_CHECK_TIMEOUT_MS,
      );
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      mode,
      signal: controller?.signal ?? undefined,
    });

    return response;
  } finally {
    if (timeoutHandle != null) {
      clearTimeout(timeoutHandle);
    }
  }
};

const checkPortalHealthFallback = async () => {
  if (!shouldCheckPortalFallback.value) {
    resetPortalFallbackState();
    return false;
  }

  if (portalHealthFallbackState.checking) {
    return portalHealthFallbackState.installed;
  }

  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    resetPortalFallbackState();
    return false;
  }

  const token = ++portalHealthCheckToken;
  portalHealthFallbackState.checking = true;
  portalHealthFallbackState.lastError = '';
  portalHealthFallbackState.lastEndpoint = '';

  let detected = false;
  let lastError = '';

  for (const endpoint of PORTAL_HEALTH_ENDPOINT_CANDIDATES) {
    for (const mode of ['cors', 'no-cors']) {
      try {
        const response = await runPortalHealthRequest(endpoint, mode);

        if (token !== portalHealthCheckToken) {
          return portalHealthFallbackState.installed;
        }

        portalHealthFallbackState.lastEndpoint = endpoint;

        const healthy = response.ok || response.type === 'opaque';
        if (healthy) {
          detected = true;
          break;
        }

        lastError =
          response.type === 'opaque'
            ? 'Received opaque response.'
            : `HTTP ${response.status}`;
      } catch (error) {
        if (token !== portalHealthCheckToken) {
          return portalHealthFallbackState.installed;
        }

        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    if (detected) {
      break;
    }
  }

  if (token !== portalHealthCheckToken) {
    return portalHealthFallbackState.installed;
  }

  portalHealthFallbackState.installed = detected;
  portalHealthFallbackState.lastError = detected ? '' : lastError;
  portalHealthFallbackState.checking = false;
  portalHealthFallbackState.lastCheckedAt = Date.now();

  return portalHealthFallbackState.installed;
};

watch(
  [shouldCheckPortalFallback, serviceStatusSignature],
  ([shouldCheck]) => {
    if (shouldCheck) {
      void checkPortalHealthFallback();
    } else {
      resetPortalFallbackState();
    }
  },
  { immediate: true },
);

const getServiceLabel = (name) => {
  const service = serviceMap.value.get(name);
  if (service?.displayName) {
    return service.displayName;
  }
  if (service?.name) {
    return service.name;
  }
  return name;
};

const ravenService = computed(() => serviceMap.value.get(RAVEN_SERVICE_NAME));

const ravenDisplayName = computed(() => getServiceLabel(RAVEN_SERVICE_NAME) || 'Raven');

const ravenDependencies = computed(() => {
  const dependencies = SERVICE_DEPENDENCIES[RAVEN_SERVICE_NAME] ?? [];
  return dependencies.map((dependency) => {
    const detectedViaFallback =
      dependency === PORTAL_SERVICE_NAME && portalDetectedViaFallback.value;

    return {
      name: dependency,
      label: getServiceLabel(dependency),
      installed: installedSet.value.has(dependency),
      detectedViaFallback,
    };
  });
});

const ravenMissingDependencies = computed(() =>
  ravenDependencies.value.filter((dependency) => !dependency.installed),
);

const ravenMissingDependencyLabels = computed(() =>
  ravenMissingDependencies.value.map((dependency) => dependency.label),
);

const ravenDependenciesReady = computed(() => ravenMissingDependencies.value.length === 0);

const isRavenInstalled = computed(() => {
  const service = ravenService.value;
  return service ? isServiceInstalled(service) : false;
});

const ravenPhaseEntries = computed(() =>
  RAVEN_PHASE_DEFINITIONS.map((phase) => {
    const stateEntry = ravenPhaseState[phase.key] ?? { state: 'idle', message: '' };
    let message = stateEntry.message || phase.description;

    if (phase.key === 'dependencies' && (!stateEntry.message || stateEntry.state === 'idle')) {
      message = ravenDependenciesReady.value
        ? 'Portal and Vault are ready for Raven.'
        : `Install ${ravenMissingDependencyLabels.value.join(' & ') || 'required services'} before running the handshake.`;
    }

    if (phase.key === 'installation' && (!stateEntry.message || stateEntry.state === 'idle')) {
      message = isRavenInstalled.value
        ? `${ravenDisplayName.value} is already installed.`
        : `${ravenDisplayName.value} will be installed when you run the handshake.`;
    }

    if (phase.key === 'verification' && (!stateEntry.message || stateEntry.state === 'idle')) {
      message = 'Sage will verify Raven connectivity and Kavita detection.';
    }

    return {
      key: phase.key,
      label: phase.label,
      state: stateEntry.state || 'idle',
      message,
    };
  }),
);

const ravenActionButtonLabel = computed(() => {
  if (ravenAction.success) {
    return 'Re-run Raven handshake';
  }
  return isRavenInstalled.value ? 'Verify Raven with Sage' : 'Install Raven with Sage';
});

const portalDiscordReady = computed(() => portalDiscordState.verified);

const canValidatePortalDiscord = computed(() => {
  if (portalDiscordState.verifying) {
    return false;
  }

  const token = portalEnvForm.value[PORTAL_DISCORD_TOKEN_KEY];
  const guildId = portalEnvForm.value[PORTAL_DISCORD_GUILD_KEY];
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  const normalizedGuildId = typeof guildId === 'string' ? guildId.trim() : '';

  return Boolean(normalizedToken && normalizedGuildId);
});

const portalRoleOptions = computed(() =>
  portalDiscordState.roles.map((role) => ({
    title: role.name || role.id,
    subtitle: role.id,
    value: role.id,
  })),
);

const portalChannelOptions = computed(() =>
  portalDiscordState.channels.map((channel) => ({
    title: channel.name || channel.id,
    subtitle: channel.type ? `${channel.name || channel.id} (${channel.type})` : channel.name || channel.id,
    value: channel.id,
  })),
);

const getStepServices = (stepKey) => {
  const definition = STEP_DEFINITIONS.find((step) => step.key === stepKey);
  if (!definition) return [];
  return definition.services
    .map((name) => serviceMap.value.get(name))
    .filter(Boolean);
};

const hasPortalStepServices = computed(() => getStepServices('portal').length > 0);

const arePortalStepServicesInstalled = () => {
  const services = getStepServices('portal');
  if (!services.length) {
    return true;
  }

  return services.every((service) => isServiceInstalled(service));
};

const sleep = (duration) =>
  new Promise((resolve) => {
    setTimeout(resolve, duration);
  });

const waitForPortalServicesInstalled = async (options = {}) => {
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : PORTAL_SERVICE_POLL_TIMEOUT_MS;
  const intervalMs =
    typeof options.intervalMs === 'number' && options.intervalMs > 0
      ? options.intervalMs
      : PORTAL_SERVICE_POLL_INTERVAL_MS;

  if (arePortalStepServicesInstalled()) {
    return true;
  }

  if (timeoutMs <= 0) {
    return arePortalStepServicesInstalled();
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await refreshServices({ keepUi: true, skipPortalReset: true, silent: true });
    if (arePortalStepServicesInstalled()) {
      return true;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    await sleep(Math.min(intervalMs, remaining));
  }

  return arePortalStepServicesInstalled();
};

const waitForServiceInstalled = async (serviceName, options = {}) => {
  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : RAVEN_SERVICE_POLL_TIMEOUT_MS;
  const intervalMs =
    typeof options.intervalMs === 'number' && options.intervalMs > 0
      ? options.intervalMs
      : RAVEN_SERVICE_POLL_INTERVAL_MS;

  const isInstalled = () => {
    const service = serviceMap.value.get(serviceName);
    return service ? isServiceInstalled(service) : false;
  };

  if (isInstalled()) {
    return true;
  }

  if (timeoutMs <= 0) {
    return isInstalled();
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await refreshServices({ keepUi: true, silent: true, skipPortalReset: true });
    if (isInstalled()) {
      return true;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    await sleep(Math.min(intervalMs, remaining));
  }

  return isInstalled();
};

const currentStepServices = computed(() => getStepServices(currentStep.value.key));

const currentStepSelectableServices = computed(() =>
  currentStepServices.value.filter(
    (service) => selectedSet.value.has(service.name) && !isServiceInstalled(service),
  ),
);

const fallbackPortalInstallTargets = computed(() => {
  if (currentStep.value.key !== 'portal') {
    return [];
  }

  if (currentStepSelectableServices.value.length > 0) {
    return [];
  }

  const portalService = currentStepServices.value.find(
    (service) => service?.name === PORTAL_SERVICE_NAME,
  );

  return portalService ? [portalService] : [];
});

const fallbackRavenInstallTargets = computed(() => {
  if (currentStep.value.key !== 'raven') {
    return [];
  }

  if (currentStepSelectableServices.value.length > 0) {
    return [];
  }

  const ravenDependenciesBlocking = missingDependencies(RAVEN_SERVICE_NAME);
  if (ravenDependenciesBlocking.length > 0) {
    return [];
  }

  const ravenServiceEntry = currentStepServices.value.find(
    (service) => service?.name === RAVEN_SERVICE_NAME,
  );

  if (!ravenServiceEntry || isServiceInstalled(ravenServiceEntry)) {
    return [];
  }

  return [ravenServiceEntry];
});

const currentStepInstallTargets = computed(() => {
  if (currentStepSelectableServices.value.length > 0) {
    return currentStepSelectableServices.value;
  }

  if (fallbackPortalInstallTargets.value.length > 0) {
    return fallbackPortalInstallTargets.value;
  }

  if (fallbackRavenInstallTargets.value.length > 0) {
    return fallbackRavenInstallTargets.value;
  }

  return [];
});

const canInstallCurrentStep = computed(() => {
  if (installing.value) {
    return false;
  }

  if (currentStep.value.key === 'portal') {
    return !portalAction.loading;
  }

  if (currentStepSelectableServices.value.length > 0) {
    return true;
  }

  if (currentStep.value.key === 'raven') {
    return fallbackRavenInstallTargets.value.length > 0;
  }

  return false;
});

const isBooleanLikeValue = (value) => {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'false';
  }
  return false;
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
      const defaultValue = field.defaultValue;
      if (isBooleanLikeValue(defaultValue)) {
        const normalized =
          typeof defaultValue === 'string'
            ? defaultValue.trim().toLowerCase()
            : defaultValue === true
            ? 'true'
            : 'false';
        defaults[key] = normalized;
      } else if (defaultValue != null) {
        defaults[key] = String(defaultValue);
      } else {
        defaults[key] = '';
      }
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
      const defaultValue = field.defaultValue;
      if (isBooleanLikeValue(defaultValue)) {
        const normalized =
          typeof defaultValue === 'string'
            ? defaultValue.trim().toLowerCase()
            : defaultValue === true
            ? 'true'
            : 'false';
        existing[key] = normalized;
      } else if (defaultValue != null) {
        existing[key] = String(defaultValue);
      } else {
        existing[key] = '';
      }
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
    if (rawValue == null) {
      payload[key] = '';
      continue;
    }

    if (isBooleanLikeValue(rawValue)) {
      const normalized =
        typeof rawValue === 'string'
          ? rawValue.trim().toLowerCase()
          : rawValue === true
          ? 'true'
          : 'false';
      payload[key] = normalized;
    } else {
      payload[key] = String(rawValue);
    }
  }

  return payload;
};

const SERVICE_ENDPOINTS = buildServiceEndpointCandidates();

const getServiceEnvFields = (service) => {
  if (!service || !Array.isArray(service.envConfig)) {
    return [];
  }

  if (service.name !== PORTAL_SERVICE_NAME) {
    return service.envConfig;
  }

  return service.envConfig.filter(
    (field) => !PORTAL_CREDENTIAL_KEYS.has(field?.key),
  );
};

const isPortalRoleFieldKey = (key) =>
  typeof key === 'string' &&
  (key.endsWith(PORTAL_ROLE_SUFFIX) || key.startsWith(PORTAL_REQUIRED_ROLE_PREFIX));

const isPortalChannelFieldKey = (key) =>
  typeof key === 'string' && key.endsWith(PORTAL_CHANNEL_SUFFIX);

const isPortalResourceField = (field) => {
  if (!field || typeof field.key !== 'string') {
    return false;
  }

  return isPortalRoleFieldKey(field.key) || isPortalChannelFieldKey(field.key);
};

const shouldRenderPortalResourceSelect = (service, field) =>
  service?.name === PORTAL_SERVICE_NAME && isPortalResourceField(field);

const getPortalSelectItems = (field) => {
  if (!isPortalResourceField(field)) {
    return [];
  }

  if (isPortalRoleFieldKey(field.key)) {
    return portalRoleOptions.value;
  }

  if (isPortalChannelFieldKey(field.key)) {
    return portalChannelOptions.value;
  }

  return [];
};

const isPortalFieldLocked = (field) => {
  if (!field || !field.key) {
    return false;
  }

  if (PORTAL_CREDENTIAL_KEYS.has(field.key)) {
    return false;
  }

  return !portalDiscordReady.value;
};

const resetPortalDiscordState = () => {
  portalDiscordState.verifying = false;
  portalDiscordState.verified = false;
  portalDiscordState.error = '';
  portalDiscordState.guild = null;
  portalDiscordState.roles = [];
  portalDiscordState.channels = [];
  portalDiscordState.lastVerifiedToken = '';
  portalDiscordState.lastVerifiedGuildId = '';
  portalDiscordState.createRole.name = '';
  portalDiscordState.createRole.error = '';
  portalDiscordState.createRole.loading = false;
  portalDiscordState.createChannel.name = '';
  portalDiscordState.createChannel.error = '';
  portalDiscordState.createChannel.loading = false;
};

const connectPortalDiscord = async () => {
  if (portalDiscordState.verifying) return;

  const rawToken = portalEnvForm.value[PORTAL_DISCORD_TOKEN_KEY];
  const rawGuildId = portalEnvForm.value[PORTAL_DISCORD_GUILD_KEY];
  const token = typeof rawToken === 'string' ? rawToken.trim() : '';
  const guildId = typeof rawGuildId === 'string' ? rawGuildId.trim() : '';

  if (!token || !guildId) {
    portalDiscordState.error =
      'Provide both the Discord bot token and guild ID to continue.';
    portalDiscordState.verified = false;
    return;
  }

  portalDiscordState.verifying = true;
  portalDiscordState.error = '';
  portalDiscordState.createRole.error = '';
  portalDiscordState.createChannel.error = '';

  try {
    const payload = await validatePortalDiscordConfig(
      { token, guildId },
      portalDiscordEndpointBase.value,
    );
    const guild = sanitizePortalGuild(payload?.guild);
    const roles = normalizePortalRoles(payload?.roles);
    const channels = normalizePortalChannels(payload?.channels);

    portalDiscordState.guild = guild;
    portalDiscordState.roles = roles;
    portalDiscordState.channels = channels;
    portalDiscordState.verified = true;
    portalDiscordState.lastVerifiedToken = token;
    portalDiscordState.lastVerifiedGuildId = guildId;

    if (portalEnvForm.value[PORTAL_DISCORD_TOKEN_KEY] !== token) {
      portalEnvForm.value[PORTAL_DISCORD_TOKEN_KEY] = token;
    }
    if (portalEnvForm.value[PORTAL_DISCORD_GUILD_KEY] !== guildId) {
      portalEnvForm.value[PORTAL_DISCORD_GUILD_KEY] = guildId;
    }
  } catch (error) {
    portalDiscordState.error =
      error instanceof Error ? error.message : String(error);
    portalDiscordState.verified = false;
    portalDiscordState.guild = null;
    portalDiscordState.roles = [];
    portalDiscordState.channels = [];
    portalDiscordState.lastVerifiedToken = '';
    portalDiscordState.lastVerifiedGuildId = '';
  } finally {
    portalDiscordState.verifying = false;
  }
};

const handleCreatePortalRole = async (fieldKey) => {
  if (portalDiscordState.createRole.loading) {
    return;
  }

  if (!portalDiscordReady.value) {
    portalDiscordState.createRole.error =
      'Verify the Discord connection before creating a role.';
    return;
  }

  const name = portalDiscordState.createRole.name.trim();
  if (!name) {
    portalDiscordState.createRole.error = 'Role name is required.';
    return;
  }

  portalDiscordState.createRole.loading = true;
  portalDiscordState.createRole.error = '';

  try {
    const role = await createPortalDiscordRole(
      {
        token: portalDiscordState.lastVerifiedToken,
        guildId: portalDiscordState.lastVerifiedGuildId,
        name,
      },
      portalDiscordEndpointBase.value,
    );

    const sanitized = sanitizePortalRole(role);
    if (!sanitized) {
      throw new Error('Role creation did not return a valid role.');
    }

    portalDiscordState.roles = mergePortalResource(
      portalDiscordState.roles,
      sanitized,
      sortPortalRoles,
    );
    portalEnvForm.value[fieldKey] = sanitized.id;
    portalDiscordState.createRole.name = '';
  } catch (error) {
    portalDiscordState.createRole.error =
      error instanceof Error ? error.message : String(error);
  } finally {
    portalDiscordState.createRole.loading = false;
  }
};

const handleCreatePortalChannel = async (fieldKey) => {
  if (portalDiscordState.createChannel.loading) {
    return;
  }

  if (!portalDiscordReady.value) {
    portalDiscordState.createChannel.error =
      'Verify the Discord connection before creating a channel.';
    return;
  }

  const name = portalDiscordState.createChannel.name.trim();
  if (!name) {
    portalDiscordState.createChannel.error = 'Channel name is required.';
    return;
  }

  portalDiscordState.createChannel.loading = true;
  portalDiscordState.createChannel.error = '';

  try {
    const channel = await createPortalDiscordChannel(
      {
        token: portalDiscordState.lastVerifiedToken,
        guildId: portalDiscordState.lastVerifiedGuildId,
        name,
        type: portalDiscordState.createChannel.type,
      },
      portalDiscordEndpointBase.value,
    );

    const sanitized = sanitizePortalChannel(channel);
    if (!sanitized) {
      throw new Error('Channel creation did not return a valid channel.');
    }

    portalDiscordState.channels = mergePortalResource(
      portalDiscordState.channels,
      sanitized,
      sortPortalChannels,
    );
    portalEnvForm.value[fieldKey] = sanitized.id;
    portalDiscordState.createChannel.name = '';
  } catch (error) {
    portalDiscordState.createChannel.error =
      error instanceof Error ? error.message : String(error);
  } finally {
    portalDiscordState.createChannel.loading = false;
  }
};

const deriveServiceTestEndpoint = (servicesEndpoint, serviceName) => {
  const normalizedName =
    typeof serviceName === 'string' ? serviceName.trim() : '';
  const fallbackName = normalizedName || (typeof serviceName === 'string' ? serviceName : '');
  const fallbackBase = DEFAULT_SERVICES_ENDPOINT.replace(/\/+$/, '');
  const fallback = fallbackName
    ? `${fallbackBase}/${fallbackName}/test`
    : `${fallbackBase}/test`;
  const portalFallback =
    fallbackName === PORTAL_SERVICE_NAME
      ? DEFAULT_PORTAL_TEST_ENDPOINT
      : fallback;

  if (!normalizedName) {
    return portalFallback;
  }

  if (typeof servicesEndpoint !== 'string') {
    return portalFallback;
  }

  const trimmed = servicesEndpoint.trim();
  if (!trimmed) {
    return portalFallback;
  }

  const [withoutQuery] = trimmed.split('?');
  const sanitized = withoutQuery.replace(/\/+$/, '');

  if (!sanitized || !sanitized.endsWith('/services')) {
    return portalFallback;
  }

  const ensureLeadingSlash = (value) =>
    value.startsWith('/') ? value : `/${value}`;
  const isAbsolute = ABSOLUTE_URL_REGEX.test(sanitized);
  const candidate = `${sanitized}/${normalizedName}/test`;

  const normalizedCandidate = isAbsolute ? candidate : ensureLeadingSlash(candidate);

  return normalizedCandidate || portalFallback;
};

const deriveServiceEndpoints = (servicesEndpoint) => {
  const defaults = {
    services: DEFAULT_SERVICES_ENDPOINT,
    install: DEFAULT_INSTALL_ENDPOINT,
    progress: DEFAULT_INSTALL_PROGRESS_ENDPOINT,
    logs: DEFAULT_INSTALL_LOGS_ENDPOINT,
  };

  if (typeof servicesEndpoint !== 'string') {
    return defaults;
  }

  const trimmed = servicesEndpoint.trim();
  if (!trimmed) {
    return defaults;
  }

  const [withoutQuery] = trimmed.split('?');
  const sanitized = withoutQuery.replace(/\/+$/, '');

  if (!sanitized) {
    return defaults;
  }

  const setupSuffix = '/setup/services';
  const servicesSuffix = '/services';

  const ensureLeadingSlash = (value) =>
    value.startsWith('/') ? value : `/${value}`;

  const isAbsolute = ABSOLUTE_URL_REGEX.test(sanitized);
  const normalize = (value) => (isAbsolute ? value : ensureLeadingSlash(value));

  let servicesBase = null;
  let installEndpointCandidate = null;

  if (sanitized.endsWith(setupSuffix)) {
    const root = sanitized.slice(0, -setupSuffix.length);
    servicesBase = `${root}/setup/services`;
    installEndpointCandidate = `${root}/setup/install`;
  } else if (sanitized.endsWith(servicesSuffix)) {
    const root = sanitized.slice(0, -servicesSuffix.length);
    servicesBase = `${root}/services`;
    installEndpointCandidate = `${servicesBase}/install`;
  } else {
    return defaults;
  }

  const progressEndpointCandidate = `${servicesBase}/install/progress`;
  const logsEndpointCandidate = `${servicesBase}/installation/logs`;

  return {
    services: normalize(servicesBase),
    install: normalize(installEndpointCandidate),
    progress: normalize(progressEndpointCandidate),
    logs: normalize(logsEndpointCandidate),
  };
};

const deriveInstallEndpoint = (servicesEndpoint) =>
  deriveServiceEndpoints(servicesEndpoint).install;

const resetProgressState = () => {
  state.progress.items = [];
  state.progress.percent = null;
  state.progress.status = '';
  state.progress.error = '';
  state.progress.logError = '';
  installLogLimit.value = DEFAULT_INSTALL_LOG_LIMIT;
  installLogs.value = '';
};

const resetStepState = () => {
  installError.value = '';
  installResults.value = null;
  installSuccessMessageVisible.value = false;
  showProgressDetails.value = false;
  showStepInfo.value = false;
  installLogs.value = '';
  resetProgressState();

  portalAction.loading = false;
  portalAction.success = false;
  portalAction.error = '';
  portalAction.completed = false;

  ravenAction.loading = false;
  ravenAction.success = false;
  ravenAction.error = '';
  ravenAction.completed = false;
  ravenAction.message = '';
  resetRavenPhaseState();
};

const loadServicesFromEndpoint = async (endpoint) => {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`[${endpoint}] Request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const services = normalizeServiceList(payload);
  const filtered = services.filter((service) => ALLOWED_SERVICE_NAMES.has(service.name));
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  return filtered;
};

const refreshServices = async (options) => {
  const keepUi = options?.keepUi === true;
  const skipPortalReset = options?.skipPortalReset === true;
  const silent = options?.silent === true;
  const preserveStep = keepUi || options?.preserveStep === true;

  if (!keepUi && !silent) {
    state.loading = true;
  }
  if (!silent) {
    state.loadError = '';
  }
  installEndpoint.value = DEFAULT_INSTALL_ENDPOINT;
  activeServicesEndpoint.value = DEFAULT_SERVICES_ENDPOINT;
  installProgressEndpoint.value = DEFAULT_INSTALL_PROGRESS_ENDPOINT;
  installLogsEndpoint.value = DEFAULT_INSTALL_LOGS_ENDPOINT;
  if (!skipPortalReset) {
    resetPortalDiscordState();
  }

  const errors = [];
  const previousSelection = new Set(selectedServices.value);

  try {
    for (const endpoint of SERVICE_ENDPOINTS) {
      try {
        const services = await loadServicesFromEndpoint(endpoint);
        state.services = services;
        syncEnvForms(services);
        const derivedEndpoints = deriveServiceEndpoints(endpoint);
        activeServicesEndpoint.value = derivedEndpoints.services;
        installEndpoint.value = derivedEndpoints.install;
        installProgressEndpoint.value = derivedEndpoints.progress;
        installLogsEndpoint.value = derivedEndpoints.logs;

        for (const service of services) {
          if (ALWAYS_SELECTED_SERVICES.has(service.name) && !isServiceInstalled(service)) {
            previousSelection.add(service.name);
          }
        }

        selectedServices.value = mergeRequiredSelections(
          services,
          Array.from(previousSelection),
        );
        syncWizardStatus({ preserveStep });
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
    syncWizardStatus({ preserveStep });
  } finally {
    if (!keepUi && !silent) {
      state.loading = false;
    }
  }
};

const missingDependencies = (name) => {
  const dependencies = SERVICE_DEPENDENCIES[name];
  if (!dependencies || !dependencies.length) {
    return [];
  }

  const unresolved = [];
  const installedNames = installedSet.value;

  for (const dependency of dependencies) {
    if (!installedNames.has(dependency) && !selectedSet.value.has(dependency)) {
      unresolved.push(dependency);
    }
  }

  return unresolved;
};

const isServiceLocked = (service) =>
  isServiceInstalled(service) ||
  isServiceRequired(service) ||
  ALWAYS_SELECTED_SERVICES.has(service.name);

const isServiceBlocked = (service) => missingDependencies(service.name).length > 0;

const isCardDisabled = (service) =>
  installing.value || (isServiceBlocked(service) && !isServiceLocked(service));

const isCardExpanded = (name) => expandedCards.value.includes(name);

const setCardExpanded = (name, expanded) => {
  const hasName = expandedCards.value.includes(name);
  if (expanded && !hasName) {
    expandedCards.value = [...expandedCards.value, name];
  } else if (!expanded && hasName) {
    expandedCards.value = expandedCards.value.filter((entry) => entry !== name);
  }
};

const toggleCardExpansion = (service) => {
  const name = service?.name;
  if (!name) return;

  const disabled = isCardDisabled(service);
  if (disabled && !isCardExpanded(name)) {
    // Allow opening the card to show dependency information even if disabled.
    setCardExpanded(name, true);
    return;
  }

  setCardExpanded(name, !isCardExpanded(name));
};

const toggleService = (name) => {
  if (installing.value) return;

  const service = serviceMap.value.get(name);
  if (!service || isServiceInstalled(service)) {
    return;
  }

  if (isServiceLocked(service)) {
    setCardExpanded(name, true);
    return;
  }

  if (isServiceBlocked(service)) {
    setCardExpanded(name, true);
    return;
  }

  const next = new Set(selectedSet.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }

  selectedServices.value = Array.from(next);
  if (next.has(name)) {
    setCardExpanded(name, true);
  }
};

const isBooleanField = (serviceName, field) => {
  const defaultValue = field?.defaultValue;
  if (isBooleanLikeValue(defaultValue)) {
    return true;
  }

  const value = envForms?.[serviceName]?.[field?.key];
  return isBooleanLikeValue(value);
};

const fetchInstallProgress = async () => {
  try {
    const response = await fetch(
      installProgressEndpoint.value || DEFAULT_INSTALL_PROGRESS_ENDPOINT,
    );
    if (!response.ok) {
      throw new Error(`Progress request failed with status ${response.status}`);
    }

    const payload = await response.json().catch(() => ({}));
    const items = Array.isArray(payload.items)
      ? payload.items.map((item) => ({
          label: typeof item.label === 'string' ? item.label : item.name ?? 'Task',
          status: typeof item.status === 'string' ? item.status : item.state ?? '',
        }))
      : [];

    state.progress.items = items;
    state.progress.percent =
      typeof payload.percent === 'number' ? payload.percent : null;
    state.progress.status =
      typeof payload.status === 'string' ? payload.status : '';
    state.progress.error = '';
  } catch (error) {
    state.progress.error = error instanceof Error ? error.message : String(error);
  }
};

const formatLogEntry = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const parts = [];
  if (entry.timestamp) {
    parts.push(`[${entry.timestamp}]`);
  }

  if (entry.type && entry.type !== 'log') {
    parts.push(entry.type);
  }

  if (entry.status) {
    parts.push(entry.status);
  }

  if (entry.message) {
    parts.push(entry.message);
  }

  if (entry.detail) {
    parts.push(`(${entry.detail})`);
  }

  const line = parts.join(' ').trim();
  return line || null;
};

const fetchInstallLogs = async (options = {}) => {
  const requestOptions = { silent: false, ...options };

  if (logsRequestActive) {
    if (!requestOptions.silent) {
      progressLogsLoading.value = true;
    }
    pendingLogsRequestOptions = requestOptions;
    return;
  }

  logsRequestActive = true;
  pendingLogsRequestOptions = null;

  if (!requestOptions.silent) {
    progressLogsLoading.value = true;
  }

  try {
    const response = await fetch(installLogsRequestUrl.value);

    if (response.status === 404 || response.status === 204) {
      installLogs.value = '';
      state.progress.logError = '';
      return;
    }

    if (!response.ok) {
      throw new Error(`Log request failed with status ${response.status}`);
    }

    const payload = await response.json().catch(() => ({}));
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const formatted = entries
      .map(formatLogEntry)
      .filter((line) => typeof line === 'string' && line.length > 0);
    const latestEntries = formatted.slice(-INSTALL_LOG_DISPLAY_COUNT);
    installLogs.value = latestEntries.join('\n');
    state.progress.logError = '';
  } catch (error) {
    state.progress.logError = error instanceof Error ? error.message : String(error);
  } finally {
    logsRequestActive = false;
    if (!requestOptions.silent) {
      progressLogsLoading.value = false;
    }

    if (pendingLogsRequestOptions) {
      const nextOptions = pendingLogsRequestOptions;
      pendingLogsRequestOptions = null;
      void fetchInstallLogs(nextOptions);
    }
  }
};

const refreshInstallLogs = () => fetchInstallLogs();

const showMoreInstallLogs = () => {
  installLogLimit.value = INSTALL_LOG_DISPLAY_COUNT;
  void fetchInstallLogs();
};

const stopProgressPolling = () => {
  if (progressPollHandle != null) {
    clearTimeout(progressPollHandle);
    progressPollHandle = null;
  }
};

const scheduleProgressPolling = () => {
  stopProgressPolling();

  const run = async () => {
    await fetchInstallProgress();

    if (showProgressDetails.value) {
      await fetchInstallLogs({ silent: true });
    }

    if (installing.value) {
      progressPollHandle = setTimeout(run, 2000);
    }
  };

  void run();
};

const installStepServices = computed(() =>
  currentStepInstallTargets.value.map((service) => service.name),
);

const installCurrentStep = async () => {
  if (installing.value) return;

  const stepKey = currentStep.value.key;
  const isPortalStep = stepKey === 'portal';
  const refreshOptions = isPortalStep
    ? { keepUi: true, skipPortalReset: true }
    : undefined;

  if (!isPortalStep && !installStepServices.value.length) return;
  if (isPortalStep) {
    resetPortalActionState();
  }

  installing.value = true;
  installError.value = '';
  installResults.value = null;
  installSuccessMessageVisible.value = false;
  resetProgressState();

  const descriptors = currentStepInstallTargets.value;
  const hasInstallTargets = descriptors.length > 0;
  if (hasInstallTargets) {
    scheduleProgressPolling();
  } else {
    stopProgressPolling();
  }

  const servicePayload = descriptors.map((service) => {
    const env = buildEnvPayload(service);
    if (!Object.keys(env).length) {
      return { name: service.name };
    }

    return { name: service.name, env };
  });

  let refreshedServices = false;

  try {
    if (hasInstallTargets) {
      const response = await fetch(installEndpoint.value || DEFAULT_INSTALL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: servicePayload }),
      });

      const responsePayload = await response.json().catch(() => ({}));
      const results = Array.isArray(responsePayload.results)
        ? responsePayload.results
        : [];
      installResults.value = {
        status: response.status,
        results,
      };

      if (!response.ok) {
        installError.value =
          responsePayload?.error || `Install request failed with status ${response.status}`;
        if (isPortalStep) {
          portalAction.error =
            installError.value || 'Portal installation must complete successfully before testing.';
        }
        return;
      }

      const successful = new Set(
        results
          .filter((item) => item && item.status === 'installed' && item.name)
          .map((item) => item.name),
      );

      const remaining = normalizedSelection.value.filter((name) => !successful.has(name));
      selectedServices.value = mergeRequiredSelections(
        state.services,
        Array.from(new Set([...remaining, ...ALWAYS_SELECTED_SERVICES])),
      );

      await refreshServices(refreshOptions);
      refreshedServices = true;

      if (stepKey === 'raven') {
        installSuccessMessageVisible.value = true;
      }
    } else if (isPortalStep) {
      await refreshServices(refreshOptions);
      refreshedServices = true;
    }

    if (isPortalStep) {
      if (!refreshedServices) {
        await refreshServices(refreshOptions);
        refreshedServices = true;
      }

      const installFailure = getPortalInstallFailureMessage();
      if (installFailure) {
        portalAction.error = installFailure;
        return;
      }

      const portalServicesReady = await waitForPortalServicesInstalled();
      if (!portalServicesReady) {
        portalAction.error = PORTAL_SERVICE_TIMEOUT_MESSAGE;
        return;
      }

      if (!isStepInstalled('portal')) {
        portalAction.error = 'Portal installation must complete successfully before testing.';
        return;
      }

      await verifyPortalBot();
    }
  } catch (error) {
    installError.value = error instanceof Error ? error.message : String(error);
    if (isPortalStep) {
      portalAction.error =
        installError.value || 'Portal installation must complete successfully before testing.';
    }
  } finally {
    installing.value = false;
    stopProgressPolling();
  }
};

const getManualRavenMountOverride = () => {
  const values = envForms?.['noona-raven'];
  if (!values) {
    return null;
  }

  const hostPath =
    typeof values.KAVITA_DATA_MOUNT === 'string' ? values.KAVITA_DATA_MOUNT.trim() : '';
  const downloadsRoot = typeof values.APPDATA === 'string' ? values.APPDATA.trim() : '';

  if (!hostPath) {
    return null;
  }

  return {
    hostPath,
    downloadsRoot,
  };
};

const RAVEN_LIBRARY_TIMEOUT_MS = 10000;

const verifyRavenThroughSage = async () => {
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
  const timeout = controller ? setTimeout(() => controller.abort(), RAVEN_LIBRARY_TIMEOUT_MS) : undefined;

  try {
    const response = await fetch(RAVEN_LIBRARY_ENDPOINT, {
      signal: controller?.signal,
      headers: { Accept: 'application/json' },
    });

    const text = await response.text().catch(() => '');
    let payload = {};

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
    }

    if (!response.ok) {
      const message =
        typeof payload?.error === 'string' && payload.error.trim()
          ? payload.error
          : `Raven library request failed with status ${response.status}`;
      throw new Error(message);
    }

    return payload;
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
  }
};

const installServicesDirect = async (services) => {
  if (!Array.isArray(services) || services.length === 0) {
    return [];
  }

  const servicePayload = services.map((service) => {
    const env = buildEnvPayload(service);
    if (!env || !Object.keys(env).length) {
      return { name: service.name };
    }
    return { name: service.name, env };
  });

  const response = await fetch(installEndpoint.value || DEFAULT_INSTALL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ services: servicePayload }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.error || `Install request failed with status ${response.status}`);
  }

  return Array.isArray(payload?.results) ? payload.results : [];
};

const advanceToRavenStep = () => {
  installSuccessMessageVisible.value = true;
  const ravenStepIndex = STEP_DEFINITIONS.findIndex((step) => step.key === 'raven');
  if (ravenStepIndex !== -1) {
    activeStepIndex.value = ravenStepIndex;
  }
};

const runRavenHandshake = async () => {
  if (ravenAction.loading || installing.value) return;

  ravenAction.loading = true;
  ravenAction.error = '';
  ravenAction.message = '';
  ravenAction.success = false;
  ravenAction.completed = false;
  resetRavenPhaseState();

  const manualOverride = getManualRavenMountOverride();

  try {
    setRavenPhaseState('dependencies', 'running', 'Confirming Portal and Vault availability…');

    if (!ravenDependenciesReady.value) {
      const dependencies = ravenMissingDependencyLabels.value.join(' & ') || 'required services';
      const dependencyMessage = `Install ${dependencies} before running Raven.`;
      setRavenPhaseState('dependencies', 'error', dependencyMessage);
      throw new Error(dependencyMessage);
    }

    setRavenPhaseState('dependencies', 'success', 'Portal and Vault are ready.');

    const ravenServiceEntry = ravenService.value;
    if (!ravenServiceEntry) {
      setRavenPhaseState('installation', 'error', 'Raven service definition unavailable.');
      throw new Error('Raven service is unavailable. Refresh the page and try again.');
    }

    setRavenPhaseState('installation', 'running', 'Requesting Raven installation via Sage…');

    if (!isRavenInstalled.value) {
      ravenAction.message = 'Installing Raven via Sage…';
      await installServicesDirect([ravenServiceEntry]);
      const installed = await waitForServiceInstalled(RAVEN_SERVICE_NAME);
      if (!installed) {
        setRavenPhaseState('installation', 'error', 'Raven did not become ready in time.');
        throw new Error('Raven did not become ready in time. Check the installation logs and retry.');
      }
      setRavenPhaseState('installation', 'success', 'Raven installed successfully.');
      ravenAction.message = 'Raven installed. Verifying configuration…';
    } else {
      setRavenPhaseState('installation', 'success', 'Raven is already installed.');
      ravenAction.message = 'Verifying Raven configuration with Sage…';
    }

    setRavenPhaseState('verification', 'running', 'Asking Sage to verify Raven configuration…');

    const response = await fetch(RAVEN_DETECT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = payload?.error || `Raven detection failed with status ${response.status}`;
      setRavenPhaseState('verification', 'error', errorMessage);
      throw new Error(errorMessage);
    }

    const detection = payload?.detection ?? null;
    let verificationSummary = '';

    if (detection?.mountPath) {
      verificationSummary = `Sage detected the Kavita data mount at ${detection.mountPath}.`;
    } else if (manualOverride) {
      const suffix = manualOverride.downloadsRoot
        ? ` → ${manualOverride.downloadsRoot}`
        : '';
      verificationSummary = `Using manual Kavita data mount ${manualOverride.hostPath}${suffix}.`;
    } else {
      const missingMessage =
        'Kavita data mount not detected automatically. Start your Kavita container or provide the host path in the Raven environment settings before retrying.';
      setRavenPhaseState('verification', 'error', missingMessage);
      throw new Error(missingMessage);
    }

    try {
      await verifyRavenThroughSage();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRavenPhaseState('verification', 'error', message);
      throw error;
    }

    const completionMessage = `${verificationSummary} Raven handshake complete—Moon will route Raven traffic through Sage.`;
    setRavenPhaseState('verification', 'success', completionMessage);
    ravenAction.message = completionMessage;
    ravenAction.success = true;
    ravenAction.completed = true;

    advanceToRavenStep();
    await refreshServices({ keepUi: true, silent: true, skipPortalReset: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!ravenPhaseEntries.value.some((entry) => entry.state === 'error')) {
      setRavenPhaseState('verification', 'error', message);
    }
    ravenAction.error = message;
    ravenAction.success = false;
    ravenAction.completed = false;
  } finally {
    ravenAction.loading = false;
  }
};

const refreshRavenStatus = async () => {
  if (installing.value || ravenAction.loading) {
    return;
  }

  ravenAction.error = '';
  ravenAction.message = '';
  resetRavenPhaseState();

  await refreshServices({ keepUi: true, silent: true, skipPortalReset: true });
};

const isStepInstalled = (stepKey) => {
  const services = getStepServices(stepKey);
  if (!services.length) return true;
  return services.every((service) => isServiceInstalled(service));
};

const isStepActionComplete = (stepKey) => {
  if (stepKey === 'portal') {
    if (!hasPortalStepServices.value) {
      return true;
    }
    return portalAction.completed;
  }
  if (stepKey === 'raven') return ravenAction.completed;
  return true;
};

const isStepComplete = (stepKey) =>
  isStepInstalled(stepKey) && isStepActionComplete(stepKey);

const totalWizardSteps = STEP_DEFINITIONS.length;

const completedStepCount = computed(() =>
  STEP_DEFINITIONS.reduce(
    (count, step) => (isStepComplete(step.key) ? count + 1 : count),
    0,
  ),
);

const wizardProgressPercent = computed(() => {
  if (totalWizardSteps === 0) {
    return 0;
  }

  return Math.round((completedStepCount.value / totalWizardSteps) * 100);
});

const wizardProgressLabel = computed(
  () => `${completedStepCount.value} / ${totalWizardSteps} steps complete`,
);

const wizardCompletionMessage = computed(() => {
  if (!wizardComplete.value) {
    return '';
  }

  if (!wizardCompletionTimestamp.value) {
    return 'Setup complete! All services are installed and verified.';
  }

  const finishedAt = new Date(wizardCompletionTimestamp.value);
  if (Number.isNaN(finishedAt.getTime())) {
    return 'Setup complete! All services are installed and verified.';
  }

  return `Setup complete! All services are installed and verified as of ${finishedAt.toLocaleTimeString()}.`;
});

const findFirstIncompleteStepIndex = () =>
  STEP_DEFINITIONS.findIndex((step) => !isStepComplete(step.key));

const syncWizardStatus = ({ preserveStep = false } = {}) => {
  const incompleteIndex = findFirstIncompleteStepIndex();

  if (incompleteIndex === -1) {
    if (!wizardComplete.value) {
      wizardCompletionTimestamp.value = Date.now();
    }
    wizardComplete.value = true;

    if (!preserveStep) {
      activeStepIndex.value = Math.max(0, STEP_DEFINITIONS.length - 1);
    } else if (!isStepUnlocked(currentStep.value.key)) {
      activeStepIndex.value = Math.max(0, STEP_DEFINITIONS.length - 1);
    }

    return;
  }

  if (wizardComplete.value) {
    wizardCompletionTimestamp.value = 0;
  }

  wizardComplete.value = false;

  if (!preserveStep) {
    if (activeStepIndex.value !== incompleteIndex) {
      activeStepIndex.value = incompleteIndex;
    }
  } else if (!isStepUnlocked(currentStep.value.key)) {
    activeStepIndex.value = incompleteIndex;
  }
};

const isStepUnlocked = (stepKey) => {
  const index = STEP_DEFINITIONS.findIndex((step) => step.key === stepKey);
  if (index <= 0) {
    return true;
  }

  const previousSteps = STEP_DEFINITIONS.slice(0, index);
  return previousSteps.every((step) => isStepComplete(step.key));
};

const goToStep = (index) => {
  if (index < 0 || index >= STEP_DEFINITIONS.length) return;
  const targetStep = STEP_DEFINITIONS[index];
  if (!isStepUnlocked(targetStep.key)) return;

  resetStepState();

  if (index !== activeStepIndex.value) {
    activeStepIndex.value = index;
  }
};

const canGoToNextStep = computed(() => {
  if (activeStepIndex.value >= STEP_DEFINITIONS.length - 1) {
    return false;
  }

  return isStepComplete(currentStep.value.key);
});

const goToNextStep = () => {
  if (!canGoToNextStep.value) return;
  goToStep(activeStepIndex.value + 1);
};

const currentStepInstallableCount = computed(
  () => currentStepServices.value.filter((service) => !isServiceInstalled(service)).length,
);

const showInstallResults = computed(() =>
  installResults.value && Array.isArray(installResults.value.results) && installResults.value.results.length > 0,
);

const currentStepInfoEntries = computed(
  () => STEP_INFO_SECTIONS[currentStep.value.key] ?? [],
);

const hasPortalStatusMessage = computed(
  () =>
    currentStep.value.key === 'portal' &&
    (portalAction.loading || portalAction.success || Boolean(portalAction.error)),
);

const hasStepInfo = computed(
  () => currentStepInfoEntries.value.length > 0 || hasPortalStatusMessage.value,
);

const refreshProgressAfterInstall = async () => {
  await fetchInstallProgress();
  if (showProgressDetails.value) {
    await fetchInstallLogs();
  }
};

const portalOverviewMessage = computed(() => {
  if (!portalAction.success) {
    return '';
  }

  return 'Portal bot verified successfully.';
});

watch(
  activeStepIndex,
  (nextIndex, previousIndex) => {
    if (nextIndex !== previousIndex) {
      resetStepState();
    }
  },
);

watch(installing, (value, previous) => {
  if (!value) {
    stopProgressPolling();

    if (previous) {
      void refreshProgressAfterInstall();
      return;
    }

    if (showProgressDetails.value) {
      void fetchInstallLogs();
    }
  }
});

watch(showProgressDetails, (value) => {
  if (value) {
    void fetchInstallLogs();
  } else {
    state.progress.logError = '';
    progressLogsLoading.value = false;
  }
});

watch(serviceStatusSignature, () => {
  syncWizardStatus({ preserveStep: true });
});

watch(
  () => portalAction.completed,
  () => {
    syncWizardStatus({ preserveStep: true });
  },
);

watch(
  () => ravenAction.completed,
  () => {
    syncWizardStatus({ preserveStep: true });
  },
);

watch(
  () => [portalAction.loading, portalAction.success, portalAction.error],
  ([loading, success, error]) => {
    if (currentStep.value.key === 'portal' && (loading || success || error)) {
      showStepInfo.value = true;
    }
  },
);

watch(
  () => state.services,
  (services) => {
    for (const service of services) {
      if (service?.name && ALWAYS_SELECTED_SERVICES.has(service.name)) {
        setCardExpanded(service.name, true);
      }
    }
  },
  { deep: true },
);

watch(
  () => [
    portalEnvForm.value[PORTAL_DISCORD_TOKEN_KEY],
    portalEnvForm.value[PORTAL_DISCORD_GUILD_KEY],
  ],
  ([token, guildId]) => {
    const normalizedToken = typeof token === 'string' ? token.trim() : '';
    const normalizedGuildId =
      typeof guildId === 'string' ? guildId.trim() : '';

    if (
      portalDiscordState.verified &&
      (normalizedToken !== portalDiscordState.lastVerifiedToken ||
        normalizedGuildId !== portalDiscordState.lastVerifiedGuildId)
    ) {
      portalDiscordState.verified = false;
      portalDiscordState.guild = null;
      portalDiscordState.roles = [];
      portalDiscordState.channels = [];
    }
  },
);

watch(hasPortalService, (present) => {
  if (!present) {
    resetPortalDiscordState();
  }
});

onMounted(() => {
  void refreshServices();
});

const vmInstance = getCurrentInstance();

// Public API for tests and orchestrated flows
const setupState = {
  get activeStepIndex() {
    return activeStepIndex.value;
  },
  set activeStepIndex(index) {
    const numericIndex = Number(index);
    activeStepIndex.value = Number.isFinite(numericIndex) ? numericIndex : 0;
  },
  get expandedCards() {
    return expandedCards.value;
  },
  set expandedCards(values) {
    expandedCards.value = Array.isArray(values) ? values : [];
  },
  get activeServicesEndpoint() {
    return activeServicesEndpoint.value;
  },
  set activeServicesEndpoint(endpoint) {
    activeServicesEndpoint.value =
      typeof endpoint === 'string' && endpoint.trim().length > 0
        ? endpoint
        : DEFAULT_SERVICES_ENDPOINT;
  },
  get installError() {
    return installError.value;
  },
  set installError(value) {
    installError.value = typeof value === 'string' ? value : String(value ?? '');
  },
  get installResults() {
    return installResults.value;
  },
  set installResults(value) {
    installResults.value = value == null ? null : value;
  },
  get installSuccessMessageVisible() {
    return installSuccessMessageVisible.value;
  },
  set installSuccessMessageVisible(visible) {
    installSuccessMessageVisible.value = Boolean(visible);
  },
  get showProgressDetails() {
    return showProgressDetails.value;
  },
  set showProgressDetails(visible) {
    showProgressDetails.value = Boolean(visible);
  },
  get installLogs() {
    return installLogs.value;
  },
  set installLogs(value) {
    installLogs.value = typeof value === 'string' ? value : String(value ?? '');
  },
  get selectedServices() {
    return selectedServices.value;
  },
  set selectedServices(values) {
    selectedServices.value = Array.isArray(values) ? values : [];
  },
  state,
  envForms,
  portalDiscordState,
  portalAction,
  ravenAction,
  get portalTestEndpoint() {
    return portalTestEndpoint.value;
  },
  goToStep,
  connectPortalDiscord,
  fetchInstallProgress,
  handleCreatePortalRole,
  handleCreatePortalChannel,
  getPortalSelectItems,
};

const exposedDollar = new Proxy(
  {},
  {
    get(_, prop) {
      if (prop === 'setupState') {
        return setupState;
      }

      const target = vmInstance?.proxy?.$;
      if (target && prop in target) {
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      }

      return undefined;
    },
    set(_, prop, value) {
      if (prop === 'setupState') {
        return false;
      }

      const target = vmInstance?.proxy?.$;
      if (target) {
        target[prop] = value;
        return true;
      }

      return false;
    },
    has(_, prop) {
      if (prop === 'setupState') {
        return true;
      }

      const target = vmInstance?.proxy?.$;
      return target ? prop in target : false;
    },
    ownKeys() {
      const target = vmInstance?.proxy?.$;
      const keys = target ? Reflect.ownKeys(target) : [];
      if (!keys.includes('setupState')) {
        keys.push('setupState');
      }

      return keys;
    },
    getOwnPropertyDescriptor(_, prop) {
      if (prop === 'setupState') {
        return {
          configurable: true,
          enumerable: true,
          value: setupState,
          writable: false,
        };
      }

      const target = vmInstance?.proxy?.$;
      if (!target) {
        return undefined;
      }

      return Object.getOwnPropertyDescriptor(target, prop);
    },
  },
);

defineExpose({
  get activeStepIndex() {
    return activeStepIndex.value;
  },
  set activeStepIndex(index) {
    const numericIndex = Number(index);
    activeStepIndex.value = Number.isFinite(numericIndex) ? numericIndex : 0;
  },
  get showStepInfo() {
    return showStepInfo.value;
  },
  set showStepInfo(visible) {
    showStepInfo.value = Boolean(visible);
  },
  get showProgressDetails() {
    return showProgressDetails.value;
  },
  set showProgressDetails(visible) {
    showProgressDetails.value = Boolean(visible);
  },
  get portalEnvForm() {
    return portalEnvForm.value;
  },
  get wizardComplete() {
    return wizardComplete.value;
  },
  set wizardComplete(value) {
    wizardComplete.value = Boolean(value);
  },
  get wizardProgressPercent() {
    return wizardProgressPercent.value ?? 0;
  },
  portalDiscordState,
  portalAction,
  ravenAction,
  installCurrentStep,
  runRavenHandshake,
  fetchInstallLogs,
  fetchInstallProgress,
  refreshInstallLogs,
  refreshServices,
  goToStep,
  connectPortalDiscord,
  handleCreatePortalRole,
  handleCreatePortalChannel,
  getPortalSelectItems,
  resetPortalDiscordState,
  // grouped state for TS tests: wrapper.vm.$.setupState
  $: exposedDollar,
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
              Follow the guided setup to install and verify each Noona service.
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
                  <v-btn color="error" variant="text" @click="refreshServices()">
                    Retry
                  </v-btn>
                </template>
              </v-alert>

              <div v-else>
                <div class="wizard-overview mb-6">
                  <div class="wizard-overview__progress">
                    <v-progress-linear
                      :model-value="wizardProgressPercent"
                      height="8"
                      color="primary"
                      rounded
                    />
                    <div class="wizard-overview__label text-body-2 text-medium-emphasis mt-2">
                      {{ wizardProgressLabel }}
                    </div>
                  </div>
                  <v-alert
                    v-if="wizardComplete"
                    type="success"
                    variant="tonal"
                    border="start"
                    class="wizard-overview__completion"
                    data-test="wizard-complete"
                  >
                    <p class="wizard-overview__message mb-1 font-weight-medium">
                      {{ wizardCompletionMessage }}
                    </p>
                    <p class="wizard-overview__hint mb-0 text-body-2 text-medium-emphasis">
                      You can revisit any step if you need to review configuration details.
                    </p>
                  </v-alert>
                  <v-alert
                    v-else-if="portalOverviewMessage"
                    type="success"
                    variant="tonal"
                    border="start"
                    class="wizard-overview__portal"
                    data-test="portal-overview-success"
                  >
                    {{ portalOverviewMessage }}
                  </v-alert>
                </div>

                <div class="setup-stepper" role="tablist">
                  <v-btn
                    v-for="(step, index) in STEP_DEFINITIONS"
                    :key="step.key"
                    :variant="index === activeStepIndex ? 'elevated' : 'text'"
                    :color="index === activeStepIndex ? 'primary' : undefined"
                    class="setup-stepper__item"
                    :class="{
                      'setup-stepper__item--active': index === activeStepIndex,
                      'setup-stepper__item--complete': isStepComplete(step.key),
                    }"
                    :aria-selected="index === activeStepIndex"
                    :disabled="!isStepUnlocked(step.key)"
                    @click="goToStep(index)"
                  >
                    <span class="setup-stepper__index">{{ index + 1 }}</span>
                    <div class="setup-stepper__body">
                      <span class="setup-stepper__label text-subtitle-2 font-weight-medium">
                        {{ step.label }}
                      </span>
                      <span class="setup-stepper__summary text-caption text-medium-emphasis">
                        {{ step.summary }}
                      </span>
                    </div>
                    <v-icon
                      v-if="isStepComplete(step.key)"
                      icon="mdi-check-circle"
                      color="success"
                      class="ml-2"
                    />
                  </v-btn>
                </div>

                <v-alert
                  v-if="installSuccessMessageVisible"
                  type="success"
                  variant="tonal"
                  class="mb-6"
                  border="start"
                >
                  Thanks for installing Noona—check out Raven.
                </v-alert>

                <div
                  v-if="installing || state.progress.items.length || state.progress.status"
                  class="progress-summary mb-6"
                >
                  <div class="progress-summary__header">
                    <div class="progress-summary__title">
                      <span class="text-subtitle-2 font-weight-medium">
                        {{ state.progress.status || 'Installing services' }}
                      </span>
                      <span
                        v-if="state.progress.percent != null"
                        class="text-body-2 text-medium-emphasis ml-2"
                      >
                        {{ Math.round(state.progress.percent) }}%
                      </span>
                    </div>
                    <v-btn
                      variant="text"
                      size="small"
                      color="primary"
                      class="progress-summary__toggle"
                      @click="showProgressDetails = !showProgressDetails"
                    >
                      <v-icon
                        :icon="showProgressDetails ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                        size="18"
                        class="mr-1"
                      />
                      {{ showProgressDetails ? 'Hide logs' : 'Show details' }}
                    </v-btn>
                  </div>
                  <ul
                    v-if="state.progress.items.length"
                    class="progress-summary__list"
                  >
                    <li
                      v-for="item in state.progress.items"
                      :key="`${item.label}-${item.status}`"
                      class="progress-summary__item"
                    >
                      <span class="progress-summary__label text-body-2 font-weight-medium">
                        {{ item.label }}
                      </span>
                      <span class="progress-summary__status text-body-2 text-medium-emphasis">
                        {{ item.status }}
                      </span>
                    </li>
                  </ul>
                  <div
                    v-else
                    class="progress-summary__empty text-body-2 text-medium-emphasis"
                  >
                    Progress updates will appear as tasks begin to run.
                  </div>
                  <div v-if="state.progress.error" class="text-caption text-error">
                    {{ state.progress.error }}
                  </div>
                </div>

                <v-expand-transition>
                  <div v-if="showProgressDetails" class="progress-logs mb-6">
                    <div class="progress-logs__header">
                      <span class="text-subtitle-2 font-weight-medium">Installer details</span>
                      <div class="progress-logs__actions">
                        <v-btn
                          variant="text"
                          size="small"
                          color="primary"
                          data-test="show-more-logs"
                          :disabled="!installLogs || progressLogsLoading"
                          :loading="progressLogsLoading && Boolean(installLogs)"
                          @click="showMoreInstallLogs"
                        >
                          Show latest logs
                        </v-btn>
                        <v-btn
                          icon
                          variant="text"
                          size="small"
                          color="primary"
                          :loading="progressLogsLoading && Boolean(installLogs)"
                          :disabled="progressLogsLoading && !installLogs"
                          @click="refreshInstallLogs"
                          aria-label="Refresh installer logs"
                        >
                          <v-icon icon="mdi-refresh" size="18" />
                        </v-btn>
                      </div>
                    </div>
                    <div class="progress-logs__content">
                      <div
                        v-if="progressLogsLoading && !installLogs"
                        class="progress-logs__loading text-body-2 text-medium-emphasis"
                      >
                        <v-progress-circular
                          indeterminate
                          size="18"
                          color="primary"
                          class="mr-2"
                        />
                        Fetching installer updates…
                      </div>
                      <pre
                        v-else-if="installLogs"
                        class="progress-logs__body"
                      >{{ installLogs }}</pre>
                      <div v-else class="progress-logs__empty text-body-2 text-medium-emphasis">
                        Logs will appear once the installer shares updates.
                      </div>
                    </div>
                    <div
                      v-if="state.progress.logError"
                      class="progress-logs__error text-caption text-error mt-3"
                    >
                      We couldn't load the installer logs. {{ state.progress.logError }}
                    </div>
                  </div>
                </v-expand-transition>

                <div class="setup-step mt-6">
                  <h3 class="text-h6 font-weight-bold mb-1">
                    {{ currentStep.label }}
                  </h3>
                  <p class="text-body-2 text-medium-emphasis mb-4">
                    {{ currentStep.summary }}
                  </p>

                  <div v-if="!currentStepServices.length" class="text-body-2">
                    No services are available for this step.
                  </div>

                  <div v-else class="setup-step__cards">
                    <v-card
                      v-for="service in currentStepServices"
                      :key="service.name"
                      class="setup-service-card"
                      :class="{
                        'setup-service-card--selected': selectedSet.has(service.name),
                        'setup-service-card--locked': isServiceLocked(service),
                        'setup-service-card--disabled': isCardDisabled(service),
                      }"
                      variant="tonal"
                      color="primary"
                    >
                      <div class="setup-service-card__header" @click="toggleCardExpansion(service)">
                        <div class="setup-service-card__title">
                          <span class="text-subtitle-1 font-weight-medium">{{ service.name }}</span>
                          <v-chip
                            v-if="isServiceInstalled(service)"
                            color="success"
                            size="x-small"
                            variant="tonal"
                            class="text-uppercase font-weight-bold ml-2"
                          >
                            <v-icon icon="mdi-check-circle-outline" size="small" class="mr-1" />
                            Installed
                          </v-chip>
                          <v-chip
                            v-else-if="isServiceLocked(service)"
                            color="error"
                            size="x-small"
                            variant="tonal"
                            class="text-uppercase font-weight-bold ml-2"
                          >
                            <v-icon icon="mdi-lock" size="small" class="mr-1" />
                            Required
                          </v-chip>
                          <v-chip
                            v-else-if="isServiceBlocked(service)"
                            color="warning"
                            size="x-small"
                            variant="tonal"
                            class="text-uppercase font-weight-bold ml-2"
                          >
                            <v-icon icon="mdi-alert" size="small" class="mr-1" />
                            Dependencies pending
                          </v-chip>
                        </div>
                        <v-checkbox
                          :model-value="selectedSet.has(service.name)"
                          density="compact"
                          hide-details
                          color="primary"
                          class="setup-service-card__checkbox"
                          :disabled="isServiceLocked(service) || isCardDisabled(service)"
                          @click.stop="toggleService(service.name)"
                          @keydown.enter.stop.prevent="toggleService(service.name)"
                          @keydown.space.stop.prevent="toggleService(service.name)"
                        />
                      </div>

                      <div class="setup-service-card__body" @click="toggleCardExpansion(service)">
                        <p class="text-body-2 mb-2">
                          {{ service.description || 'Service configuration' }}
                        </p>
                        <div v-if="isServiceBlocked(service)" class="text-body-2 text-error mb-2">
                          Requires {{ missingDependencies(service.name).join(' & ') }} first.
                        </div>
                        <div v-if="service.hostServiceUrl" class="text-body-2 text-medium-emphasis">
                          Host URL: {{ service.hostServiceUrl }}
                        </div>
                      </div>

                      <v-expand-transition>
                        <div
                          v-if="isCardExpanded(service.name)"
                          class="setup-service-card__env pa-4"
                        >
                          <div
                            v-if="service.name === PORTAL_SERVICE_NAME"
                            class="portal-discord__section mb-4"
                          >
                            <v-alert
                              type="info"
                              variant="tonal"
                              border="start"
                              class="mb-4"
                            >
                              Connect the Portal Discord bot before configuring guild resources.
                            </v-alert>
                            <v-row dense class="portal-discord__credentials">
                              <v-col cols="12" md="6">
                                <v-text-field
                                  v-model="envForms[service.name][PORTAL_DISCORD_TOKEN_KEY]"
                                  label="Discord Bot Token"
                                  :disabled="installing || portalDiscordState.verifying"
                                  data-test="portal-token"
                                />
                              </v-col>
                              <v-col cols="12" md="4">
                                <v-text-field
                                  v-model="envForms[service.name][PORTAL_DISCORD_GUILD_KEY]"
                                  label="Discord Guild ID"
                                  :disabled="installing || portalDiscordState.verifying"
                                  data-test="portal-guild"
                                />
                              </v-col>
                              <v-col cols="12" md="2" class="d-flex align-center">
                                <v-btn
                                  color="primary"
                                  block
                                  :loading="portalDiscordState.verifying"
                                  :disabled="!canValidatePortalDiscord || installing"
                                  data-test="portal-connect"
                                  @click.stop.prevent="connectPortalDiscord"
                                >
                                  {{ portalDiscordState.verified ? 'Reconnect' : 'Connect' }}
                                </v-btn>
                              </v-col>
                            </v-row>
                            <div
                              v-if="portalDiscordState.error"
                              class="text-body-2 text-error mt-2"
                              data-test="portal-error"
                            >
                              {{ portalDiscordState.error }}
                            </div>
                            <v-alert
                              v-else-if="portalDiscordState.verified"
                              type="success"
                              variant="tonal"
                              border="start"
                              class="mt-2"
                              data-test="portal-success"
                            >
                              Connected to
                              {{ portalDiscordState.guild?.name || 'Discord guild' }}
                              <span
                                v-if="portalDiscordState.guild?.id"
                                class="text-medium-emphasis"
                              >
                                ({{ portalDiscordState.guild.id }})
                              </span>
                              . Roles and channels are ready below.
                            </v-alert>
                          </div>
                          <div
                            v-if="getServiceEnvFields(service).length === 0"
                            class="text-body-2 text-medium-emphasis"
                          >
                            This service does not expose configurable environment variables.
                          </div>
                          <v-row v-else dense>
                            <v-col
                              v-for="field in getServiceEnvFields(service)"
                              :key="field.key"
                              cols="12"
                              md="6"
                            >
                              <v-select
                                v-if="shouldRenderPortalResourceSelect(service, field)"
                                v-model="envForms[service.name][field.key]"
                                :label="field.label || field.key"
                                :items="getPortalSelectItems(field)"
                                item-title="title"
                                item-value="value"
                                :disabled="
                                  installing ||
                                  field.readOnly ||
                                  isPortalFieldLocked(field)
                                "
                                :hint="field.description || field.warning || ''"
                                :persistent-hint="Boolean(field.description || field.warning)"
                                :data-test="`portal-resource-${field.key}`"
                                clearable
                              />
                              <v-select
                                v-else-if="isBooleanField(service.name, field)"
                                v-model="envForms[service.name][field.key]"
                                :label="field.label || field.key"
                                :items="BOOLEAN_OPTIONS"
                                :disabled="
                                  installing ||
                                  field.readOnly ||
                                  (service.name === PORTAL_SERVICE_NAME &&
                                    isPortalFieldLocked(field))
                                "
                                :hint="field.description || field.warning || ''"
                                :persistent-hint="Boolean(field.description || field.warning)"
                                data-test="boolean-select"
                              />
                              <v-text-field
                                v-else
                                v-model="envForms[service.name][field.key]"
                                :label="
                                  field.readOnly
                                    ? `${field.label || field.key} (read only)`
                                    : field.label || field.key
                                "
                                :hint="field.description || field.warning || ''"
                                :persistent-hint="Boolean(field.description || field.warning)"
                                :readonly="field.readOnly"
                                :disabled="
                                  installing ||
                                  (service.name === PORTAL_SERVICE_NAME &&
                                    isPortalFieldLocked(field))
                                "
                                :data-test="
                                  service.name === PORTAL_SERVICE_NAME
                                    ? `portal-field-${field.key}`
                                    : undefined
                                "
                              />
                              <div
                                v-if="
                                  service.name === PORTAL_SERVICE_NAME &&
                                  field.key.endsWith(PORTAL_ROLE_SUFFIX)
                                "
                                class="portal-discord__creator mt-2"
                              >
                                <v-row dense>
                                  <v-col cols="12" md="8">
                                    <v-text-field
                                      v-model="portalDiscordState.createRole.name"
                                      label="Create new role"
                                      density="compact"
                                      :disabled="
                                        installing ||
                                        !portalDiscordReady ||
                                        portalDiscordState.createRole.loading
                                      "
                                      data-test="portal-create-role-name"
                                    />
                                  </v-col>
                                  <v-col cols="12" md="4" class="d-flex align-center">
                                    <v-btn
                                      color="primary"
                                      variant="text"
                                      class="portal-discord__create"
                                      :loading="portalDiscordState.createRole.loading"
                                      :disabled="installing || !portalDiscordReady"
                                      data-test="portal-create-role"
                                      @click.stop.prevent="handleCreatePortalRole(field.key)"
                                    >
                                      Create role
                                    </v-btn>
                                  </v-col>
                                </v-row>
                                <div
                                  v-if="portalDiscordState.createRole.error"
                                  class="text-caption text-error mt-1"
                                  data-test="portal-create-role-error"
                                >
                                  {{ portalDiscordState.createRole.error }}
                                </div>
                              </div>
                              <div
                                v-if="
                                  service.name === PORTAL_SERVICE_NAME &&
                                  field.key.endsWith(PORTAL_CHANNEL_SUFFIX)
                                "
                                class="portal-discord__creator mt-2"
                              >
                                <v-row dense>
                                  <v-col cols="12" md="8">
                                    <v-text-field
                                      v-model="portalDiscordState.createChannel.name"
                                      label="Create new channel"
                                      density="compact"
                                      :disabled="
                                        installing ||
                                        !portalDiscordReady ||
                                        portalDiscordState.createChannel.loading
                                      "
                                      data-test="portal-create-channel-name"
                                    />
                                  </v-col>
                                  <v-col cols="12" md="4" class="d-flex align-center">
                                    <v-btn
                                      color="primary"
                                      variant="text"
                                      class="portal-discord__create"
                                      :loading="portalDiscordState.createChannel.loading"
                                      :disabled="installing || !portalDiscordReady"
                                      data-test="portal-create-channel"
                                      @click.stop.prevent="handleCreatePortalChannel(field.key)"
                                    >
                                      Create channel
                                    </v-btn>
                                  </v-col>
                                </v-row>
                                <div
                                  v-if="portalDiscordState.createChannel.error"
                                  class="text-caption text-error mt-1"
                                  data-test="portal-create-channel-error"
                                >
                                  {{ portalDiscordState.createChannel.error }}
                                </div>
                              </div>
                            </v-col>
                          </v-row>
                        </div>
                      </v-expand-transition>
                    </v-card>
                  </div>

                  <div v-if="installError" class="text-body-2 text-error mt-4">
                    {{ installError }}
                  </div>

                  <v-alert
                    v-if="showInstallResults"
                    type="info"
                    variant="tonal"
                    class="mt-4"
                    border="start"
                  >
                    <p class="font-weight-medium mb-2">
                      Installation summary (status {{ installResults.status }}):
                    </p>
                    <ul class="pl-4">
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

                  <div class="setup-step__actions mt-6">
                    <div
                      v-if="installing && installStepServices.length"
                      class="setup-step__progress"
                      role="status"
                      aria-live="polite"
                    >
                      <v-progress-linear
                        class="setup-step__progress-bar"
                        color="primary"
                        height="6"
                        indeterminate
                        aria-label="Installing selected services"
                      />
                      <span class="text-body-2 text-medium-emphasis">
                        Installing selected services…
                      </span>
                    </div>

                    <div v-if="hasStepInfo" class="setup-step__info">
                      <v-btn
                        variant="text"
                        size="small"
                        color="primary"
                        class="setup-step__info-toggle"
                        data-test="step-info-toggle"
                        @click="showStepInfo = !showStepInfo"
                      >
                        <v-icon
                          :icon="showStepInfo ? 'mdi-information-off-outline' : 'mdi-information-outline'"
                          size="18"
                          class="mr-2"
                        />
                        {{ showStepInfo ? 'Hide info' : 'Show more info' }}
                      </v-btn>
                      <v-expand-transition>
                        <div v-if="showStepInfo" class="setup-step__info-panel">
                          <v-alert
                            v-for="(entry, index) in currentStepInfoEntries"
                            :key="`info-${currentStep.key}-${index}`"
                            type="info"
                            variant="tonal"
                            border="start"
                            class="mb-2"
                          >
                            <p class="font-weight-medium mb-1">{{ entry.title }}</p>
                            <p class="text-body-2 mb-0">{{ entry.description }}</p>
                          </v-alert>
                          <template v-if="currentStep.key === 'portal'">
                            <v-alert
                              v-if="portalAction.loading"
                              type="info"
                              variant="tonal"
                              border="start"
                              class="mb-2"
                            >
                              Verifying Portal bot connection…
                            </v-alert>
                            <v-alert
                              v-else-if="portalAction.success"
                              type="success"
                              variant="tonal"
                              border="start"
                              class="mb-2"
                              data-test="portal-success"
                            >
                              Portal bot verified successfully.
                            </v-alert>
                            <v-alert
                              v-else-if="portalAction.error"
                              type="error"
                              variant="tonal"
                              border="start"
                              class="mb-2"
                            >
                              {{ portalAction.error }}
                            </v-alert>
                          </template>
                        </div>
                      </v-expand-transition>
                    </div>

                    <div v-if="currentStep.key === 'raven'" class="setup-step__action mb-4">
                      <v-alert
                        v-if="!ravenDependenciesReady"
                        type="warning"
                        variant="tonal"
                        border="start"
                        class="mb-4"
                      >
                        Raven requires
                        <span class="font-weight-medium">
                          {{ ravenMissingDependencyLabels.join(' & ') }}
                        </span>
                        before it can be installed. Install the missing services and try again.
                      </v-alert>

                      <div class="raven-handshake">
                        <div class="raven-handshake__header">
                          <h3 class="raven-handshake__title">Connect Raven with Sage</h3>
                          <p class="raven-handshake__subtitle">
                            Moon relays all Raven traffic through Sage. Run the handshake so Sage can validate Portal, Vault,
                            and Raven before enabling insights.
                          </p>
                        </div>

                        <v-alert
                          type="info"
                          variant="tonal"
                          border="start"
                          class="raven-handshake__hint mb-4"
                        >
                          Sage coordinates Raven installs and verification. Manual overrides from the Raven environment form
                          are applied automatically.
                        </v-alert>

                        <div class="raven-progress" role="status" aria-live="polite">
                          <div
                            v-for="entry in ravenPhaseEntries"
                            :key="entry.key"
                            class="raven-progress__item"
                            :class="`raven-progress__item--${entry.state}`"
                            :aria-label="`${entry.label}: ${entry.state}`"
                          >
                            <div class="raven-progress__icon" aria-hidden="true">
                              <v-icon
                                v-if="entry.state === 'success'"
                                icon="mdi-check-circle-outline"
                                color="success"
                                size="22"
                              />
                              <v-icon
                                v-else-if="entry.state === 'error'"
                                icon="mdi-alert-circle-outline"
                                color="error"
                                size="22"
                              />
                              <v-progress-circular
                                v-else-if="entry.state === 'running'"
                                :size="20"
                                :width="3"
                                color="primary"
                                indeterminate
                              />
                              <v-icon
                                v-else
                                icon="mdi-progress-clock"
                                size="22"
                                class="text-medium-emphasis"
                              />
                            </div>
                            <div class="raven-progress__body">
                              <p class="raven-progress__label">{{ entry.label }}</p>
                              <p class="raven-progress__message">{{ entry.message }}</p>
                            </div>
                          </div>
                        </div>

                        <div class="raven-handshake__actions">
                          <v-btn
                            color="primary"
                            class="raven-handshake__primary"
                            :loading="ravenAction.loading"
                            :disabled="installing || !ravenDependenciesReady"
                            @click="runRavenHandshake"
                          >
                            <template v-if="ravenAction.loading">
                              Contacting Sage…
                            </template>
                            <template v-else>
                              {{ ravenActionButtonLabel }}
                            </template>
                          </v-btn>
                          <v-btn
                            variant="text"
                            class="raven-handshake__refresh"
                            :disabled="installing || ravenAction.loading"
                            @click="refreshRavenStatus"
                          >
                            Refresh status
                          </v-btn>
                        </div>

                        <div v-if="ravenAction.error" class="text-body-2 text-error mt-3">
                          {{ ravenAction.error }}
                        </div>
                        <div
                          v-else-if="ravenAction.message"
                          class="text-body-2 text-medium-emphasis mt-3"
                        >
                          {{ ravenAction.message }}
                        </div>
                      </div>
                    </div>

                  <div class="setup-step__buttons">
                      <v-btn
                        color="primary"
                        class="setup-step__install"
                        :disabled="!canInstallCurrentStep"
                        size="large"
                        @click="installCurrentStep"
                      >
                        <template v-if="installing">
                          Installing…
                        </template>
                        <template v-else>
                          Install {{ currentStepInstallableCount ? 'Services' : 'Step' }}
                          <span v-if="installStepServices.length" class="ml-2 font-weight-bold">
                            ({{ installStepServices.length }})
                          </span>
                        </template>
                      </v-btn>
                      <v-btn
                        v-if="activeStepIndex < STEP_DEFINITIONS.length - 1"
                        variant="text"
                        class="setup-step__next"
                        :disabled="!canGoToNextStep"
                        @click="goToNextStep"
                      >
                        Next step
                      </v-btn>
                    </div>
                  </div>
                </div>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </Header>
</template>

<style scoped>
.setup-loading {
  width: 100%;
}

.wizard-overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wizard-overview__progress {
  display: flex;
  flex-direction: column;
}

.wizard-overview__completion {
  margin-top: 4px;
}

.wizard-overview__portal {
  margin-top: 4px;
}

.wizard-overview__message,
.wizard-overview__hint {
  line-height: 1.4;
}

.setup-stepper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.setup-stepper__item {
  justify-content: flex-start;
  align-items: flex-start;
  padding: 12px;
  text-transform: none;
}

.setup-stepper__item--active {
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.35);
}

.setup-stepper__item--complete {
  border-left: 4px solid rgba(var(--v-theme-success), 0.6);
}

.setup-stepper__index {
  font-weight: 700;
  font-size: 1.125rem;
  margin-right: 12px;
}

.setup-stepper__body {
  flex: 1;
  text-align: left;
}

.progress-summary {
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 12px;
  padding: 16px;
  background: rgba(var(--v-theme-primary), 0.05);
}

.progress-summary__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.progress-summary__title {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.progress-summary__toggle {
  text-transform: none;
  letter-spacing: normal;
}

.progress-summary__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-summary__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.06);
}

.progress-summary__label {
  flex: 1 1 auto;
}

.progress-summary__status {
  white-space: nowrap;
}

.progress-summary__empty {
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.04);
}

.progress-logs {
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 12px;
  padding: 16px;
  background: rgba(var(--v-theme-primary), 0.02);
}

.progress-logs__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.progress-logs__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.progress-logs__content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-logs__loading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-logs__body {
  margin: 0;
  white-space: pre-wrap;
  font-family: 'Fira Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.85rem;
  padding: 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-primary), 0.04);
}

.raven-handshake {
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  border-radius: 12px;
  padding: 20px;
  background: rgba(var(--v-theme-primary), 0.03);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.raven-handshake__header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.raven-handshake__title {
  margin: 0;
  font-weight: 600;
  font-size: 1.125rem;
}

.raven-handshake__subtitle {
  margin: 0;
  font-size: 0.95rem;
  color: rgba(var(--v-theme-on-surface), 0.72);
  line-height: 1.45;
}

.raven-handshake__hint {
  margin-top: -4px;
}

.raven-progress {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.raven-progress__item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--v-theme-primary), 0.08);
  background: rgba(var(--v-theme-primary), 0.03);
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.raven-progress__item--running {
  border-color: rgba(var(--v-theme-primary), 0.32);
  background: rgba(var(--v-theme-primary), 0.08);
}

.raven-progress__item--success {
  border-color: rgba(var(--v-theme-success), 0.35);
  background: rgba(var(--v-theme-success), 0.08);
}

.raven-progress__item--error {
  border-color: rgba(var(--v-theme-error), 0.4);
  background: rgba(var(--v-theme-error), 0.08);
}

.raven-progress__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  min-width: 28px;
  height: 28px;
}

.raven-progress__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.raven-progress__label {
  margin: 0;
  font-weight: 600;
}

.raven-progress__message {
  margin: 0;
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  line-height: 1.4;
}

.raven-handshake__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
}

.raven-handshake__primary {
  min-width: 220px;
}

.raven-handshake__refresh {
  text-transform: none;
}

.progress-logs__empty {
  min-height: 24px;
}

.progress-logs__error {
  line-height: 1.4;
}

.setup-step__cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.setup-service-card {
  cursor: pointer;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

.setup-service-card--selected {
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-primary), 0.35);
}

.setup-service-card--locked {
  cursor: default;
}

.setup-service-card--disabled {
  opacity: 0.7;
}

.setup-service-card__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
}

.setup-service-card__title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.setup-service-card__checkbox {
  margin-right: -8px;
}

.setup-service-card__body {
  padding: 0 16px 16px;
}

.setup-service-card__env {
  background: rgba(var(--v-theme-primary), 0.08);
  border-top: 1px solid rgba(var(--v-theme-primary), 0.18);
}

.portal-discord__section {
  background: rgba(var(--v-theme-surface), 0.04);
  border-radius: 12px;
  padding: 12px;
}

.portal-discord__credentials {
  gap: 8px;
}

.portal-discord__creator {
  background: rgba(var(--v-theme-surface), 0.03);
  border-radius: 8px;
  padding: 8px 12px;
}

.portal-discord__create {
  width: 100%;
}

.setup-step__actions {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.setup-step__info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setup-step__info-toggle {
  align-self: flex-start;
  padding-left: 0;
}

.setup-step__info-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setup-step__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.setup-step__install {
  min-width: 220px;
}

.setup-step__progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.setup-step__progress-bar {
  width: 280px;
  max-width: 100%;
}

@media (max-width: 720px) {
  .setup-stepper {
    gap: 8px;
  }

  .setup-step__cards {
    grid-template-columns: 1fr;
  }
}
</style>
