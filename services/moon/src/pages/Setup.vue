<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import Header from '../components/Header.vue';
import { buildServiceEndpointCandidates } from '../utils/serviceEndpoints.js';
import { isServiceRequired, mergeRequiredSelections } from '../utils/serviceSelection.js';
import {
  createPortalDiscordChannel,
  createPortalDiscordRole,
  validatePortalDiscordConfig,
} from '../utils/portalDiscordSetup.js';

const DEFAULT_INSTALL_ENDPOINT = '/api/setup/install';
const INSTALL_PROGRESS_ENDPOINT = '/api/setup/services/install/progress';
const INSTALL_LOGS_ENDPOINT = '/api/setup/services/installation/logs?limit=200';
const PORTAL_TEST_ENDPOINT = '/api/setup/services/noona-portal/test';
const RAVEN_DETECT_ENDPOINT = '/api/setup/services/noona-raven/detect';
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
const PORTAL_CREDENTIAL_KEYS = new Set([
  PORTAL_DISCORD_TOKEN_KEY,
  PORTAL_DISCORD_GUILD_KEY,
]);

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

const envForms = reactive({});
const selectedServices = ref([]);
const expandedCards = ref([]);
const installEndpoint = ref(DEFAULT_INSTALL_ENDPOINT);
const installing = ref(false);
const installError = ref('');
const installResults = ref(null);
const installSuccessMessageVisible = ref(false);
const installLogs = ref('');
const showProgressDetails = ref(false);
const activeStepIndex = ref(0);

const portalAction = reactive({
  loading: false,
  success: false,
  error: '',
});

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
});

let progressPollHandle = null;

const installableServices = computed(() =>
  state.services.filter((service) => service.installed !== true),
);

const serviceMap = computed(() => {
  const map = new Map();
  for (const service of state.services) {
    if (service?.name) {
      map.set(service.name, service);
    }
  }
  return map;
});

const installableNameSet = computed(
  () => new Set(installableServices.value.map((service) => service.name)),
);

const normalizedSelection = computed(() =>
  selectedServices.value.filter((name) => installableNameSet.value.has(name)),
);

const selectedSet = computed(() => new Set(normalizedSelection.value));

const installedSet = computed(() => {
  const installed = new Set();
  for (const service of state.services) {
    if (service?.name && service.installed === true) {
      installed.add(service.name);
    }
  }
  return installed;
});

const currentStep = computed(() => STEP_DEFINITIONS[activeStepIndex.value]);

const portalEnvForm = computed(
  () => envForms[PORTAL_SERVICE_NAME] ?? {},
);

const portalService = computed(() => serviceMap.value.get(PORTAL_SERVICE_NAME));

const hasPortalService = computed(() => Boolean(portalService.value));

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

const currentStepServices = computed(() => getStepServices(currentStep.value.key));

const currentStepSelectableServices = computed(() =>
  currentStepServices.value.filter((service) =>
    selectedSet.value.has(service.name) && service.installed !== true,
  ),
);

const canInstallCurrentStep = computed(
  () => currentStepSelectableServices.value.length > 0 && !installing.value,
);

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

const isPortalResourceField = (field) => {
  if (!field || typeof field.key !== 'string') {
    return false;
  }

  return (
    field.key.endsWith(PORTAL_ROLE_SUFFIX) ||
    field.key.endsWith(PORTAL_CHANNEL_SUFFIX)
  );
};

const shouldRenderPortalResourceSelect = (service, field) =>
  service?.name === PORTAL_SERVICE_NAME && isPortalResourceField(field);

const getPortalSelectItems = (field) => {
  if (!isPortalResourceField(field)) {
    return [];
  }

  if (field.key.endsWith(PORTAL_ROLE_SUFFIX)) {
    return portalRoleOptions.value;
  }

  if (field.key.endsWith(PORTAL_CHANNEL_SUFFIX)) {
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
    const payload = await validatePortalDiscordConfig({ token, guildId });
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
    const role = await createPortalDiscordRole({
      token: portalDiscordState.lastVerifiedToken,
      guildId: portalDiscordState.lastVerifiedGuildId,
      name,
    });

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
    const channel = await createPortalDiscordChannel({
      token: portalDiscordState.lastVerifiedToken,
      guildId: portalDiscordState.lastVerifiedGuildId,
      name,
      type: portalDiscordState.createChannel.type,
    });

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

const resetProgressState = () => {
  state.progress.items = [];
  state.progress.percent = null;
  state.progress.status = '';
  state.progress.error = '';
  state.progress.logError = '';
  installLogs.value = '';
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
  resetPortalDiscordState();

  const errors = [];
  const previousSelection = new Set(selectedServices.value);

  try {
    for (const endpoint of SERVICE_ENDPOINTS) {
      try {
        const services = await loadServicesFromEndpoint(endpoint);
        state.services = services;
        syncEnvForms(services);
        installEndpoint.value = deriveInstallEndpoint(endpoint);

        for (const service of services) {
          if (
            ALWAYS_SELECTED_SERVICES.has(service.name) &&
            service.installed !== true
          ) {
            previousSelection.add(service.name);
          }
        }

        selectedServices.value = mergeRequiredSelections(
          services,
          Array.from(previousSelection),
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
  service.installed === true ||
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
  if (!service || service.installed === true) {
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
    const response = await fetch(INSTALL_PROGRESS_ENDPOINT);
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

const fetchInstallLogs = async () => {
  try {
    const response = await fetch(INSTALL_LOGS_ENDPOINT);
    if (!response.ok) {
      throw new Error(`Log request failed with status ${response.status}`);
    }

    const payload = await response.json().catch(() => ({}));
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const formatted = entries
      .map(formatLogEntry)
      .filter((line) => typeof line === 'string' && line.length > 0);
    installLogs.value = formatted.join('\n');
    state.progress.logError = '';
  } catch (error) {
    state.progress.logError = error instanceof Error ? error.message : String(error);
  }
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
    if (installing.value) {
      progressPollHandle = setTimeout(run, 2000);
    }
  };

  void run();
};

const installStepServices = computed(() =>
  currentStepSelectableServices.value.map((service) => service.name),
);

const installCurrentStep = async () => {
  if (installing.value) return;
  if (!installStepServices.value.length) return;

  installing.value = true;
  installError.value = '';
  installResults.value = null;
  installSuccessMessageVisible.value = false;
  resetProgressState();
  scheduleProgressPolling();

  const descriptors = currentStepSelectableServices.value;
  const servicePayload = descriptors.map((service) => {
    const env = buildEnvPayload(service);
    if (!Object.keys(env).length) {
      return { name: service.name };
    }

    return { name: service.name, env };
  });

  try {
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
      return;
    }

    const successful = new Set(
      results
        .filter((item) => item && item.status === 'installed' && item.name)
        .map((item) => item.name),
    );

    const remaining = normalizedSelection.value.filter(
      (name) => !successful.has(name),
    );
    selectedServices.value = mergeRequiredSelections(
      state.services,
      Array.from(new Set([...remaining, ...ALWAYS_SELECTED_SERVICES])),
    );

    await refreshServices();

    if (currentStep.value.key === 'raven') {
      installSuccessMessageVisible.value = true;
    }
  } catch (error) {
    installError.value = error instanceof Error ? error.message : String(error);
  } finally {
    installing.value = false;
    stopProgressPolling();
  }
};

const startPortalTest = async () => {
  if (portalAction.loading || installing.value) return;

  portalAction.loading = true;
  portalAction.error = '';

  try {
    const response = await fetch(PORTAL_TEST_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error || `Portal test failed with status ${response.status}`);
    }

    if (payload?.success !== true) {
      throw new Error(payload?.error || 'Portal test did not succeed.');
    }

    portalAction.success = true;
  } catch (error) {
    portalAction.error = error instanceof Error ? error.message : String(error);
  } finally {
    portalAction.loading = false;
  }
};

const runRavenHandshake = async () => {
  if (ravenAction.loading || installing.value) return;

  ravenAction.loading = true;
  ravenAction.error = '';

  try {
    const response = await fetch(RAVEN_DETECT_ENDPOINT, { method: 'POST' });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error || `Raven detection failed with status ${response.status}`);
    }

    const detection = payload?.detection ?? null;
    if (!detection || !detection.mountPath) {
      throw new Error('Kavita data mount not detected yet.');
    }

    ravenAction.success = true;
  } catch (error) {
    ravenAction.error = error instanceof Error ? error.message : String(error);
  } finally {
    ravenAction.loading = false;
  }
};

const isStepInstalled = (stepKey) => {
  const services = getStepServices(stepKey);
  if (!services.length) return true;
  return services.every((service) => service.installed === true);
};

const isStepActionComplete = (stepKey) => {
  if (stepKey === 'portal') return portalAction.success;
  if (stepKey === 'raven') return ravenAction.success;
  return true;
};

const isStepComplete = (stepKey) =>
  isStepInstalled(stepKey) && isStepActionComplete(stepKey);

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
  activeStepIndex.value = index;
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
  () => currentStepServices.value.filter((service) => service.installed !== true).length,
);

const showInstallResults = computed(() =>
  installResults.value && Array.isArray(installResults.value.results) && installResults.value.results.length > 0,
);

watch(installing, (value) => {
  if (!value) {
    stopProgressPolling();
  }
});

watch(showProgressDetails, (value) => {
  if (value) {
    void fetchInstallLogs();
  }
});

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
                  <v-btn color="error" variant="text" @click="refreshServices">
                    Retry
                  </v-btn>
                </template>
              </v-alert>

              <div v-else>
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
                    <div>
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
                      class="text-caption"
                      @click="showProgressDetails = !showProgressDetails"
                    >
                      See {{ showProgressDetails ? 'less' : 'more' }}
                    </v-btn>
                  </div>
                  <ul class="progress-summary__list">
                    <li
                      v-for="item in state.progress.items"
                      :key="`${item.label}-${item.status}`"
                      class="text-body-2"
                    >
                      <span class="font-weight-medium">{{ item.label }}</span>
                      <span class="ml-2 text-medium-emphasis">{{ item.status }}</span>
                    </li>
                  </ul>
                  <div v-if="state.progress.error" class="text-caption text-error">
                    {{ state.progress.error }}
                  </div>
                </div>

                <v-expand-transition>
                  <div v-if="showProgressDetails" class="progress-logs mb-6">
                    <pre
                      v-if="installLogs"
                      class="progress-logs__body"
                    >{{ installLogs }}</pre>
                    <div v-else class="text-body-2 text-medium-emphasis">
                      Logs will appear once the installer shares updates.
                    </div>
                    <div v-if="state.progress.logError" class="text-caption text-error mt-2">
                      {{ state.progress.logError }}
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
                            v-if="service.installed === true"
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
                    <div v-if="installing" class="setup-step__progress" role="status" aria-live="polite">
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

                    <div v-if="currentStep.key === 'portal'" class="setup-step__action mb-4">
                      <v-alert type="info" variant="tonal" border="start" class="mb-2">
                        Start the Portal bot and verify it responds before continuing to Raven.
                      </v-alert>
                      <v-btn
                        color="primary"
                        :loading="portalAction.loading"
                        :disabled="installing || !isStepInstalled('portal') || portalAction.success"
                        @click="startPortalTest"
                      >
                        <template v-if="portalAction.success">
                          Portal bot verified
                        </template>
                        <template v-else>
                          Start &amp; Test Portal Bot
                        </template>
                      </v-btn>
                      <div v-if="portalAction.error" class="text-body-2 text-error mt-2">
                        {{ portalAction.error }}
                      </div>
                    </div>

                    <div v-if="currentStep.key === 'raven'" class="setup-step__action mb-4">
                      <v-alert type="info" variant="tonal" border="start" class="mb-2">
                        Trigger the Raven handshake to complete installation.
                      </v-alert>
                      <v-btn
                        color="primary"
                        :loading="ravenAction.loading"
                        :disabled="installing || !isStepInstalled('raven') || ravenAction.success"
                        @click="runRavenHandshake"
                      >
                        <template v-if="ravenAction.success">
                          Raven handshake complete
                        </template>
                        <template v-else>
                          Run Raven Check
                        </template>
                      </v-btn>
                      <div v-if="ravenAction.error" class="text-body-2 text-error mt-2">
                        {{ ravenAction.error }}
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
                          Install {{ currentStepInstallableCount ? 'Step' : 'Services' }}
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

.progress-summary__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-logs {
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 12px;
  padding: 16px;
  background: rgba(var(--v-theme-primary), 0.02);
}

.progress-logs__body {
  margin: 0;
  white-space: pre-wrap;
  font-family: 'Fira Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.85rem;
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
