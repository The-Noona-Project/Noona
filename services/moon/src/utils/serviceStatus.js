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

function normalizeName(name) {
  if (typeof name !== 'string') {
    return '';
  }

  return name.trim();
}

export function resolveServiceInstalled(entry) {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  if (entry.installed === true) {
    return true;
  }

  const candidate = entry.installed ?? entry.status;
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

export function normalizeServiceEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const name = normalizeName(entry.name);
  if (!name) {
    return null;
  }

  return {
    ...entry,
    name,
    installed: resolveServiceInstalled(entry),
  };
}

export function normalizeServiceList(payload) {
  const raw = Array.isArray(payload?.services)
    ? payload.services
    : Array.isArray(payload)
    ? payload
    : [];

  const normalized = [];

  for (const entry of raw) {
    const normalisedEntry = normalizeServiceEntry(entry);
    if (normalisedEntry) {
      normalized.push(normalisedEntry);
    }
  }

  return normalized;
}

export function getInstalledStatusValues() {
  return new Set(INSTALLED_STATUS_VALUES);
}
