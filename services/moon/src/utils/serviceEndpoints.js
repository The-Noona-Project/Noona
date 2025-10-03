const API_PREFIX = '/api';
const DEFAULT_SERVICE_PATHS = [
  '/api/setup/services',
  '/api/services?includeInstalled=false',
  '/api/services',
];

const ENV_BASE_KEYS = [
  'VITE_API_BASE',
  'VITE_API_TARGET',
  'VITE_SAGE_BASE',
  'VITE_SAGE_URL',
  'VITE_SETUP_BASE',
  'VITE_SETUP_URL',
  'VITE_WARDEN_BASE',
  'VITE_WARDEN_URL',
];

const ENV_ENDPOINT_KEYS = [
  'VITE_SETUP_SERVICES_URL',
  'VITE_WARDEN_SERVICES_URL',
];

const STATIC_BASE_CANDIDATES = [
  'http://localhost:3004',
  'http://127.0.0.1:3004',
  'http://host.docker.internal:3004',
  'http://localhost:4001',
  'http://127.0.0.1:4001',
  'http://host.docker.internal:4001',
];

const ABSOLUTE_URL_REGEX = /^https?:\/\//i;

const normalizeBaseUrl = (candidate) => {
  if (typeof candidate !== 'string') return null;

  const trimmed = candidate.trim();
  if (!trimmed) return null;

  if (!ABSOLUTE_URL_REGEX.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, '');
    if (pathname && pathname !== '/') {
      return `${url.protocol}//${url.host}${pathname}`;
    }

    return `${url.protocol}//${url.host}`;
  } catch (error) {
    return null;
  }
};

const normalizeEndpoint = (candidate) => {
  if (typeof candidate !== 'string') return null;

  const trimmed = candidate.trim();
  if (!trimmed) return null;

  if (!ABSOLUTE_URL_REGEX.test(trimmed)) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch (error) {
    return null;
  }
};

const joinBaseAndPath = (base, path) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (!base) {
    return normalizedPath;
  }

  const sanitizedBase = base.endsWith('/') ? base.slice(0, -1) : base;

  if (sanitizedBase.endsWith(API_PREFIX) && normalizedPath.startsWith(API_PREFIX)) {
    return `${sanitizedBase}${normalizedPath.slice(API_PREFIX.length)}`;
  }

  return `${sanitizedBase}${normalizedPath}`;
};

const addUnique = (collection, value) => {
  if (!value) return;
  if (collection.seen.has(value)) return;
  collection.seen.add(value);
  collection.items.push(value);
};

const collectEnvCandidates = (collection, baseCandidates) => {
  for (const key of ENV_BASE_KEYS) {
    const value = import.meta.env?.[key];
    if (!value) continue;

    if (/\/services\b/i.test(value)) {
      const endpoint = normalizeEndpoint(value);
      if (endpoint) {
        addUnique(collection, endpoint);
      }
      continue;
    }

    const normalized = normalizeBaseUrl(value);
    if (normalized) {
      baseCandidates.add(normalized);
    }
  }

  for (const key of ENV_ENDPOINT_KEYS) {
    const value = import.meta.env?.[key];
    if (!value) continue;

    const normalized = normalizeEndpoint(value);
    if (normalized) {
      addUnique(collection, normalized);
    }
  }
};

const collectWindowCandidates = (baseCandidates) => {
  if (typeof window === 'undefined') {
    for (const candidate of STATIC_BASE_CANDIDATES) {
      const normalized = normalizeBaseUrl(candidate);
      if (normalized) {
        baseCandidates.add(normalized);
      }
    }
    return;
  }

  const { origin, protocol, hostname, port } = window.location;

  if (origin) {
    const normalizedOrigin = normalizeBaseUrl(origin);
    if (normalizedOrigin) {
      baseCandidates.add(normalizedOrigin);
    }
  }

  const scheme = protocol === 'https:' ? 'https:' : 'http:';
  const hostnames = new Set([hostname, 'localhost', '127.0.0.1']);
  const preferredPorts = new Set(['3004', '4001']);

  if (port) {
    if (port === '3000' || port === '4173') {
      preferredPorts.add('3004');
      preferredPorts.add('4001');
    }
  }

  for (const host of hostnames) {
    if (!host) continue;
    for (const preferredPort of preferredPorts) {
      const normalized = normalizeBaseUrl(`${scheme}//${host}:${preferredPort}`);
      if (normalized) {
        baseCandidates.add(normalized);
      }
    }
  }

  for (const candidate of STATIC_BASE_CANDIDATES) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) {
      baseCandidates.add(normalized);
    }
  }
};

export const buildServiceEndpointCandidates = () => {
  const collection = { items: [], seen: new Set() };
  const baseCandidates = new Set(['']);

  collectEnvCandidates(collection, baseCandidates);
  collectWindowCandidates(baseCandidates);

  for (const base of baseCandidates) {
    for (const path of DEFAULT_SERVICE_PATHS) {
      addUnique(collection, joinBaseAndPath(base, path));
    }
  }

  return collection.items;
};
