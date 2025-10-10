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
  fetchInstallProgress,
  fetchServiceHealth,
  installServices,
  type InstallProgressSummary,
  type PortalDiscordValidationPayload,
  type ServiceInstallRequestEntry,
  detectRavenMount,
  validatePortalDiscordConfig,
  fetchVerificationStatus,
  runVerificationChecks as runVerificationChecksRequest,
  completeWizardSetup as completeWizardSetupRequest,
  type VerificationSummaryState,
  type VerificationHealthSummary,
  type WizardState,
  type WizardStateUpdate,
  type WizardStepStatus,
} from './api.ts';
import { useWizardState } from './useWizardState.ts';

export type SetupStepId = 'foundation' | 'portal' | 'raven' | 'verification';

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
  lastValidatedAt: string | null;
  lastRoleCreatedAt: string | null;
  lastChannelCreatedAt: string | null;
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

export interface VerificationState {
  loading: boolean;
  running: boolean;
  completing: boolean;
  error: string;
  summary: VerificationSummaryState | null;
  health: {
    warden: VerificationHealthSummary | null;
    sage: VerificationHealthSummary | null;
  };
}

export type FoundationProgressStatus = 'idle' | 'pending' | 'success' | 'error';

export interface FoundationProgressItem {
  key: 'persist' | 'install' | 'health';
  label: string;
  status: FoundationProgressStatus;
  message: string | null;
}

export interface FoundationState {
  progress: FoundationProgressItem[];
  running: boolean;
  completed: boolean;
  error: string | null;
}

export type RavenDetectionStatus =
  | 'idle'
  | 'detecting'
  | 'detected'
  | 'not-found'
  | 'error';

export interface RavenDetectionState {
  status: RavenDetectionStatus;
  message: string | null;
  mountPath: string | null;
  updatedAt: string | null;
}

export interface RavenHealthState {
  checking: boolean;
  status: string | null;
  message: string | null;
  updatedAt: string | null;
}

export type RavenLaunchStatus = 'idle' | 'launching' | 'launched' | 'error';

export interface RavenLaunchState {
  status: RavenLaunchStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface RavenStepState {
  detection: RavenDetectionState;
  health: RavenHealthState;
  launch: RavenLaunchState;
  error: string;
  wizardStatus: WizardStepStatus;
  wizardDetail: string | null;
  wizardError: string | null;
}

const FOUNDATION_PROGRESS_STEPS: Array<Pick<FoundationProgressItem, 'key' | 'label'>> = [
  { key: 'persist', label: 'Persist configuration' },
  { key: 'install', label: 'Install core services' },
  { key: 'health', label: 'Verify Redis health' },
];

const FOUNDATION_STAGE_PENDING_MESSAGES: Record<FoundationProgressItem['key'], string> = {
  persist: 'Persisting configuration overrides…',
  install: 'Installing Vault, Redis, and Mongo…',
  health: 'Waiting for Redis health…',
};

const FOUNDATION_STAGE_SUCCESS_MESSAGES: Record<FoundationProgressItem['key'], string> = {
  persist: 'Configuration overrides saved.',
  install: 'Core services installed successfully.',
  health: 'Redis is reporting healthy.',
};

function createFoundationProgress(): FoundationProgressItem[] {
  return FOUNDATION_PROGRESS_STEPS.map((step) => ({
    ...step,
    status: 'idle',
    message: null,
  }));
}

function setFoundationProgressStatus(
  progress: FoundationProgressItem[],
  key: FoundationProgressItem['key'],
  status: FoundationProgressStatus,
  message: string | null = null,
): FoundationProgressItem[] {
  return progress.map((item) =>
    item.key === key
      ? {
          ...item,
          status,
          message,
        }
      : item,
  );
}

interface FoundationDetailPayload {
  overrides?: Record<string, Record<string, string>>;
  lastStage?: FoundationProgressItem['key'];
  completed?: boolean;
}

function parseFoundationDetail(detail: string | null): FoundationDetailPayload | null {
  if (!detail || typeof detail !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const payload = parsed as Record<string, unknown>;
    const overrides = payload.overrides;
    const lastStage = payload.lastStage;
    const completed = payload.completed;

    return {
      overrides:
        overrides && typeof overrides === 'object'
          ? (overrides as Record<string, Record<string, string>>)
          : undefined,
      lastStage:
        typeof lastStage === 'string' &&
        (FOUNDATION_PROGRESS_STEPS.some((step) => step.key === lastStage) ? (lastStage as FoundationProgressItem['key']) : undefined),
      completed: typeof completed === 'boolean' ? completed : undefined,
    };
  } catch {
    return null;
  }
}

interface PortalDetailPayload {
  overrides?: Record<string, Record<string, string>>;
  discord?: {
    validatedAt?: string | null;
    roleCreatedAt?: string | null;
    channelCreatedAt?: string | null;
  } | null;
  installTriggeredAt?: string | null;
}

function parsePortalDetail(detail: string | null): PortalDetailPayload | null {
  if (!detail || typeof detail !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const payload = parsed as Record<string, unknown>;
    const overridesRaw = payload.overrides;
    const overrides: Record<string, Record<string, string>> | undefined =
      overridesRaw && typeof overridesRaw === 'object'
        ? Object.fromEntries(
            Object.entries(overridesRaw as Record<string, unknown>).map(([service, env]) => {
              if (!env || typeof env !== 'object') {
                return [service, {}];
              }

              const normalizedEnv: Record<string, string> = {};
              for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
                if (typeof key !== 'string') {
                  continue;
                }
                if (typeof value === 'string') {
                  normalizedEnv[key] = value;
                } else if (value == null) {
                  normalizedEnv[key] = '';
                }
              }

              return [service, normalizedEnv];
            }),
          )
        : undefined;

    const discordRaw = payload.discord;
    let discord: PortalDetailPayload['discord'] = null;
    if (discordRaw && typeof discordRaw === 'object') {
      const candidate = discordRaw as Record<string, unknown>;
      const normalized: NonNullable<PortalDetailPayload['discord']> = {};
      if (typeof candidate.validatedAt === 'string' && candidate.validatedAt.trim()) {
        normalized.validatedAt = candidate.validatedAt.trim();
      } else if (candidate.validatedAt === null) {
        normalized.validatedAt = null;
      }
      if (typeof candidate.roleCreatedAt === 'string' && candidate.roleCreatedAt.trim()) {
        normalized.roleCreatedAt = candidate.roleCreatedAt.trim();
      } else if (candidate.roleCreatedAt === null) {
        normalized.roleCreatedAt = null;
      }
      if (typeof candidate.channelCreatedAt === 'string' && candidate.channelCreatedAt.trim()) {
        normalized.channelCreatedAt = candidate.channelCreatedAt.trim();
      } else if (candidate.channelCreatedAt === null) {
        normalized.channelCreatedAt = null;
      }
      discord = normalized;
    }

    const installTriggeredAt =
      typeof payload.installTriggeredAt === 'string' && payload.installTriggeredAt.trim()
        ? payload.installTriggeredAt.trim()
        : null;

    return {
      overrides,
      discord,
      installTriggeredAt,
    };
  } catch {
    return null;
  }
}

interface RavenDetailPayload {
  overrides?: Record<string, Record<string, string>>;
  detection?: {
    status?: string | null;
    message?: string | null;
    mountPath?: string | null;
    updatedAt?: string | null;
  } | null;
  launch?: {
    status?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    error?: string | null;
  } | null;
  health?: {
    status?: string | null;
    message?: string | null;
    checkedAt?: string | null;
  } | null;
  message?: string | null;
}

function parseRavenDetail(detail: string | null): RavenDetailPayload | null {
  if (!detail || typeof detail !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const payload = parsed as Record<string, unknown>;
    const overridesRaw = payload.overrides;
    const overrides: Record<string, Record<string, string>> | undefined =
      overridesRaw && typeof overridesRaw === 'object'
        ? Object.fromEntries(
            Object.entries(overridesRaw as Record<string, unknown>).map(([service, env]) => {
              if (!env || typeof env !== 'object') {
                return [service, {}];
              }

              const normalizedEnv: Record<string, string> = {};
              for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
                if (typeof key !== 'string') {
                  continue;
                }
                if (typeof value === 'string') {
                  normalizedEnv[key] = value;
                } else if (value == null) {
                  normalizedEnv[key] = '';
                }
              }

              return [service, normalizedEnv];
            }),
          )
        : undefined;

    const detectionRaw = payload.detection;
    let detection: RavenDetailPayload['detection'] = null;
    if (detectionRaw && typeof detectionRaw === 'object') {
      const candidate = detectionRaw as Record<string, unknown>;
      detection = {
        status:
          typeof candidate.status === 'string' && candidate.status.trim()
            ? candidate.status.trim()
            : null,
        message:
          typeof candidate.message === 'string' && candidate.message.trim()
            ? candidate.message.trim()
            : null,
        mountPath:
          typeof candidate.mountPath === 'string' && candidate.mountPath.trim()
            ? candidate.mountPath.trim()
            : null,
        updatedAt:
          typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim()
            ? candidate.updatedAt.trim()
            : null,
      };
    }

    const launchRaw = payload.launch;
    let launch: RavenDetailPayload['launch'] = null;
    if (launchRaw && typeof launchRaw === 'object') {
      const candidate = launchRaw as Record<string, unknown>;
      launch = {
        status:
          typeof candidate.status === 'string' && candidate.status.trim()
            ? candidate.status.trim()
            : null,
        startedAt:
          typeof candidate.startedAt === 'string' && candidate.startedAt.trim()
            ? candidate.startedAt.trim()
            : null,
        completedAt:
          typeof candidate.completedAt === 'string' && candidate.completedAt.trim()
            ? candidate.completedAt.trim()
            : null,
        error:
          typeof candidate.error === 'string' && candidate.error.trim()
            ? candidate.error.trim()
            : null,
      };
    }

    const healthRaw = payload.health;
    let health: RavenDetailPayload['health'] = null;
    if (healthRaw && typeof healthRaw === 'object') {
      const candidate = healthRaw as Record<string, unknown>;
      health = {
        status:
          typeof candidate.status === 'string' && candidate.status.trim()
            ? candidate.status.trim()
            : null,
        message:
          typeof candidate.message === 'string' && candidate.message.trim()
            ? candidate.message.trim()
            : null,
        checkedAt:
          typeof candidate.checkedAt === 'string' && candidate.checkedAt.trim()
            ? candidate.checkedAt.trim()
            : null,
      };
    }

    const message =
      typeof payload.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : null;

    return {
      overrides,
      detection,
      launch,
      health,
      message,
    };
  } catch {
    return null;
  }
}

function deriveFoundationStateFromWizard(
  detail: FoundationDetailPayload | null,
  stepState: WizardState['foundation'] | undefined,
): Pick<FoundationState, 'progress' | 'completed' | 'error'> {
  let progress = createFoundationProgress();
  const status = stepState?.status;
  const errorMessage =
    typeof stepState?.error === 'string' && stepState.error.trim()
      ? stepState.error
      : null;

  const completed = detail?.completed === true || status === 'complete';
  if (completed) {
    progress = progress.map((item) => ({ ...item, status: 'success' }));
    return { progress, completed: true, error: null };
  }

  const lastStage = detail?.lastStage;
  if (lastStage) {
    const order = FOUNDATION_PROGRESS_STEPS.map((step) => step.key);
    const index = order.indexOf(lastStage);
    if (index >= 0) {
      for (let i = 0; i < index; i += 1) {
        progress = setFoundationProgressStatus(progress, order[i], 'success');
      }
      const stageStatus = status === 'error' ? 'error' : 'pending';
      const stageMessage = status === 'error' ? errorMessage : null;
      progress = setFoundationProgressStatus(progress, lastStage, stageStatus, stageMessage);
    }
  }

  return {
    progress,
    completed: false,
    error: status === 'error' ? errorMessage : null,
  };
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
  foundationSections: EnvSection[];
  foundationState: FoundationState;
  envSections: EnvSection[];
  ravenSections: EnvSection[];
  updateEnvValue: (serviceName: string, key: string, value: string) => void;
  environmentError: string;
  portalError: string;
  envErrors: Map<string, string[]>;
  raven: RavenStepState;
  detectRaven: () => Promise<void>;
  checkRavenHealth: () => Promise<void>;
  discord: DiscordState;
  install: InstallState;
  verification: VerificationState;
  refreshVerification: () => Promise<void>;
  runVerificationChecks: () => Promise<void>;
  completeSetup: () => Promise<void>;
  wizardState: WizardState | null;
  wizardLoading: boolean;
  wizardError: string | null;
  refreshWizard: () => Promise<void>;
}

const STEP_DEFINITIONS: Array<Omit<SetupStepDefinition, 'status' | 'error'>> = [
  {
    id: 'foundation',
    title: 'Foundation services',
    description: 'Configure core data services and bootstrap the stack.',
  },
  {
    id: 'portal',
    title: 'Portal configuration',
    description: 'Provide Portal environment configuration and validate Discord access.',
  },
  {
    id: 'raven',
    title: 'Raven deployment',
    description: 'Launch Raven and monitor installer progress.',
  },
  {
    id: 'verification',
    title: 'Verification checks',
    description: 'Run health checks and confirm service readiness.',
  },
];

const PORTAL_SERVICE_NAME = 'noona-portal';
const RAVEN_SERVICE_NAME = 'noona-raven';
const FOUNDATION_SERVICE_NAMES = ['noona-vault', 'noona-redis', 'noona-mongo'] as const;
const FOUNDATION_SERVICE_SET = new Set<string>(FOUNDATION_SERVICE_NAMES);
const DEFAULT_SELECTED_SERVICES = new Set<string>([
  ...FOUNDATION_SERVICE_NAMES,
  PORTAL_SERVICE_NAME,
  RAVEN_SERVICE_NAME,
]);

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

function getServiceEnvOverrides(
  overrides: Map<string, Record<string, string>>,
  name: string,
): Record<string, string> {
  const env = overrides.get(name) ?? {};
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof key !== 'string') {
      continue;
    }
    cleaned[key] = value ?? '';
  }
  return cleaned;
}

function collectFoundationOverrides(
  overrides: Map<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  const payload: Record<string, Record<string, string>> = {};
  for (const name of FOUNDATION_SERVICE_NAMES) {
    payload[name] = getServiceEnvOverrides(overrides, name);
  }
  return payload;
}

function collectPortalOverrides(
  overrides: Map<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  return {
    [PORTAL_SERVICE_NAME]: getServiceEnvOverrides(overrides, PORTAL_SERVICE_NAME),
  };
}

function collectRavenOverrides(
  overrides: Map<string, Record<string, string>>,
): Record<string, Record<string, string>> {
  return {
    [RAVEN_SERVICE_NAME]: getServiceEnvOverrides(overrides, RAVEN_SERVICE_NAME),
  };
}

function buildInstallPayload(
  selected: Set<string>,
  overrides: Map<string, Record<string, string>>,
): ServiceInstallRequestEntry[] {
  return Array.from(selected).map((name) => {
    const cleaned = getServiceEnvOverrides(overrides, name);
    return Object.keys(cleaned).length > 0 ? { name, env: cleaned } : { name };
  });
}

export function useSetupSteps(): UseSetupStepsResult {
  const { services: serviceEntries, ensureLoaded, refresh } = useServiceInstallation();
  const {
    state: wizardState,
    loading: wizardLoading,
    error: wizardError,
    refresh: refreshWizard,
    update: updateWizard,
  } = useWizardState();
  const [currentStepId, setCurrentStepId] = useState<SetupStepId>('foundation');
  const [maxVisitedIndex, setMaxVisitedIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(DEFAULT_SELECTED_SERVICES),
  );
  const services = useMemo(() => serviceEntries.map(toSetupService), [serviceEntries]);
  const serviceMap = useMemo(() => new Map(services.map((service) => [service.name, service])), [services]);
  const foundationDetail = useMemo(
    () => (wizardState ? parseFoundationDetail(wizardState.foundation?.detail ?? null) : null),
    [wizardState],
  );
  const portalDetail = useMemo(
    () => (wizardState ? parsePortalDetail(wizardState.portal?.detail ?? null) : null),
    [wizardState],
  );
  const portalStatus = wizardState?.portal?.status ?? 'pending';
  const ravenDetail = useMemo(
    () => (wizardState ? parseRavenDetail(wizardState.raven?.detail ?? null) : null),
    [wizardState],
  );
  const ravenStatus = wizardState?.raven?.status ?? 'pending';
  const [overrides, setOverrides] = useState<Map<string, Record<string, string>>>(() =>
    initializeEnvOverrides(services),
  );
  const [preparingEnvironment, setPreparingEnvironment] = useState(false);
  const [environmentError, setEnvironmentError] = useState('');
  const [portalError, setPortalError] = useState('');
  const [portalInstalling, setPortalInstalling] = useState(false);
  const [portalInstallTriggeredAt, setPortalInstallTriggeredAt] = useState<string | null>(null);
  const [ravenDetection, setRavenDetection] = useState<RavenDetectionState>({
    status: 'idle',
    message: null,
    mountPath: null,
    updatedAt: null,
  });
  const [ravenHealth, setRavenHealth] = useState<RavenHealthState>({
    checking: false,
    status: null,
    message: null,
    updatedAt: null,
  });
  const [ravenLaunchState, setRavenLaunchState] = useState<RavenLaunchState>({
    status: 'idle',
    startedAt: null,
    completedAt: null,
    error: null,
  });
  const [ravenError, setRavenError] = useState('');

  const [discordValidation, setDiscordValidation] = useState<PortalDiscordValidationPayload | null>(null);
  const [discordValidationError, setDiscordValidationError] = useState('');
  const [discordValidating, setDiscordValidating] = useState(false);
  const [discordValidatedAt, setDiscordValidatedAt] = useState<string | null>(null);
  const [discordRoleCreatedAt, setDiscordRoleCreatedAt] = useState<string | null>(null);
  const [discordChannelCreatedAt, setDiscordChannelCreatedAt] = useState<string | null>(null);
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

  const [verificationState, setVerificationState] = useState<VerificationState>({
    loading: false,
    running: false,
    completing: false,
    error: '',
    summary: null,
    health: {
      warden: null,
      sage: null,
    },
  });
  const [foundationState, setFoundationState] = useState<FoundationState>({
    progress: createFoundationProgress(),
    running: false,
    completed: false,
    error: null,
  });
  const foundationOverridesSeededRef = useRef(false);
  const portalOverridesSeededRef = useRef(false);

  const pollTimerRef = useRef<number | null>(null);
  const portalPollTimerRef = useRef<number | null>(null);
  const ravenOverridesSeededRef = useRef(false);

  const buildPortalDetail = useCallback(
    (
      options: {
        overrides?: Record<string, Record<string, string>>;
        discord?: Partial<NonNullable<PortalDetailPayload['discord']>>;
        installTriggeredAt?: string | null;
      } = {},
    ): PortalDetailPayload => {
      const overridesPayload = options.overrides ?? collectPortalOverrides(overrides);
      const baseDiscord: NonNullable<PortalDetailPayload['discord']> = {
        validatedAt: discordValidatedAt ?? null,
        roleCreatedAt: discordRoleCreatedAt ?? null,
        channelCreatedAt: discordChannelCreatedAt ?? null,
      };
      const discordPayload = options.discord ? { ...baseDiscord, ...options.discord } : baseDiscord;

      return {
        overrides: overridesPayload,
        discord: discordPayload,
        installTriggeredAt:
          options.installTriggeredAt !== undefined
            ? options.installTriggeredAt
            : portalInstallTriggeredAt,
      };
    },
    [
      overrides,
      discordValidatedAt,
      discordRoleCreatedAt,
      discordChannelCreatedAt,
      portalInstallTriggeredAt,
    ],
  );

  const persistPortalDetail = useCallback(
    async (
      detail: PortalDetailPayload,
      status?: WizardStepStatus,
      error?: string | null,
    ): Promise<void> => {
      const update: WizardStateUpdate = {
        step: 'portal',
        detail: JSON.stringify(detail),
        updatedAt: new Date().toISOString(),
      };
      if (status) {
        update.status = status;
        if (status !== 'complete') {
          update.completedAt = null;
        }
      }
      if (error !== undefined) {
        update.error = error;
      }
      await updateWizard(update);
    },
    [updateWizard],
  );

  const buildRavenDetail = useCallback(
    (
      options: {
        detection?: RavenDetectionState;
        launch?: RavenLaunchState;
        health?: RavenHealthState;
        message?: string | null;
      } = {},
    ): RavenDetailPayload => {
      const detectionState = options.detection ?? ravenDetection;
      const launchState = options.launch ?? ravenLaunchState;
      const healthState = options.health ?? ravenHealth;

      const serializeDetection = (state: RavenDetectionState): RavenDetailPayload['detection'] => ({
        status: state.status,
        message: state.message,
        mountPath: state.mountPath,
        updatedAt: state.updatedAt,
      });

      const serializeLaunch = (state: RavenLaunchState): RavenDetailPayload['launch'] => ({
        status: state.status,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        error: state.error,
      });

      const serializeHealth = (state: RavenHealthState): RavenDetailPayload['health'] => ({
        status: state.status,
        message: state.message,
        checkedAt: state.updatedAt,
      });

      const message =
        options.message ??
        detectionState.message ??
        (launchState.status === 'error' ? launchState.error : null) ??
        healthState.message ??
        null;

      return {
        overrides: collectRavenOverrides(overrides),
        detection: serializeDetection(detectionState),
        launch: serializeLaunch(launchState),
        health: serializeHealth(healthState),
        message,
      };
    },
    [overrides, ravenDetection, ravenLaunchState, ravenHealth],
  );

  const persistRavenDetail = useCallback(
    async (detail: RavenDetailPayload, status?: WizardStepStatus, error?: string | null) => {
      const timestamp = new Date().toISOString();
      const update: WizardStateUpdate = {
        step: 'raven',
        detail: JSON.stringify(detail),
        updatedAt: timestamp,
      };
      if (status) {
        update.status = status;
        update.completedAt = status === 'complete' ? timestamp : null;
      }
      if (error !== undefined) {
        update.error = error;
      }
      await updateWizard(update);
    },
    [updateWizard],
  );

  const performRavenHealthCheck = useCallback(async () => {
    setRavenHealth((prev) => ({ ...prev, checking: true }));
    try {
      const response = await fetchServiceHealth(RAVEN_SERVICE_NAME);
      const statusValue =
        typeof (response as Record<string, unknown>)?.status === 'string'
          ? ((response as Record<string, unknown>).status as string).trim()
          : '';
      const normalizedStatus = statusValue.toLowerCase();
      const detailField = (response as Record<string, unknown>)?.detail;
      const timestamp = new Date().toISOString();
      const message =
        typeof detailField === 'string' && detailField.trim()
          ? (detailField as string).trim()
          : normalizedStatus
              ? `Raven health status: ${statusValue}`
              : 'Raven health check completed.';
      const nextState: RavenHealthState = {
        checking: false,
        status: normalizedStatus || null,
        message,
        updatedAt: timestamp,
      };
      setRavenHealth(nextState);
      setRavenError('');
      const detail = buildRavenDetail({ health: nextState, message });
      await persistRavenDetail(detail);
      return nextState;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to retrieve Raven health.';
      const timestamp = new Date().toISOString();
      const nextState: RavenHealthState = {
        checking: false,
        status: 'error',
        message,
        updatedAt: timestamp,
      };
      setRavenHealth(nextState);
      setRavenError(message);
      const detail = buildRavenDetail({ health: nextState, message });
      await persistRavenDetail(detail, 'error', message);
      throw error instanceof Error ? error : new Error(message);
    }
  }, [buildRavenDetail, persistRavenDetail]);

  const detectRaven = useCallback(async () => {
    const timestamp = new Date().toISOString();
    const pendingState: RavenDetectionState = {
      status: 'detecting',
      message: 'Detecting Kavita data mount…',
      mountPath: null,
      updatedAt: timestamp,
    };
    setRavenDetection(pendingState);
    setRavenError('');

    try {
      const response = await detectRavenMount();
      const mountPathRaw = response?.detection?.mountPath;
      const mountPath = typeof mountPathRaw === 'string' && mountPathRaw.trim() ? mountPathRaw.trim() : null;

      if (mountPath) {
        const successState: RavenDetectionState = {
          status: 'detected',
          message: `Kavita data mount detected at ${mountPath}`,
          mountPath,
          updatedAt: new Date().toISOString(),
        };
        setRavenDetection(successState);
        const detail = buildRavenDetail({ detection: successState, message: successState.message });
        await persistRavenDetail(detail);
      } else {
        const notFoundState: RavenDetectionState = {
          status: 'not-found',
          message: 'Kavita data mount not detected automatically.',
          mountPath: null,
          updatedAt: new Date().toISOString(),
        };
        setRavenDetection(notFoundState);
        const detail = buildRavenDetail({ detection: notFoundState, message: notFoundState.message });
        await persistRavenDetail(detail);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to detect Kavita data mount.';
      const failureState: RavenDetectionState = {
        status: 'error',
        message,
        mountPath: null,
        updatedAt: new Date().toISOString(),
      };
      setRavenDetection(failureState);
      setRavenError(message);
      const detail = buildRavenDetail({ detection: failureState, message });
      await persistRavenDetail(detail, 'error', message);
    }
  }, [buildRavenDetail, persistRavenDetail]);

  const checkRavenHealth = useCallback(async () => {
    try {
      await performRavenHealthCheck();
    } catch {
      // Error state handled inside performRavenHealthCheck
    }
  }, [performRavenHealthCheck]);

  const launchRaven = useCallback(async () => {
    const env = getServiceEnvOverrides(overrides, RAVEN_SERVICE_NAME);
    const startedAt = new Date().toISOString();
    const pendingState: RavenLaunchState = {
      status: 'launching',
      startedAt,
      completedAt: null,
      error: null,
    };
    setRavenLaunchState(pendingState);
    setRavenError('');
    const pendingDetail = buildRavenDetail({
      launch: pendingState,
      message: 'Requesting Raven installation…',
    });
    await persistRavenDetail(pendingDetail, 'in-progress', null);

    try {
      const payload: ServiceInstallRequestEntry =
        Object.keys(env).length > 0
          ? { name: RAVEN_SERVICE_NAME, env }
          : { name: RAVEN_SERVICE_NAME };
      const result = await installServices([payload]);
      const ravenResult = Array.isArray(result?.results)
        ? (result.results as Array<Record<string, unknown>>).find(
            (entry) => typeof entry?.name === 'string' && entry.name === RAVEN_SERVICE_NAME,
          )
        : undefined;

      const ravenStatus = typeof ravenResult?.status === 'string' ? ravenResult.status.trim().toLowerCase() : 'installed';
      if (ravenStatus === 'error') {
        const errorMessage =
          typeof ravenResult?.error === 'string' && ravenResult.error.trim()
            ? ravenResult.error.trim()
            : 'Unable to install Raven service.';
        throw new Error(errorMessage);
      }
      const completedAt = new Date().toISOString();
      const successState: RavenLaunchState = {
        status: 'launched',
        startedAt,
        completedAt,
        error: null,
      };
      setRavenLaunchState(successState);
      const detail = buildRavenDetail({
        launch: successState,
        message: 'Raven installation requested.',
      });
      await persistRavenDetail(detail, 'in-progress', null);
      await refreshWizard().catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to install Raven service.';
      const failureState: RavenLaunchState = {
        status: 'error',
        startedAt,
        completedAt: null,
        error: message,
      };
      setRavenLaunchState(failureState);
      setRavenError(message);
      const detail = buildRavenDetail({ launch: failureState, message });
      await persistRavenDetail(detail, 'error', message);
      throw error instanceof Error ? error : new Error(message);
    }
  }, [
    overrides,
    buildRavenDetail,
    persistRavenDetail,
    refreshWizard,
  ]);

  const waitForRedisHealth = useCallback(async () => {
    const maxAttempts = 10;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await fetchServiceHealth('noona-redis');
        const status = typeof response?.status === 'string' ? response.status.toLowerCase() : '';
        const healthyFlag = (response as Record<string, unknown>)?.healthy;
        const isHealthy =
          status === 'healthy' ||
          status === 'ok' ||
          status === 'ready' ||
          healthyFlag === true;
        if (isHealthy) {
          return;
        }
        lastError = new Error('Redis is not healthy yet.');
      } catch (error) {
        lastError = error;
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error('Redis health check did not succeed in time.');
  }, []);

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
    if (!foundationDetail?.overrides) {
      return;
    }
    if (foundationOverridesSeededRef.current) {
      return;
    }

    setOverrides((prev) => {
      const next = cloneOverrides(prev);
      for (const [serviceName, env] of Object.entries(foundationDetail.overrides ?? {})) {
        if (!next.has(serviceName)) {
          next.set(serviceName, { ...env });
        } else {
          next.set(serviceName, { ...next.get(serviceName)!, ...env });
        }
      }
      return next;
    });

    foundationOverridesSeededRef.current = true;
  }, [foundationDetail]);

  useEffect(() => {
    if (!portalDetail?.overrides) {
      return;
    }
    if (portalOverridesSeededRef.current) {
      return;
    }

    setOverrides((prev) => {
      const next = cloneOverrides(prev);
      for (const [serviceName, env] of Object.entries(portalDetail.overrides ?? {})) {
        if (!next.has(serviceName)) {
          next.set(serviceName, { ...env });
        } else {
          next.set(serviceName, { ...next.get(serviceName)!, ...env });
        }
      }
      return next;
    });

    portalOverridesSeededRef.current = true;
  }, [portalDetail]);

  useEffect(() => {
    if (!ravenDetail?.overrides) {
      return;
    }
    if (ravenOverridesSeededRef.current) {
      return;
    }

    setOverrides((prev) => {
      const next = cloneOverrides(prev);
      for (const [serviceName, env] of Object.entries(ravenDetail.overrides ?? {})) {
        if (!next.has(serviceName)) {
          next.set(serviceName, { ...env });
        } else {
          next.set(serviceName, { ...next.get(serviceName)!, ...env });
        }
      }
      return next;
    });

    ravenOverridesSeededRef.current = true;
  }, [ravenDetail]);

  useEffect(() => {
    if (!portalDetail) {
      setDiscordValidatedAt(null);
      setDiscordRoleCreatedAt(null);
      setDiscordChannelCreatedAt(null);
      setPortalInstallTriggeredAt(null);
      return;
    }

    setDiscordValidatedAt(portalDetail.discord?.validatedAt ?? null);
    setDiscordRoleCreatedAt(portalDetail.discord?.roleCreatedAt ?? null);
    setDiscordChannelCreatedAt(portalDetail.discord?.channelCreatedAt ?? null);
    setPortalInstallTriggeredAt(portalDetail.installTriggeredAt ?? null);
  }, [portalDetail]);

  useEffect(() => {
    if (ravenDetection.status === 'detecting') {
      return;
    }

    const detail = ravenDetail?.detection;
    if (!detail) {
      if (ravenDetection.status !== 'idle' || ravenDetection.message || ravenDetection.mountPath) {
        setRavenDetection({ status: 'idle', message: null, mountPath: null, updatedAt: null });
      }
      return;
    }

    const normalizedStatus = detail.status && ['idle', 'detecting', 'detected', 'not-found', 'error'].includes(detail.status)
      ? (detail.status as RavenDetectionStatus)
      : ravenDetection.status;

    setRavenDetection({
      status: normalizedStatus,
      message: detail.message ?? null,
      mountPath: detail.mountPath ?? null,
      updatedAt: detail.updatedAt ?? null,
    });
  }, [ravenDetail?.detection, ravenDetection.status, ravenDetection.message, ravenDetection.mountPath]);

  useEffect(() => {
    if (ravenLaunchState.status === 'launching') {
      return;
    }

    const detail = ravenDetail?.launch;
    if (!detail) {
      if (ravenLaunchState.status !== 'idle') {
        setRavenLaunchState({ status: 'idle', startedAt: null, completedAt: null, error: null });
      }
      return;
    }

    const normalized = typeof detail.status === 'string' ? detail.status.trim().toLowerCase() : '';
    let status: RavenLaunchStatus = 'idle';
    if (normalized === 'launching' || normalized === 'starting') {
      status = 'launching';
    } else if (normalized === 'error' || normalized === 'failed') {
      status = 'error';
    } else if (['launched', 'complete', 'completed', 'installed', 'running'].includes(normalized)) {
      status = 'launched';
    }

    setRavenLaunchState({
      status,
      startedAt: detail.startedAt ?? null,
      completedAt: detail.completedAt ?? null,
      error: detail.error ?? null,
    });
  }, [ravenDetail?.launch, ravenLaunchState.status]);

  useEffect(() => {
    if (ravenHealth.checking) {
      return;
    }

    const detail = ravenDetail?.health;
    if (!detail) {
      if (ravenHealth.status || ravenHealth.message) {
        setRavenHealth({ checking: false, status: null, message: null, updatedAt: null });
      }
      return;
    }

    setRavenHealth({
      checking: false,
      status: detail.status ?? null,
      message: detail.message ?? null,
      updatedAt: detail.checkedAt ?? null,
    });
  }, [ravenDetail?.health, ravenHealth.checking, ravenHealth.status, ravenHealth.message]);

  useEffect(() => {
    if (ravenLaunchState.status === 'launching') {
      return;
    }

    const launchError =
      typeof ravenDetail?.launch?.error === 'string' && ravenDetail.launch.error.trim()
        ? ravenDetail.launch.error.trim()
        : null;
    const wizardErrorMessage =
      typeof wizardState?.raven?.error === 'string' && wizardState.raven.error.trim()
        ? wizardState.raven.error.trim()
        : null;
    const message = wizardErrorMessage ?? launchError ?? '';
    setRavenError(message);
  }, [ravenDetail?.launch?.error, wizardState?.raven?.error, ravenLaunchState.status]);

  useEffect(() => {
    const message =
      typeof wizardState?.portal?.error === 'string' && wizardState.portal.error.trim()
        ? wizardState.portal.error.trim()
        : '';
    setPortalError(message);
  }, [wizardState?.portal?.error]);

  useEffect(() => {
    const status = wizardState?.portal?.status;
    setPortalInstalling(status === 'in-progress');
  }, [wizardState?.portal?.status]);

  useEffect(() => {
    const status = wizardState?.portal?.status;
    if (status === 'in-progress') {
      if (portalPollTimerRef.current == null) {
        const poll = async () => {
          try {
            await refreshWizard();
          } catch {
            // ignore polling errors
          }
          portalPollTimerRef.current = window.setTimeout(poll, 4000);
        };
        portalPollTimerRef.current = window.setTimeout(poll, 4000);
      }
    } else if (portalPollTimerRef.current != null) {
      window.clearTimeout(portalPollTimerRef.current);
      portalPollTimerRef.current = null;
    }
  }, [wizardState?.portal?.status, refreshWizard]);

  useEffect(() => {
    setSelected(() => {
      const next = new Set<string>();
      for (const name of DEFAULT_SELECTED_SERVICES) {
        if (serviceMap.has(name)) {
          next.add(name);
        }
      }
      return next;
    });
  }, [serviceMap]);

  useEffect(() => {
    if (!selected.has(RAVEN_SERVICE_NAME)) {
      setEnvironmentError('');
      setPreparingEnvironment(false);
      setRavenError('');
    }
  }, [selected]);

  useEffect(() => {
    if (!wizardState) {
      return;
    }
    setFoundationState((prev) => {
      if (prev.running) {
        return prev;
      }
      const derived = deriveFoundationStateFromWizard(foundationDetail, wizardState.foundation);
      return {
        ...prev,
        progress: derived.progress,
        completed: derived.completed,
        error: derived.error,
        running: false,
      };
    });
  }, [wizardState, foundationDetail]);

  const allEnvSections = useMemo(() => {
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

  const foundationSections = useMemo(() => {
    const byName = new Map(allEnvSections.map((section) => [section.service.name, section]));
    const ordered: EnvSection[] = [];
    for (const name of FOUNDATION_SERVICE_NAMES) {
      const section = byName.get(name);
      if (section) {
        ordered.push(section);
      }
    }
    return ordered;
  }, [allEnvSections]);

  const envSections = useMemo(
    () => allEnvSections.filter((section) => section.service.name === PORTAL_SERVICE_NAME),
    [allEnvSections],
  );

  const ravenSections = useMemo(
    () => allEnvSections.filter((section) => section.service.name === RAVEN_SERVICE_NAME),
    [allEnvSections],
  );

  const foundationEnvErrors = useMemo(() => {
    const errors = new Map<string, string[]>();
    for (const section of foundationSections) {
      const messages = section.fields
        .filter((field) => field.error)
        .map((field) => field.error as string);
      if (messages.length > 0) {
        errors.set(section.service.name, messages);
      }
    }
    return errors;
  }, [foundationSections]);

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

  const ravenEnvErrors = useMemo(() => {
    const errors = new Map<string, string[]>();
    for (const section of ravenSections) {
      const messages = section.fields
        .filter((field) => field.error)
        .map((field) => field.error as string);
      if (messages.length > 0) {
        errors.set(section.service.name, messages);
      }
    }
    return errors;
  }, [ravenSections]);

  const portalEnv = useMemo(() => overrides.get(PORTAL_SERVICE_NAME) ?? {}, [overrides]);

  useEffect(() => {
    setDiscordValidation(null);
    setDiscordValidatedAt(null);
  }, [portalEnv.DISCORD_BOT_TOKEN, portalEnv.DISCORD_GUILD_ID]);

  const loadVerificationStatus = useCallback(async () => {
    setVerificationState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      const payload = await fetchVerificationStatus();
      setVerificationState({
        loading: false,
        running: false,
        completing: false,
        error: '',
        summary: payload.summary ?? null,
        health: {
          warden: payload.health?.warden ?? null,
          sage: payload.health?.sage ?? null,
        },
      });
      await refreshWizard().catch(() => {});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load verification status.';
      setVerificationState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [refreshWizard]);

  useEffect(() => {
    void loadVerificationStatus();
  }, [loadVerificationStatus]);

  const updateEnvValue = useCallback(
    (serviceName: string, key: string, value: string) => {
      setEnvironmentError('');
      if (serviceName === PORTAL_SERVICE_NAME) {
        setPortalError('');
      }
      if (serviceName === RAVEN_SERVICE_NAME) {
        setRavenError('');
      }
      setOverrides((prev) => {
        const next = cloneOverrides(prev);
        const existing = next.get(serviceName) ?? {};
        if (existing[key] === value) {
          return prev;
        }
        const updated = { ...existing, [key]: value };
        next.set(serviceName, updated);
        if (serviceName === PORTAL_SERVICE_NAME) {
          const overridesSnapshot = collectPortalOverrides(next);
          const resetValidationKeys = new Set(['DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID']);
          const shouldResetValidation = resetValidationKeys.has(key);
          if (shouldResetValidation) {
            setPortalInstallTriggeredAt(null);
            setPortalInstalling(false);
          }
          void persistPortalDetail(
            buildPortalDetail({
              overrides: overridesSnapshot,
              discord: shouldResetValidation ? { validatedAt: null } : undefined,
            }),
            shouldResetValidation
              ? 'pending'
              : portalStatus === 'complete'
              ? 'complete'
              : undefined,
            null,
          ).catch(() => {});
        }
        return next;
      });
    },
    [buildPortalDetail, persistPortalDetail, portalStatus],
  );

  const runVerificationChecks = useCallback(async () => {
    setVerificationState((prev) => ({ ...prev, running: true, error: '' }));
    try {
      const payload = await runVerificationChecksRequest();
      setVerificationState({
        loading: false,
        running: false,
        completing: false,
        error: '',
        summary: payload.summary ?? null,
        health: {
          warden: payload.health?.warden ?? null,
          sage: payload.health?.sage ?? null,
        },
      });
      await refreshWizard().catch(() => {});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to run verification checks.';
      setVerificationState((prev) => ({ ...prev, running: false, error: message }));
    }
  }, [refreshWizard]);

  const completeSetup = useCallback(async () => {
    setVerificationState((prev) => ({ ...prev, completing: true, error: '' }));
    try {
      const payload = await completeWizardSetupRequest();
      setVerificationState({
        loading: false,
        running: false,
        completing: false,
        error: '',
        summary: payload.summary ?? null,
        health: {
          warden: payload.health?.warden ?? null,
          sage: payload.health?.sage ?? null,
        },
      });
      await refreshWizard().catch(() => {});
      await refresh().catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to complete setup.';
      setVerificationState((prev) => ({ ...prev, completing: false, error: message }));
    }
  }, [refreshWizard, refresh]);

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
      const installTargets = Array.from(selected).filter(
        (name) => !FOUNDATION_SERVICE_SET.has(name),
      );
      if (installTargets.length === 0) {
        setInstall((prev) => ({
          ...prev,
          installing: false,
          completed: true,
          error: '',
        }));
        return;
      }
      const payload = buildInstallPayload(new Set(installTargets), overrides);
      const response = await installServices(payload);
      setInstall((prev) => ({
        ...prev,
        results: response?.results ?? [],
        error: '',
      }));
      startProgressPolling();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install services.';
      setInstall((prev) => ({
        ...prev,
        installing: false,
        error: message,
      }));
    }
  }, [selected, overrides, startProgressPolling]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current != null) {
        window.clearTimeout(pollTimerRef.current);
      }
      if (portalPollTimerRef.current != null) {
        window.clearTimeout(portalPollTimerRef.current);
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

    if (currentStepId === 'foundation') {
      if (foundationState.running) {
        return;
      }
      if (foundationEnvErrors.size > 0) {
        setFoundationState((prev) => ({
          ...prev,
          error: 'Resolve required environment fields before continuing.',
        }));
        return;
      }
      if (foundationState.completed) {
        advance('portal');
        return;
      }

      const overridesSnapshot = collectFoundationOverrides(overrides);
      let currentStage: FoundationProgressItem['key'] = 'persist';
      const timestamp = () => new Date().toISOString();

      setFoundationState({
        progress: setFoundationProgressStatus(
          createFoundationProgress(),
          'persist',
          'pending',
          FOUNDATION_STAGE_PENDING_MESSAGES.persist,
        ),
        running: true,
        completed: false,
        error: null,
      });

      try {
        const persistDetail = JSON.stringify({
          overrides: overridesSnapshot,
          lastStage: 'persist',
          completed: false,
        });
        await updateWizard({
          step: 'foundation',
          status: 'in-progress',
          detail: persistDetail,
          error: null,
          updatedAt: timestamp(),
          completedAt: null,
        });
        setFoundationState((prev) => ({
          ...prev,
          progress: setFoundationProgressStatus(
            prev.progress,
            'persist',
            'success',
            FOUNDATION_STAGE_SUCCESS_MESSAGES.persist,
          ),
        }));

        currentStage = 'install';
        setFoundationState((prev) => ({
          ...prev,
          progress: setFoundationProgressStatus(
            prev.progress,
            'install',
            'pending',
            FOUNDATION_STAGE_PENDING_MESSAGES.install,
          ),
        }));

        const installPayload = FOUNDATION_SERVICE_NAMES.map((name) => {
          const env = overridesSnapshot[name] ?? {};
          return Object.keys(env).length > 0 ? { name, env } : { name };
        });
        await installServices(installPayload);

        const installDetail = JSON.stringify({
          overrides: overridesSnapshot,
          lastStage: 'install',
          completed: false,
        });
        await updateWizard({
          step: 'foundation',
          status: 'in-progress',
          detail: installDetail,
          error: null,
          updatedAt: timestamp(),
          completedAt: null,
        });
        setFoundationState((prev) => ({
          ...prev,
          progress: setFoundationProgressStatus(
            prev.progress,
            'install',
            'success',
            FOUNDATION_STAGE_SUCCESS_MESSAGES.install,
          ),
        }));

        currentStage = 'health';
        setFoundationState((prev) => ({
          ...prev,
          progress: setFoundationProgressStatus(
            prev.progress,
            'health',
            'pending',
            FOUNDATION_STAGE_PENDING_MESSAGES.health,
          ),
        }));

        await waitForRedisHealth();
        const completionTimestamp = timestamp();
        const completeDetail = JSON.stringify({
          overrides: overridesSnapshot,
          lastStage: 'health',
          completed: true,
        });
        await updateWizard({
          step: 'foundation',
          status: 'complete',
          detail: completeDetail,
          error: null,
          updatedAt: completionTimestamp,
          completedAt: completionTimestamp,
        });
        setFoundationState((prev) => ({
          ...prev,
          progress: setFoundationProgressStatus(
            prev.progress,
            'health',
            'success',
            FOUNDATION_STAGE_SUCCESS_MESSAGES.health,
          ),
          running: false,
          completed: true,
          error: null,
        }));
        advance('portal');
        await refreshWizard().catch(() => {});
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to bootstrap foundation services.';
        setFoundationState((prev) => ({
          ...prev,
          running: false,
          completed: false,
          error: message,
          progress: setFoundationProgressStatus(prev.progress, currentStage, 'error', message),
        }));
        const errorDetail = JSON.stringify({
          overrides: overridesSnapshot,
          lastStage: currentStage,
          completed: false,
        });
        try {
          await updateWizard({
            step: 'foundation',
            status: 'error',
            detail: errorDetail,
            error: message,
            updatedAt: timestamp(),
            completedAt: null,
          });
        } catch {
          // ignore secondary failures
        }
      }
      return;
    }

    if (currentStepId === 'portal') {
      setPreparingEnvironment(false);
      setEnvironmentError('');
      setPortalError('');
      advance('raven');
      return;
    }

    if (currentStepId === 'raven') {
      if (
        ravenLaunchState.status === 'launching' ||
        ravenDetection.status === 'detecting' ||
        ravenHealth.checking
      ) {
        return;
      }

      if (ravenEnvErrors.size > 0) {
        setEnvironmentError('Resolve required environment fields before continuing.');
        return;
      }

      setEnvironmentError('');
      setRavenError('');

      let launchFailed = false;

      if (ravenLaunchState.status !== 'launched') {
        try {
          await launchRaven();
        } catch {
          launchFailed = true;
        }
      }

      if (launchFailed) {
        return;
      }

      try {
        await performRavenHealthCheck();
      } catch {
        return;
      }

      if (!install.started) {
        await triggerInstall();
      }

      advance('verification');
      return;
    }

    if (currentStepId === 'verification') {
      if (currentIndex < STEP_DEFINITIONS.length - 1) {
        advance(STEP_DEFINITIONS[currentIndex + 1].id);
      }
    }
  }, [
    currentStepId,
    foundationState,
    foundationEnvErrors,
    overrides,
    updateWizard,
    refreshWizard,
    waitForRedisHealth,
    ravenEnvErrors,
    ravenLaunchState.status,
    ravenDetection.status,
    ravenHealth.checking,
    launchRaven,
    performRavenHealthCheck,
    install,
    triggerInstall,
  ]);

  const goPrevious = useCallback(() => {
    const currentIndex = STEP_DEFINITIONS.findIndex((step) => step.id === currentStepId);
    if (currentIndex <= 0) {
      return;
    }

    const previous = STEP_DEFINITIONS[currentIndex - 1];
    setCurrentStepId(previous.id);
  }, [currentStepId]);

  const canGoNext = useMemo(() => {
    switch (currentStepId) {
      case 'foundation':
        return !foundationState.running && foundationEnvErrors.size === 0;
      case 'portal':
        return (
          envErrors.size === 0 &&
          !!portalEnv.DISCORD_BOT_TOKEN &&
          !!portalEnv.DISCORD_GUILD_ID &&
          !discordValidationError &&
          !discordValidating &&
          !!discordValidatedAt &&
          !portalError &&
          !portalInstalling &&
          portalStatus === 'complete'
        );
      case 'raven':
        return (
          ravenEnvErrors.size === 0 &&
          ravenLaunchState.status !== 'launching' &&
          ravenDetection.status !== 'detecting' &&
          !ravenHealth.checking
        );
      case 'verification':
        return true;
      default:
        return true;
    }
  }, [
    currentStepId,
    foundationState.running,
    foundationEnvErrors,
    envErrors,
    portalEnv,
    discordValidationError,
    discordValidating,
    discordValidatedAt,
    portalError,
    portalInstalling,
    portalStatus,
    ravenEnvErrors,
    ravenLaunchState.status,
    ravenDetection.status,
    ravenHealth.checking,
  ]);

  const selectStep = useCallback(
    (id: SetupStepId) => {
      const index = STEP_DEFINITIONS.findIndex((step) => step.id === id);
      if (index === -1 || id === currentStepId) {
        return;
      }

      if (
        (ravenLaunchState.status === 'launching' ||
          ravenDetection.status === 'detecting' ||
          ravenHealth.checking) &&
        id !== 'raven'
      ) {
        return;
      }

      if (install.installing && (id === 'foundation' || id === 'portal' || id === 'raven')) {
        return;
      }

      const currentIndex = STEP_DEFINITIONS.findIndex((step) => step.id === currentStepId);
      const isNextStep = index === currentIndex + 1;
      const hasVisited = index <= maxVisitedIndex;

      if (isNextStep) {
        if (!canGoNext) {
          return;
        }

        void goNext();
        return;
      }

      if (!hasVisited) {
        return;
      }

      setCurrentStepId(id);
      setMaxVisitedIndex((prev) => Math.max(prev, index));
    },
    [
      currentStepId,
      goNext,
      canGoNext,
      install.installing,
      maxVisitedIndex,
      ravenLaunchState.status,
      ravenDetection.status,
      ravenHealth.checking,
    ],
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
      if (definition.id === 'foundation') {
        if (foundationState.error) {
          status = status === 'current' ? 'current' : 'error';
          error = foundationState.error;
        } else if (foundationEnvErrors.size > 0) {
          if (status === 'current') {
            error = 'Resolve required environment fields.';
          } else {
            status = 'error';
            error = 'Missing environment values.';
          }
        }
      }
      if (definition.id === 'portal') {
        if (envErrors.size > 0) {
          if (status === 'current') {
            error = 'Resolve required environment fields.';
          } else {
            status = 'error';
            error = 'Missing environment values.';
          }
        } else if (portalError) {
          status = 'error';
          error = portalError;
        } else if (discordValidationError) {
          status = 'error';
          error = discordValidationError;
        }
      }
      if (definition.id === 'raven') {
        if (ravenEnvErrors.size > 0) {
          if (status === 'current') {
            error = 'Resolve required environment fields.';
          } else {
            status = 'error';
            error = 'Missing environment values.';
          }
        } else if (ravenError) {
          status = 'error';
          error = ravenError;
        } else if (ravenStatus === 'error') {
          status = 'error';
          error = wizardState?.raven?.error ?? 'Raven setup reported an error.';
        } else if (ravenStatus === 'complete') {
          status = 'complete';
        } else if (ravenStatus === 'in-progress' && status !== 'complete') {
          status = 'current';
        }
      }
      if (definition.id === 'verification') {
        const verificationStatus = wizardState?.verification?.status ?? 'pending';
        if (verificationState.error) {
          status = 'error';
          error = verificationState.error;
        } else if (verificationStatus === 'error') {
          status = 'error';
          error =
            wizardState?.verification?.error ?? 'Verification checks reported failures.';
        } else if (verificationStatus === 'complete') {
          status = 'complete';
        }
      }
      return {
        ...definition,
        status,
        error,
      } satisfies SetupStepDefinition;
    });
  }, [
    currentIndex,
    foundationState.error,
    foundationEnvErrors,
    envErrors,
    ravenEnvErrors,
    ravenError,
    ravenStatus,
    wizardState?.raven?.error,
    verificationState.error,
    wizardState?.verification?.status,
    wizardState?.verification?.error,
    discordValidationError,
    portalError,
  ]);

  const currentStep = steps[currentIndex] ?? steps[0];

  const ravenWizardDetailMessage = useMemo(() => {
    if (ravenDetail?.message && ravenDetail.message.trim()) {
      return ravenDetail.message.trim();
    }

    const rawDetail = wizardState?.raven?.detail;
    if (typeof rawDetail === 'string' && rawDetail.trim()) {
      try {
        const parsed = JSON.parse(rawDetail);
        if (parsed && typeof parsed === 'object') {
          const candidate = (parsed as Record<string, unknown>).message;
          if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
          }
        }
      } catch {
        return rawDetail.trim();
      }
    }

    return null;
  }, [ravenDetail?.message, wizardState?.raven?.detail]);

  const raven = useMemo<RavenStepState>(
    () => ({
      detection: ravenDetection,
      health: ravenHealth,
      launch: ravenLaunchState,
      error: ravenError,
      wizardStatus: ravenStatus,
      wizardDetail: ravenWizardDetailMessage,
      wizardError: wizardState?.raven?.error ?? null,
    }),
    [
      ravenDetection,
      ravenHealth,
      ravenLaunchState,
      ravenError,
      ravenStatus,
      ravenWizardDetailMessage,
      wizardState?.raven?.error,
    ],
  );

  const nextLabel = useMemo(() => {
    switch (currentStepId) {
      case 'foundation':
        if (foundationState.running) {
          return 'Bootstrapping…';
        }
        if (foundationState.completed) {
          return 'Continue';
        }
        return 'Bootstrap foundation';
      case 'portal':
        if (portalInstalling || portalStatus === 'in-progress') {
          return 'Waiting for Portal…';
        }
        if (!discordValidatedAt) {
          return 'Validate Portal';
        }
        return 'Configure Raven';
      case 'raven':
        if (ravenLaunchState.status === 'launching') {
          return 'Launching Raven…';
        }
        if (ravenDetection.status === 'detecting') {
          return 'Detecting…';
        }
        if (ravenHealth.checking) {
          return 'Checking health…';
        }
        if (!install.started) {
          return 'Launch Raven';
        }
        return 'View logs';
      case 'verification':
        return 'Finish';
      default:
        return 'Next';
    }
  }, [
    currentStepId,
    foundationState.running,
    foundationState.completed,
    portalInstalling,
    portalStatus,
    discordValidatedAt,
    install.started,
    ravenLaunchState.status,
    ravenDetection.status,
    ravenHealth.checking,
  ]);

  const onValidateDiscord = useCallback(async () => {
    if (!portalEnv.DISCORD_BOT_TOKEN || !portalEnv.DISCORD_GUILD_ID) {
      setDiscordValidationError('Provide a Discord bot token and guild id.');
      return;
    }

    setDiscordValidationError('');
    setPortalError('');
    setDiscordValidating(true);
    setDiscordValidation(null);
    let validated = false;
    try {
      const payload = await validatePortalDiscordConfig({
        token: portalEnv.DISCORD_BOT_TOKEN,
        guildId: portalEnv.DISCORD_GUILD_ID,
      });
      validated = true;
      setDiscordValidation(payload);
      const validatedTimestamp = new Date().toISOString();
      setDiscordValidatedAt(validatedTimestamp);

      const overridesSnapshot = collectPortalOverrides(overrides);
      const nextStatus: WizardStepStatus = portalStatus === 'complete' ? 'complete' : 'in-progress';
      const detail = buildPortalDetail({
        overrides: overridesSnapshot,
        discord: { validatedAt: validatedTimestamp },
      });

      setPortalInstallTriggeredAt(validatedTimestamp);
      await persistPortalDetail(detail, nextStatus, null);
      setPortalInstalling(true);

      const portalEnvOverrides = overridesSnapshot[PORTAL_SERVICE_NAME] ?? {};
      const installPayload: ServiceInstallRequestEntry[] =
        Object.keys(portalEnvOverrides).length > 0
          ? [{ name: PORTAL_SERVICE_NAME, env: portalEnvOverrides }]
          : [{ name: PORTAL_SERVICE_NAME }];

      await installServices(installPayload);

      await persistPortalDetail(
        buildPortalDetail({
          overrides: overridesSnapshot,
          discord: { validatedAt: validatedTimestamp },
          installTriggeredAt: validatedTimestamp,
        }),
        undefined,
        null,
      );

      await refreshWizard().catch(() => {});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to verify Discord configuration.';
      if (!validated) {
        setDiscordValidationError(message);
        setDiscordValidation(null);
        setDiscordValidatedAt(null);
        await persistPortalDetail(
          buildPortalDetail({
            discord: { validatedAt: null },
          }),
          'error',
          message,
        ).catch(() => {});
      } else {
        setPortalError(message);
        setPortalInstalling(false);
        setPortalInstallTriggeredAt(null);
        await persistPortalDetail(
          buildPortalDetail(),
          'error',
          message,
        ).catch(() => {});
      }
    } finally {
      setDiscordValidating(false);
    }
  }, [
    portalEnv.DISCORD_BOT_TOKEN,
    portalEnv.DISCORD_GUILD_ID,
    overrides,
    buildPortalDetail,
    persistPortalDetail,
    refreshWizard,
    portalStatus,
  ]);

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
        const roleTimestamp = new Date().toISOString();
        setDiscordRoleCreatedAt(roleTimestamp);
        await persistPortalDetail(
          buildPortalDetail({ discord: { roleCreatedAt: roleTimestamp } }),
          portalStatus === 'complete' ? 'complete' : undefined,
          null,
        );
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
    [
      portalEnv.DISCORD_BOT_TOKEN,
      portalEnv.DISCORD_GUILD_ID,
      updateEnvValue,
      onValidateDiscord,
      buildPortalDetail,
      persistPortalDetail,
      portalStatus,
    ],
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
        const channelTimestamp = new Date().toISOString();
        setDiscordChannelCreatedAt(channelTimestamp);
        await persistPortalDetail(
          buildPortalDetail({ discord: { channelCreatedAt: channelTimestamp } }),
          portalStatus === 'complete' ? 'complete' : undefined,
          null,
        );
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
    [
      portalEnv.DISCORD_BOT_TOKEN,
      portalEnv.DISCORD_GUILD_ID,
      onValidateDiscord,
      buildPortalDetail,
      persistPortalDetail,
      portalStatus,
    ],
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
      lastRoleCreatedAt: discordRoleCreatedAt,
      lastChannelCreatedAt: discordChannelCreatedAt,
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
      discordRoleCreatedAt,
      discordChannelCreatedAt,
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
    foundationSections,
    foundationState,
    envSections,
    ravenSections,
    updateEnvValue,
    environmentError,
    portalError,
    envErrors,
    raven,
    detectRaven,
    checkRavenHealth,
    discord,
    install,
    verification: verificationState,
    refreshVerification: loadVerificationStatus,
    runVerificationChecks,
    completeSetup,
    wizardState,
    wizardLoading,
    wizardError,
    refreshWizard,
  };
}
