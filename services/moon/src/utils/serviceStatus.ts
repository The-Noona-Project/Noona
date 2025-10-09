export type ServiceStatusValue = string | boolean | undefined | null;

export interface ServiceEntry {
  name: string;
  installed?: boolean;
  status?: ServiceStatusValue;
  [key: string]: unknown;
}

const INSTALLED_STATUS_VALUES = new Set([
  'installed',
  'ready',
  'healthy',
  'running',
  'complete',
  'completed',
  'success',
  'successful',
]);

function normalizeName(name: unknown): string {
  if (typeof name !== 'string') {
    return '';
  }

  return name.trim();
}

export function resolveServiceInstalled(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  const record = entry as Record<string, unknown> & { installed?: unknown };

  if (record.installed === true) {
    return true;
  }

  const candidate = (record.installed ?? (record as Record<string, unknown>).status) as
    | string
    | boolean
    | undefined;

  if (typeof candidate === 'boolean') {
    return candidate;
  }

  if (typeof candidate === 'string') {
    const normalized = candidate.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (INSTALLED_STATUS_VALUES.has(normalized)) {
      return true;
    }
  }

  return false;
}

export function normalizeServiceEntry(entry: unknown): ServiceEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const name = normalizeName(record.name);
  if (!name) {
    return null;
  }

  return {
    ...record,
    name,
    installed: resolveServiceInstalled(entry),
  } satisfies ServiceEntry;
}

export function normalizeServiceList(payload: unknown): ServiceEntry[] {
  const raw = Array.isArray((payload as { services?: unknown[] } | undefined)?.services)
    ? ((payload as { services?: unknown[] }).services as unknown[])
    : Array.isArray(payload)
    ? (payload as unknown[])
    : [];

  const normalized: ServiceEntry[] = [];

  for (const entry of raw) {
    const normalizedEntry = normalizeServiceEntry(entry);
    if (normalizedEntry) {
      normalized.push(normalizedEntry);
    }
  }

  return normalized;
}

export function getInstalledStatusValues(): Set<string> {
  return new Set(INSTALLED_STATUS_VALUES);
}
