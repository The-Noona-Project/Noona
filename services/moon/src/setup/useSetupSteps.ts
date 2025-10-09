import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useServiceInstallation } from '../state/serviceInstallationContext.tsx';
import type { ServiceEntry } from '../utils/serviceStatus.ts';
import {
  createPortalDiscordChannel,
  createPortalDiscordRole,
  detectRavenMount,
  fetchInstallProgress,
  fetchInstallationLogs,
  fetchServiceLogs,
  installServices,
  type InstallLogsResponse,
  type InstallProgressSummary,
  type PortalDiscordValidationPayload,
  type ServiceInstallRequestEntry,
  validatePortalDiscordConfig,
} from './api.ts';

export type SetupStepId = 'select' | 'configure' | 'discord' | 'install' | 'logs';

export type SetupStepStatus = 'current' | 'complete' | 'upcoming' | 'error';

export interface SetupStepDefinition {
  id: SetupStepId;
  title: string;
  description: string;
  optional?: boolean;
  status: SetupStepStatus;
  error?: string | null;
}

export interface SetupService {
  name: string;
  displayName: string;
  description: string;
  installed: boolean;
  recommended: boolean;
  dependencies: string[];
  envConfig: EnvField[];
  metadata: Record<string, unknown>;
}

export interface EnvField {
  key: string;
  label: string;
  description?: string | null;
  warning?: string | null;
  defaultValue: string;
  required: boolean;
  readOnly: boolean;
}

export interface EnvSection {
  service: SetupService;
  fields: EnvFieldViewModel[];
}

export interface EnvFieldViewModel extends EnvField {
  value: string;
  error?: string | null;
}

export interface DiscordState {
  token: string;
  guildId: string;
  roleId: string;
  defaultRoleId: string;
  validating: boolean;
  validation: PortalDiscordValidationPayload | null;
  lastValidatedAt: number | null;
  validationError: string;
  createRoleState: AsyncActionState;
  createChannelState: AsyncActionState;
  onFieldChange: (key: string, value: string) => void;
  onValidate: () => Promise<void>;
  onCreateRole: (name: string) => Promise<void>;
  onCreateChannel: (name: string, type: string) => Promise<void>;
}

export interface AsyncActionState {
  loading: boolean;
  error: string;
  successMessage: string;
}

export interface InstallState {
  started: boolean;
  installing: boolean;
  completed: boolean;
  error: string;
  progressError: string;
  results: Array<Record<string, unknown>>;
  progress: InstallProgressSummary | null;
}

export interface InstallationLogsState {
  limit: number;
  loading: boolean;
  error: string;
  response: InstallLogsResponse | null;
}

export interface ServiceLogState {
  limit: number;
  loading: boolean;
  error: string;
  response: InstallLogsResponse | null;
}

export interface UseSetupStepsResult {
  steps: SetupStepDefinition[];
  currentStep: SetupStepDefinition;
  selectStep: (id: SetupStepId) => void;
  goNext: () => Promise<void>;
  goPrevious: () => void;
  canGoNext: boolean;
  canGoPrevious: boolean;
  nextLabel: string;
  services: SetupService[];
  selected: Set<string>;
  selectionErrors: string[];
  toggleService: (name: string) => void;
  envSections: EnvSection[];
  updateEnvValue: (serviceName: string, key: string, value: string) => void;
  detectRaven: () => Promise<void>;
  detectingRaven: boolean;
  ravenDetectionError: string;
  envErrors: Map<string, string[]>;
  discord: DiscordState;
  install: InstallState;
  loadInstallationLogs: (limit?: number) => Promise<void>;
  installationLogs: InstallationLogsState;
  selectedLogService: string;
  setSelectedLogService: (name: string) => void;
  serviceLogs: Map<string, ServiceLogState>;
  loadServiceLogs: (name: string, limit?: number) => Promise<void>;
}

const STEP_DEFINITIONS: Array<Omit<SetupStepDefinition, 'status' | 'error'>> = [
  {
    id: 'select',
    title: 'Select services',
    description: 'Choose which Noona services should be installed.',
  },
  {
    id: 'configure',
    title: 'Environment variables',
    description: 'Review and customise environment configuration before install.',
  },
  {
    id: 'discord',
    title: 'Discord integration',
    description: 'Validate Portal Discord credentials and bootstrap required resources.',
    optional: true,
  },
  {
    id: 'install',
    title: 'Installer',
    description: 'Launch the installer and monitor progress in real time.',
  },
  {
    id: 'logs',
    title: 'Logs',
    description: 'Inspect aggregated installer and per-service logs.',
  },
];

const PORTAL_SERVICE_NAME = 'noona-portal';
const RAVEN_SERVICE_NAME = 'noona-raven';

function formatDisplayName(name: string): string {
  return name
    .replace(/^noona-/, '')
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function extractDescription(service: ServiceEntry): string {
  const candidates: Array<unknown> = [
    service.description,
    (service.metadata as Record<string, unknown> | undefined)?.description,
    (service.summary as unknown),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return 'Core Noona service.';
}

function extractBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }

  return fallback;
}

function extractDependencies(service: ServiceEntry): string[] {
  const dependencyKeys = ['dependencies', 'dependsOn', 'requires'];
  const dependencies = new Set<string>();

  for (const key of dependencyKeys) {
    const value = (service as Record<string, unknown>)[key];
    if (!value) continue;

    const list = Array.isArray(value) ? value : [value];
    for (const entry of list) {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (trimmed) {
          dependencies.add(trimmed);
        }
      }
    }
  }

  const metadata = (service.metadata ?? {}) as Record<string, unknown>;
  const metadataDeps = metadata.dependencies;
  if (Array.isArray(metadataDeps)) {
    for (const entry of metadataDeps) {
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (trimmed) {
          dependencies.add(trimmed);
        }
      }
    }
  }

  return Array.from(dependencies);
}

function extractEnvConfig(service: ServiceEntry): EnvField[] {
  const raw = (service as Record<string, unknown>).envConfig;
  if (!Array.isArray(raw)) {
    return [];
  }

  const fields: EnvField[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key.trim() : '';
    if (!key) {
      continue;
    }

    const labelCandidate = typeof record.label === 'string' ? record.label.trim() : '';
    fields.push({
      key,
      label: labelCandidate || key,
      description: typeof record.description === 'string' ? record.description : null,
      warning: typeof record.warning === 'string' ? record.warning : null,
      defaultValue: typeof record.defaultValue === 'string' ? record.defaultValue : '',
      required: record.required === undefined ? true : extractBoolean(record.required, true),
      readOnly: extractBoolean(record.readOnly, false),
    });
  }

  return fields;
}

function toSetupService(entry: ServiceEntry): SetupService {
  return {
    name: entry.name,
    displayName: formatDisplayName(entry.name),
    description: extractDescription(entry),
    installed: entry.installed === true,
    recommended: extractBoolean((entry as Record<string, unknown>).recommended ?? true, true),
    dependencies: extractDependencies(entry),
    envConfig: extractEnvConfig(entry),
    metadata: (entry as Record<string, unknown>).metadata as Record<string, unknown>,
  };
}

function initializeEnvOverrides(services: SetupService[]): Map<string, Record<string, string>> {
  const overrides = new Map<string, Record<string, string>>();
  for (const service of services) {
    const initial: Record<string, string> = {};
    for (const field of service.envConfig) {
      initial[field.key] = field.defaultValue ?? '';
    }
    overrides.set(service.name, initial);
  }
  return overrides;
}

function cloneOverrides(
  overrides: Map<string, Record<string, string>>,
): Map<string, Record<string, string>> {
  const next = new Map<string, Record<string, string>>();
  for (const [name, env] of overrides.entries()) {
    next.set(name, { ...env });
  }
  return next;
}

function buildInstallPayload(
  selected: Set<string>,
  overrides: Map<string, Record<string, string>>,
): ServiceInstallRequestEntry[] {
  return Array.from(selected).map((name) => {
    const env = overrides.get(name) ?? {};
    const cleaned: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof key !== 'string') {
        continue;
      }
      cleaned[key] = value ?? '';
    }
    return Object.keys(cleaned).length > 0 ? { name, env: cleaned } : { name };
  });
}

export function useSetupSteps(): UseSetupStepsResult {
  const { services: serviceEntries, ensureLoaded, refresh } = useServiceInstallation();
  const [currentStepId, setCurrentStepId] = useState<SetupStepId>('select');
  const [maxVisitedIndex, setMaxVisitedIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const services = useMemo(() => serviceEntries.map(toSetupService), [serviceEntries]);
  const serviceMap = useMemo(() => new Map(services.map((service) => [service.name, service])), [services]);
  const [overrides, setOverrides] = useState<Map<string, Record<string, string>>>(() =>
    initializeEnvOverrides(services),
  );
  const [detectingRaven, setDetectingRaven] = useState(false);
  const [ravenDetectionError, setRavenDetectionError] = useState('');

  const [discordValidation, setDiscordValidation] = useState<PortalDiscordValidationPayload | null>(null);
  const [discordValidationError, setDiscordValidationError] = useState('');
  const [discordValidating, setDiscordValidating] = useState(false);
  const [discordValidatedAt, setDiscordValidatedAt] = useState<number | null>(null);
  const [createRoleState, setCreateRoleState] = useState<AsyncActionState>({
    loading: false,
    error: '',
    successMessage: '',
  });
  const [createChannelState, setCreateChannelState] = useState<AsyncActionState>({
    loading: false,
    error: '',
    successMessage: '',
  });

  const [install, setInstall] = useState<InstallState>({
    started: false,
    installing: false,
    completed: false,
    error: '',
    progressError: '',
    results: [],
    progress: null,
  });

  const [installationLogs, setInstallationLogs] = useState<InstallationLogsState>({
    limit: 25,
    loading: false,
    error: '',
    response: null,
  });
  const [serviceLogs, setServiceLogs] = useState<Map<string, ServiceLogState>>(
    () => new Map(),
  );
  const [selectedLogService, setSelectedLogService] = useState<string>('installation');

  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    ensureLoaded().catch(() => {});
  }, [ensureLoaded]);

  useEffect(() => {
    setOverrides((prev) => {
      const next = cloneOverrides(prev);
      for (const service of services) {
        if (!next.has(service.name)) {
          const initial: Record<string, string> = {};
          for (const field of service.envConfig) {
            initial[field.key] = field.defaultValue ?? '';
          }
          next.set(service.name, initial);
        } else {
          const existing = next.get(service.name)!;
          for (const field of service.envConfig) {
            if (!(field.key in existing)) {
              existing[field.key] = field.defaultValue ?? '';
            }
          }
        }
      }
      return next;
    });
  }, [services]);

  useEffect(() => {
    setSelected((prev) => {
      if (prev.size > 0) {
        return prev;
      }
      const initial = new Set<string>();
      for (const service of services) {
        if (!service.installed) {
          initial.add(service.name);
        }
      }
      return initial;
    });
  }, [services]);

  const selectionErrors = useMemo(() => {
    const errors: string[] = [];
    if (selected.size === 0) {
      errors.push('Select at least one service to continue.');
    }

    const missingDependencies: string[] = [];
    for (const name of selected) {
      const service = serviceMap.get(name);
      if (!service) continue;
      for (const dep of service.dependencies) {
        if (selected.has(dep)) {
          continue;
        }
        const dependency = serviceMap.get(dep);
        if (dependency?.installed) {
          continue;
        }
        missingDependencies.push(`${service.displayName} requires ${formatDisplayName(dep)}.`);
      }
    }

    if (missingDependencies.length > 0) {
      errors.push(...missingDependencies);
    }

    return errors;
  }, [selected, serviceMap]);

  const envSections = useMemo(() => {
    const sections: EnvSection[] = [];
    for (const name of selected) {
      const service = serviceMap.get(name);
      if (!service) {
        continue;
      }
      const env = overrides.get(name) ?? {};
      const fields: EnvFieldViewModel[] = service.envConfig.map((field) => {
        const value = env[field.key] ?? '';
        const error =
          !field.readOnly && field.required && (!value || !value.trim())
            ? `${field.label} is required.`
            : null;
        return {
          ...field,
          value,
          error,
        };
      });
      sections.push({ service, fields });
    }
    return sections;
  }, [selected, serviceMap, overrides]);

  const envErrors = useMemo(() => {
    const errors = new Map<string, string[]>();
    for (const section of envSections) {
      const messages = section.fields
        .filter((field) => field.error)
        .map((field) => field.error as string);
      if (messages.length > 0) {
        errors.set(section.service.name, messages);
      }
    }
    return errors;
  }, [envSections]);

  const portalEnv = useMemo(() => overrides.get(PORTAL_SERVICE_NAME) ?? {}, [overrides]);
  const portalSelected = selected.has(PORTAL_SERVICE_NAME);

  useEffect(() => {
    setDiscordValidation(null);
    setDiscordValidatedAt(null);
  }, [portalEnv.DISCORD_BOT_TOKEN, portalEnv.DISCORD_GUILD_ID]);

  const updateEnvValue = useCallback(
    (serviceName: string, key: string, value: string) => {
      setOverrides((prev) => {
        const next = cloneOverrides(prev);
        const existing = next.get(serviceName) ?? {};
        next.set(serviceName, { ...existing, [key]: value });
        return next;
      });
    },
    [],
  );

  const detectRaven = useCallback(async () => {
    setDetectingRaven(true);
    setRavenDetectionError('');
    try {
      const payload = await detectRavenMount();
      const detection = (payload?.detection ?? {}) as Record<string, unknown>;
      const containerPath =
        typeof detection.containerPath === 'string'
          ? detection.containerPath
          : typeof detection.appData === 'string'
          ? detection.appData
          : '';
      const hostPath =
        typeof detection.hostPath === 'string'
          ? detection.hostPath
          : typeof detection.kavitaDataMount === 'string'
          ? detection.kavitaDataMount
          : '';
      if (containerPath) {
        updateEnvValue(RAVEN_SERVICE_NAME, 'APPDATA', containerPath);
      }
      if (hostPath) {
        updateEnvValue(RAVEN_SERVICE_NAME, 'KAVITA_DATA_MOUNT', hostPath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to detect Raven mount.';
      setRavenDetectionError(message);
    } finally {
      setDetectingRaven(false);
    }
  }, [updateEnvValue]);

  const toggleService = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const loadInstallationLogs = useCallback(
    async (limit = installationLogs.limit) => {
      setInstallationLogs((prev) => ({ ...prev, loading: true, error: '', limit }));
      try {
        const response = await fetchInstallationLogs(limit);
        setInstallationLogs({ limit, loading: false, error: '', response });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to retrieve installation logs.';
        setInstallationLogs((prev) => ({ ...prev, loading: false, error: message }));
      }
    },
    [installationLogs.limit],
  );

  const loadServiceLogs = useCallback(
    async (name: string, limit?: number) => {
      const nextLimit = limit ?? serviceLogs.get(name)?.limit ?? 25;
      setServiceLogs((prev) => {
        const next = new Map(prev);
        const existing = next.get(name) ?? {
          limit: nextLimit,
          loading: false,
          error: '',
          response: null,
        };
        next.set(name, { ...existing, loading: true, error: '', limit: nextLimit });
        return next;
      });
      try {
        const response = await fetchServiceLogs(name, nextLimit);
        setServiceLogs((prev) => {
          const next = new Map(prev);
          next.set(name, { limit: nextLimit, loading: false, error: '', response });
          return next;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to retrieve service logs.';
        setServiceLogs((prev) => {
          const next = new Map(prev);
          const existing = next.get(name);
          if (existing) {
            next.set(name, { ...existing, loading: false, error: message });
          }
          return next;
        });
      }
    },
    [serviceLogs],
  );

  const startProgressPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    const poll = async () => {
      try {
        const summary = await fetchInstallProgress();
        setInstall((prev) => ({
          ...prev,
          progress: summary,
          installing: summary.status === 'installing',
          completed:
            summary.status === 'completed' || summary.status === 'complete' || summary.status === 'idle',
          progressError: '',
        }));

        const done =
          summary.status === 'completed' ||
          summary.status === 'complete' ||
          summary.status === 'failed' ||
          summary.status === 'errored' ||
          summary.status === 'idle';

        if (!done) {
          pollTimerRef.current = window.setTimeout(poll, 4000);
        } else {
          pollTimerRef.current = null;
          refresh().catch(() => {});
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to retrieve installation progress.';
        setInstall((prev) => ({ ...prev, progressError: message, installing: false }));
      }
    };

    pollTimerRef.current = window.setTimeout(poll, 0);
  }, [refresh]);

  const triggerInstall = useCallback(async () => {
    setInstall((prev) => ({
      ...prev,
      started: true,
      installing: true,
      completed: false,
      error: '',
      progressError: '',
    }));
    try {
      const payload = buildInstallPayload(selected, overrides);
      const response = await installServices(payload);
      setInstall((prev) => ({
        ...prev,
        results: response?.results ?? [],
        error: '',
      }));
      startProgressPolling();
      await loadInstallationLogs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install services.';
      setInstall((prev) => ({
        ...prev,
        installing: false,
        error: message,
      }));
    }
  }, [selected, overrides, startProgressPolling, loadInstallationLogs]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current != null) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  const goNext = useCallback(async () => {
    const currentIndex = STEP_DEFINITIONS.findIndex((step) => step.id === currentStepId);
    const advance = (nextId: SetupStepId) => {
      const nextIndex = STEP_DEFINITIONS.findIndex((step) => step.id === nextId);
      setCurrentStepId(nextId);
      setMaxVisitedIndex((prev) => Math.max(prev, nextIndex));
    };

    switch (currentStepId) {
      case 'select':
        advance('configure');
        return;
      case 'configure':
        if (portalSelected) {
          advance('discord');
        } else {
          advance('install');
        }
        return;
      case 'discord':
        advance('install');
        return;
      case 'install':
        if (!install.started) {
          await triggerInstall();
          return;
        }
        if (install.installing || !install.completed) {
          return;
        }
        advance('logs');
        return;
      case 'logs':
        if (currentIndex < STEP_DEFINITIONS.length - 1) {
          advance(STEP_DEFINITIONS[currentIndex + 1].id);
        }
        return;
      default:
        return;
    }
  }, [currentStepId, portalSelected, install, triggerInstall]);

  const goPrevious = useCallback(() => {
    const currentIndex = STEP_DEFINITIONS.findIndex((step) => step.id === currentStepId);
    if (currentIndex <= 0) {
      return;
    }

    const previous = STEP_DEFINITIONS[currentIndex - 1];
    setCurrentStepId(previous.id);
  }, [currentStepId]);

  const selectStep = useCallback(
    (id: SetupStepId) => {
      const index = STEP_DEFINITIONS.findIndex((step) => step.id === id);
      if (index === -1) {
        return;
      }

      const currentIndex = STEP_DEFINITIONS.findIndex((step) => step.id === currentStepId);
      if (index > maxVisitedIndex || index > currentIndex + 1) {
        return;
      }

      if (install.installing && (id === 'select' || id === 'configure' || id === 'discord')) {
        return;
      }

      setCurrentStepId(id);
    },
    [currentStepId, maxVisitedIndex, install.installing],
  );

  const canGoPrevious = useMemo(() => {
    const currentIndex = STEP_DEFINITIONS.findIndex((step) => step.id === currentStepId);
    if (currentIndex <= 0) {
      return false;
    }
    if (install.installing) {
      return false;
    }
    return true;
  }, [currentStepId, install.installing]);

  const canGoNext = useMemo(() => {
    switch (currentStepId) {
      case 'select':
        return selectionErrors.length === 0;
      case 'configure':
        return envErrors.size === 0;
      case 'discord':
        if (!portalSelected) {
          return true;
        }
        return (
          !!portalEnv.DISCORD_BOT_TOKEN &&
          !!portalEnv.DISCORD_GUILD_ID &&
          !discordValidationError &&
          !discordValidating &&
          discordValidatedAt != null
        );
      case 'install':
        if (!install.started) {
          return true;
        }
        if (install.installing) {
          return false;
        }
        return install.completed;
      case 'logs':
        return true;
      default:
        return true;
    }
  }, [currentStepId, selectionErrors, envErrors, portalSelected, portalEnv, discordValidationError, discordValidating, discordValidatedAt, install]);

  const currentIndex = STEP_DEFINITIONS.findIndex((step) => step.id === currentStepId);

  const steps = useMemo(() => {
    return STEP_DEFINITIONS.map((definition, index) => {
      let status: SetupStepStatus = 'upcoming';
      if (index < currentIndex) {
        status = 'complete';
      } else if (index === currentIndex) {
        status = 'current';
      }

      let error: string | null = null;
      if (definition.id === 'select' && selectionErrors.length > 0) {
        status = status === 'current' ? 'current' : 'error';
        error = selectionErrors[0];
      }
      if (definition.id === 'configure' && envErrors.size > 0) {
        if (status === 'current') {
          error = 'Resolve required environment fields.';
        } else {
          status = 'error';
          error = 'Missing environment values.';
        }
      }
      if (definition.id === 'discord' && portalSelected) {
        if (discordValidationError) {
          status = 'error';
          error = discordValidationError;
        }
      }
      if (definition.id === 'install' && install.error) {
        status = 'error';
        error = install.error;
      }
      if (definition.id === 'install' && install.progressError) {
        status = 'error';
        error = install.progressError;
      }
      if (definition.id === 'logs' && installationLogs.error) {
        status = 'error';
        error = installationLogs.error;
      }
      return {
        ...definition,
        status,
        error,
      } satisfies SetupStepDefinition;
    });
  }, [currentIndex, envErrors, selectionErrors, install, installationLogs.error, portalSelected, discordValidationError]);

  const currentStep = steps[currentIndex] ?? steps[0];

  const nextLabel = useMemo(() => {
    switch (currentStepId) {
      case 'select':
        return 'Next';
      case 'configure':
        return portalSelected ? 'Review Discord' : 'Start installation';
      case 'discord':
        return 'Start installation';
      case 'install':
        if (!install.started) {
          return 'Start installation';
        }
        if (install.installing || !install.completed) {
          return 'Installing…';
        }
        return 'View logs';
      case 'logs':
        return 'Finish';
      default:
        return 'Next';
    }
  }, [currentStepId, portalSelected, install]);

  const onValidateDiscord = useCallback(async () => {
    if (!portalEnv.DISCORD_BOT_TOKEN || !portalEnv.DISCORD_GUILD_ID) {
      setDiscordValidationError('Provide a Discord bot token and guild id.');
      return;
    }

    setDiscordValidationError('');
    setDiscordValidating(true);
    setDiscordValidation(null);
    try {
      const payload = await validatePortalDiscordConfig({
        token: portalEnv.DISCORD_BOT_TOKEN,
        guildId: portalEnv.DISCORD_GUILD_ID,
      });
      setDiscordValidation(payload);
      setDiscordValidatedAt(Date.now());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to verify Discord configuration.';
      setDiscordValidationError(message);
      setDiscordValidation(null);
      setDiscordValidatedAt(null);
    } finally {
      setDiscordValidating(false);
    }
  }, [portalEnv.DISCORD_BOT_TOKEN, portalEnv.DISCORD_GUILD_ID]);

  const onCreateRole = useCallback(
    async (name: string) => {
      setCreateRoleState({ loading: true, error: '', successMessage: '' });
      try {
        const payload = await createPortalDiscordRole({
          token: portalEnv.DISCORD_BOT_TOKEN ?? '',
          guildId: portalEnv.DISCORD_GUILD_ID ?? '',
          name,
        });
        const id = (payload?.role as Record<string, unknown> | undefined)?.id;
        if (typeof id === 'string' && id.trim()) {
          updateEnvValue(PORTAL_SERVICE_NAME, 'DISCORD_GUILD_ROLE_ID', id.trim());
        }
        setCreateRoleState({
          loading: false,
          error: '',
          successMessage: 'Role created successfully.',
        });
        await onValidateDiscord();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to create Discord role.';
        setCreateRoleState({ loading: false, error: message, successMessage: '' });
      }
    },
    [portalEnv.DISCORD_BOT_TOKEN, portalEnv.DISCORD_GUILD_ID, updateEnvValue, onValidateDiscord],
  );

  const onCreateChannel = useCallback(
    async (name: string, type: string) => {
      setCreateChannelState({ loading: true, error: '', successMessage: '' });
      try {
        await createPortalDiscordChannel({
          token: portalEnv.DISCORD_BOT_TOKEN ?? '',
          guildId: portalEnv.DISCORD_GUILD_ID ?? '',
          name,
          type,
        });
        setCreateChannelState({
          loading: false,
          error: '',
          successMessage: 'Channel created successfully.',
        });
        await onValidateDiscord();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to create Discord channel.';
        setCreateChannelState({ loading: false, error: message, successMessage: '' });
      }
    },
    [portalEnv.DISCORD_BOT_TOKEN, portalEnv.DISCORD_GUILD_ID, onValidateDiscord],
  );

  const discord: DiscordState = useMemo(
    () => ({
      token: portalEnv.DISCORD_BOT_TOKEN ?? '',
      guildId: portalEnv.DISCORD_GUILD_ID ?? '',
      roleId: portalEnv.DISCORD_GUILD_ROLE_ID ?? '',
      defaultRoleId: portalEnv.DISCORD_DEFAULT_ROLE_ID ?? '',
      validating: discordValidating,
      validation: discordValidation,
      lastValidatedAt: discordValidatedAt,
      validationError: discordValidationError,
      createRoleState,
      createChannelState,
      onFieldChange: (key: string, value: string) => {
        updateEnvValue(PORTAL_SERVICE_NAME, key, value);
      },
      onValidate: onValidateDiscord,
      onCreateRole,
      onCreateChannel,
    }),
    [
      portalEnv,
      discordValidating,
      discordValidation,
      discordValidatedAt,
      discordValidationError,
      createRoleState,
      createChannelState,
      updateEnvValue,
      onValidateDiscord,
      onCreateRole,
      onCreateChannel,
    ],
  );

  return {
    steps,
    currentStep,
    selectStep,
    goNext,
    goPrevious,
    canGoNext,
    canGoPrevious,
    nextLabel,
    services,
    selected,
    selectionErrors,
    toggleService,
    envSections,
    updateEnvValue,
    detectRaven,
    detectingRaven,
    ravenDetectionError,
    envErrors,
    discord,
    install,
    loadInstallationLogs,
    installationLogs,
    selectedLogService,
    setSelectedLogService,
    serviceLogs,
    loadServiceLogs,
  };
}
