import {
  NdjsonEnvelope,
  SelectionPreview,
  ServiceCatalogEntry,
  ServiceSelection,
  WizardHistoryResponse,
  WizardMetadata,
  WizardProgressPayload,
  WizardState,
} from './types';

const jsonHeaders = {
  'Content-Type': 'application/json',
};

const ensureOk = async (response: Response): Promise<void> => {
  if (response.ok) return;
  let message = response.statusText;
  try {
    const payload = await response.json();
    message = (payload as { error?: string })?.error ?? message;
  } catch (error) {
    if (error instanceof Error && error.message) {
      message = `${message}: ${error.message}`;
    }
  }
  throw new Error(message || 'Request failed');
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  await ensureOk(response);
  return (await response.json()) as T;
};

export const loadWizardMetadata = () => fetchJson<WizardMetadata>('/api/setup/wizard/metadata');
export const loadWizardState = () => fetchJson<WizardState>('/api/setup/wizard/state');
export const loadWizardProgress = () => fetchJson<WizardProgressPayload>('/api/wizard/progress');
export const loadWizardHistory = (step: string, limit?: number) =>
  fetchJson<WizardHistoryResponse>(`/api/setup/wizard/steps/${step}/history${limit ? `?limit=${limit}` : ''}`);
export const loadServiceCatalog = () => fetchJson<{ services: ServiceCatalogEntry[] }>('/api/setup/services');

export const streamServicePreview = async (
  services: ServiceSelection[],
): Promise<NdjsonEnvelope<SelectionPreview>[]> => {
  const response = await fetch('/api/setup/services/preview', {
    method: 'POST',
    headers: {
      ...jsonHeaders,
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify({ services }),
  });
  await ensureOk(response);
  return readNdjsonStream<NdjsonEnvelope<SelectionPreview>>(response);
};

export const streamServiceValidation = async (
  services: ServiceSelection[],
): Promise<NdjsonEnvelope<{ services: ServiceSelection[] }>[]> => {
  const response = await fetch('/api/setup/services/validate', {
    method: 'POST',
    headers: {
      ...jsonHeaders,
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify({ services }),
  });
  await ensureOk(response);
  return readNdjsonStream<NdjsonEnvelope<{ services: ServiceSelection[] }>>(response);
};

export const readNdjsonStream = async <T>(response: Response): Promise<T[]> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-ndjson') && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: T[] = [];
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) {
          chunks.push(JSON.parse(line) as T);
        }
        newlineIndex = buffer.indexOf('\n');
      }
    }

    const remainder = buffer.trim();
    if (remainder) {
      chunks.push(JSON.parse(remainder) as T);
    }

    return chunks;
  }

  const fallback = (await response.json()) as unknown;
  if (Array.isArray(fallback)) {
    return fallback as T[];
  }
  return [fallback as T];
};
