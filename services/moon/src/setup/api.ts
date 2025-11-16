export interface FetchJsonOptions extends RequestInit {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT = 15000;

async function fetchWithTimeout(
  input: RequestInfo | URL,
  { timeoutMs = DEFAULT_TIMEOUT, signal, ...init }: FetchJsonOptions = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const abortListener = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', abortListener);
    }
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    if (signal) {
      signal.removeEventListener?.('abort', abortListener as EventListener);
    }
  }
}

async function parseJson<T>(response: Response, fallbackError: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload?.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : fallbackError;
    throw new Error(message);
  }

  return payload as T;
}

export interface ServiceInstallRequestEntry {
  name: string;
  env?: Record<string, string>;
}

export interface ServiceInstallResponse {
  results: Array<Record<string, unknown>>;
}

export interface InstallProgressItem {
  name?: string;
  status?: string;
  percent?: number | null;
  [key: string]: unknown;
}

export interface InstallProgressSummary {
  status: string;
  percent: number | null;
  items: InstallProgressItem[];
}

export interface InstallLogsResponse {
  service?: string;
  entries: Array<Record<string, unknown>>;
  summary?: Record<string, unknown> | null;
}

export type WizardStepStatus = 'pending' | 'in-progress' | 'complete' | 'error' | 'skipped';

export interface WizardTimelineActor {
  id: string | null;
  type: string | null;
  label: string | null;
  avatarUrl: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface WizardTimelineEvent {
  id: string | null;
  timestamp: string;
  status: string | null;
  message: string | null;
  detail: string | null;
  code: string | null;
  actor: WizardTimelineActor | null;
  context?: Record<string, unknown> | null;
}

export interface WizardStepState {
  status: WizardStepStatus;
  detail: string | null;
  error: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  actor: WizardTimelineActor | null;
  retries: number;
  timeline: WizardTimelineEvent[];
}

export interface WizardState {
  version: number;
  updatedAt: string | null;
  completed: boolean;
  foundation: WizardStepState;
  portal: WizardStepState;
  raven: WizardStepState;
  verification: WizardStepState;
}

export type WizardStepKey = keyof Pick<WizardState, 'foundation' | 'portal' | 'raven' | 'verification'>;

export interface WizardStepMetadata {
  id: WizardStepKey;
  title: string;
  description: string;
  optional?: boolean;
  icon?: string | null;
  capabilities?: string[];
}

export interface WizardMetadataResponse {
  steps: WizardStepMetadata[];
  features: Record<string, boolean>;
}

export interface WizardStateUpdate {
  step: WizardStepKey;
  status?: WizardStepStatus;
  detail?: string | null;
  error?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
  actor?: WizardTimelineActor | null;
  retries?: number;
  timeline?: WizardTimelineEvent[];
}

export interface WizardStepHistoryResponse {
  step: WizardStepKey;
  events: WizardTimelineEvent[];
}

export interface WizardBroadcastResponse {
  wizard: WizardState;
  event: WizardTimelineEvent | null;
  step: WizardStepKey;
}

export interface WizardBroadcastRequest {
  message: string;
  detail?: string | null;
  status?: WizardStepStatus;
  eventStatus?: string | null;
  code?: string | null;
  actor?: WizardTimelineActor | null;
  limit?: number;
  error?: string | null;
  retries?: number;
  completedAt?: string | null;
  updatedAt?: string | null;
  context?: Record<string, unknown> | null;
}

export interface WizardResetPayload {
  actor?: WizardTimelineActor | null;
  detail?: string | null;
  message?: string | null;
  limit?: number;
  context?: Record<string, unknown> | null;
}

export interface VerificationHealthSummary {
  service: string;
  status: string;
  message: string | null;
  checkedAt: string | null;
  success: boolean;
  detail?: unknown;
}

export interface VerificationCheckResult {
  service: string;
  label: string;
  success: boolean;
  supported: boolean;
  status: 'pass' | 'fail' | 'skipped';
  message: string | null;
  detail?: unknown;
  checkedAt: string | null;
  duration: number | null;
}

export interface VerificationSummaryState {
  lastRunAt: string | null;
  checks: VerificationCheckResult[];
}

export interface VerificationStatusResponse {
  wizard: WizardState | null;
  summary: VerificationSummaryState | null;
  health: {
    warden: VerificationHealthSummary | null;
    sage: VerificationHealthSummary | null;
  };
}

function normalizeVerificationHealthEntry(
  entry: unknown,
  service: string,
): VerificationHealthSummary | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const payload = entry as Record<string, unknown>;
  const message =
    typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : null;

  return {
    service,
    status: typeof payload.status === 'string' ? payload.status : 'unknown',
    message,
    checkedAt:
      typeof payload.checkedAt === 'string' && payload.checkedAt.trim()
        ? payload.checkedAt.trim()
        : null,
    success: payload.success === true,
    detail: payload.detail,
  } satisfies VerificationHealthSummary;
}

function normalizeVerificationCheck(entry: unknown): VerificationCheckResult | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const payload = entry as Record<string, unknown>;
  const service = typeof payload.service === 'string' ? payload.service : '';
  const label = typeof payload.label === 'string' ? payload.label : service;
  const supported = payload.supported !== false;
  const success = supported && payload.success === true;
  const status = supported ? (success ? 'pass' : 'fail') : 'skipped';
  const message =
    typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : null;

  return {
    service,
    label,
    success,
    supported,
    status,
    message,
    detail: payload.detail,
    checkedAt:
      typeof payload.checkedAt === 'string' && payload.checkedAt.trim()
        ? payload.checkedAt.trim()
        : null,
    duration:
      typeof payload.duration === 'number' && Number.isFinite(payload.duration)
        ? payload.duration
        : null,
  } satisfies VerificationCheckResult;
}

function normalizeVerificationSummary(summary: unknown): VerificationSummaryState | null {
  if (!summary || typeof summary !== 'object') {
    return null;
  }

  const payload = summary as Record<string, unknown>;
  const lastRunAt =
    typeof payload.lastRunAt === 'string' && payload.lastRunAt.trim()
      ? payload.lastRunAt.trim()
      : null;

  const checks = Array.isArray(payload.checks)
    ? payload.checks
        .map((entry) => normalizeVerificationCheck(entry))
        .filter((entry): entry is VerificationCheckResult => Boolean(entry))
    : [];

  return {
    lastRunAt,
    checks,
  } satisfies VerificationSummaryState;
}

function normalizeVerificationResponse(
  payload: Record<string, unknown>,
): VerificationStatusResponse {
  const wizard =
    payload.wizard && typeof payload.wizard === 'object'
      ? (payload.wizard as WizardState)
      : null;

  const summary = normalizeVerificationSummary(payload.summary);
  const healthPayload =
    payload.health && typeof payload.health === 'object'
      ? (payload.health as Record<string, unknown>)
      : {};

  return {
    wizard,
    summary,
    health: {
      warden: normalizeVerificationHealthEntry(healthPayload?.warden, 'noona-warden'),
      sage: normalizeVerificationHealthEntry(healthPayload?.sage, 'noona-sage'),
    },
  } satisfies VerificationStatusResponse;
}

export async function fetchInstallableServices(options?: FetchJsonOptions) {
  const response = await fetchWithTimeout('/api/setup/services', {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  return await parseJson<{ services?: unknown }>(
    response,
    'Unable to retrieve installable services.',
  );
}

export async function installServices(
  services: ServiceInstallRequestEntry[],
  options?: FetchJsonOptions,
): Promise<ServiceInstallResponse> {
  const response = await fetchWithTimeout('/api/setup/install', {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    body: JSON.stringify({ services }),
  });
  return await parseJson<ServiceInstallResponse>(response, 'Failed to install services.');
}

export async function fetchInstallProgress(options?: FetchJsonOptions): Promise<InstallProgressSummary> {
  const response = await fetchWithTimeout('/api/setup/services/install/progress', options);
  const payload = await parseJson<Record<string, unknown>>(response, 'Unable to retrieve installation progress.');
  const items = Array.isArray(payload.items) ? (payload.items as InstallProgressItem[]) : [];
  return {
    status: typeof payload.status === 'string' ? payload.status : 'idle',
    percent: typeof payload.percent === 'number' ? payload.percent : null,
    items,
  } satisfies InstallProgressSummary;
}

export async function fetchInstallationLogs(
  limit: number,
  options?: FetchJsonOptions,
): Promise<InstallLogsResponse> {
  const response = await fetchWithTimeout(
    `/api/setup/services/installation/logs?limit=${encodeURIComponent(String(limit))}`,
    options,
  );
  return await parseJson<InstallLogsResponse>(response, 'Unable to retrieve installation logs.');
}

export async function fetchServiceLogs(
  name: string,
  limit: number,
  options?: FetchJsonOptions,
): Promise<InstallLogsResponse> {
  const response = await fetchWithTimeout(
    `/api/setup/services/${encodeURIComponent(name)}/logs?limit=${encodeURIComponent(String(limit))}`,
    options,
  );
  return await parseJson<InstallLogsResponse>(response, 'Unable to retrieve service logs.');
}

export async function fetchWizardMetadata(options?: FetchJsonOptions): Promise<WizardMetadataResponse> {
  const response = await fetchWithTimeout('/api/setup/wizard/metadata', {
    ...options,
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...(options?.headers ?? {}),
    },
  });

  return await parseJson<WizardMetadataResponse>(response, 'Unable to load setup wizard metadata.');
}

export async function fetchWizardState(options?: FetchJsonOptions): Promise<WizardState> {
  const response = await fetchWithTimeout('/api/setup/wizard/state', {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  return await parseJson<WizardState>(response, 'Unable to load setup wizard state.');
}

export async function updateWizardState(
  updates: WizardStateUpdate | WizardStateUpdate[],
  options?: FetchJsonOptions,
): Promise<WizardState> {
  const payload = Array.isArray(updates) ? updates : [updates];
  const response = await fetchWithTimeout('/api/setup/wizard/state', {
    ...options,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    body: JSON.stringify({ updates: payload }),
  });
  return await parseJson<WizardState>(response, 'Unable to update setup wizard state.');
}

export async function fetchWizardStepHistory(
  step: WizardStepKey,
  limit = 25,
  options?: FetchJsonOptions,
): Promise<WizardStepHistoryResponse> {
  const query = Number.isFinite(limit) ? `?limit=${encodeURIComponent(String(limit))}` : '';
  const response = await fetchWithTimeout(
    `/api/setup/wizard/steps/${encodeURIComponent(step)}/history${query}`,
    {
      ...options,
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(options?.headers ?? {}),
      },
    },
  );
  return await parseJson<WizardStepHistoryResponse>(
    response,
    'Unable to load wizard activity history.',
  );
}

export async function resetWizardStep(
  step: WizardStepKey,
  payload?: WizardResetPayload,
  options?: FetchJsonOptions,
): Promise<WizardState> {
  const response = await fetchWithTimeout(
    `/api/setup/wizard/steps/${encodeURIComponent(step)}/reset`,
    {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
      body: JSON.stringify(payload ?? {}),
    },
  );

  const result = await parseJson<{ wizard: WizardState }>(
    response,
    'Unable to reset wizard step.',
  );
  return result.wizard;
}

export async function broadcastWizardSummary(
  step: WizardStepKey,
  payload: WizardBroadcastRequest,
  options?: FetchJsonOptions,
): Promise<WizardBroadcastResponse> {
  const response = await fetchWithTimeout(
    `/api/setup/wizard/steps/${encodeURIComponent(step)}/broadcast`,
    {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
      body: JSON.stringify(payload),
    },
  );

  return await parseJson<WizardBroadcastResponse>(
    response,
    'Unable to broadcast wizard summary.',
  );
}

export interface PortalDiscordValidationPayload {
  guild?: Record<string, unknown> | null;
  channels?: Array<Record<string, unknown>> | null;
  roles?: Array<Record<string, unknown>> | null;
}

export interface PortalDiscordCredentials {
  token: string;
  guildId: string;
}

export interface RavenDetectionResponse {
  detection: { mountPath?: string | null } | null;
}

export async function validatePortalDiscordConfig(
  credentials: PortalDiscordCredentials,
  options?: FetchJsonOptions,
) {
  const response = await fetchWithTimeout('/api/setup/services/noona-portal/discord/validate', {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    body: JSON.stringify(credentials),
  });

  return await parseJson<PortalDiscordValidationPayload>(
    response,
    'Unable to verify Discord configuration.',
  );
}

export async function createPortalDiscordRole(
  payload: PortalDiscordCredentials & { name: string },
  options?: FetchJsonOptions,
) {
  const response = await fetchWithTimeout('/api/setup/services/noona-portal/discord/roles', {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

  return await parseJson<Record<string, unknown>>(
    response,
    'Unable to create Discord role.',
  );
}

export async function createPortalDiscordChannel(
  payload: PortalDiscordCredentials & { name: string; type: string },
  options?: FetchJsonOptions,
) {
  const response = await fetchWithTimeout('/api/setup/services/noona-portal/discord/channels', {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    body: JSON.stringify(payload),
  });

  return await parseJson<Record<string, unknown>>(
    response,
    'Unable to create Discord channel.',
  );
}

export async function pullRavenContainer(
  env: Record<string, string>,
  options?: FetchJsonOptions,
) {
  const response = await fetchWithTimeout('/api/setup/services/noona-raven/pull', {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    body: JSON.stringify({ env }),
  });
  return await parseJson<Record<string, unknown>>(
    response,
    'Unable to pull Raven container.',
  );
}

export async function startRavenContainer(
  env: Record<string, string>,
  options?: FetchJsonOptions,
) {
  const response = await fetchWithTimeout('/api/setup/services/noona-raven/start', {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
    body: JSON.stringify({ env }),
  });
  return await parseJson<Record<string, unknown>>(
    response,
    'Unable to start Raven container.',
  );
}

export async function detectRavenMount(
  options?: FetchJsonOptions,
): Promise<RavenDetectionResponse> {
  const response = await fetchWithTimeout('/api/setup/services/noona-raven/detect', {
    ...options,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  return await parseJson<RavenDetectionResponse>(
    response,
    'Unable to detect Kavita data mount.',
  );
}

export async function fetchServiceHealth(
  name: string,
  options?: FetchJsonOptions,
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(
    `/api/setup/services/${encodeURIComponent(name)}/health`,
    options,
  );
  return await parseJson<Record<string, unknown>>(
    response,
    'Unable to retrieve service health.',
  );
}

export async function fetchVerificationStatus(
  options?: FetchJsonOptions,
): Promise<VerificationStatusResponse> {
  const response = await fetchWithTimeout('/api/setup/verification/status', {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  const payload = await parseJson<Record<string, unknown>>(
    response,
    'Unable to load verification status.',
  );
  return normalizeVerificationResponse(payload);
}

export async function runVerificationChecks(
  options?: FetchJsonOptions,
): Promise<VerificationStatusResponse> {
  const response = await fetchWithTimeout('/api/setup/verification/checks', {
    ...options,
    method: 'POST',
    headers: {
      accept: 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  const payload = await parseJson<Record<string, unknown>>(
    response,
    'Unable to run verification checks.',
  );
  return normalizeVerificationResponse(payload);
}

export async function completeWizardSetup(
  options?: FetchJsonOptions,
): Promise<VerificationStatusResponse> {
  const response = await fetchWithTimeout('/api/setup/wizard/complete', {
    ...options,
    method: 'POST',
    headers: {
      accept: 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  const payload = await parseJson<Record<string, unknown>>(
    response,
    'Unable to complete setup.',
  );
  return normalizeVerificationResponse(payload);
}
