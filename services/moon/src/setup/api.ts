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

export interface WizardStepState {
  status: WizardStepStatus;
  detail: string | null;
  error: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface WizardState {
  version: number;
  updatedAt: string | null;
  foundation: WizardStepState;
  portal: WizardStepState;
  raven: WizardStepState;
  verification: WizardStepState;
}

export type WizardStepKey = keyof Pick<WizardState, 'foundation' | 'portal' | 'raven' | 'verification'>;

export interface WizardStateUpdate {
  step: WizardStepKey;
  status?: WizardStepStatus;
  detail?: string | null;
  error?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
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
