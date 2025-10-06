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

const PRIORITIES = {
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
};

const createEndpointCollection = () => ({
  [PRIORITIES.HIGH]: [],
  [PRIORITIES.NORMAL]: [],
  [PRIORITIES.LOW]: [],
  seen: new Set(),
});

const addEndpointValue = (collection, value, priority) => {
  if (typeof value !== 'string') return;

  const trimmed = value.trim();
  if (!trimmed) return;
  if (collection.seen.has(trimmed)) return;

  collection.seen.add(trimmed);
  collection[priority].push(trimmed);
};

const addDirectEndpointCandidate = (collection, candidate, priority) => {
  const normalized = normalizeEndpoint(candidate);
  if (normalized) {
    addEndpointValue(collection, normalized, priority);
  }
};

const addBaseEndpointCandidates = (collection, base, priority) => {
  if (base !== '') {
    const normalized = normalizeBaseUrl(base);
    if (!normalized) {
      return;
    }
    base = normalized;
  }

  for (const path of DEFAULT_SERVICE_PATHS) {
    addEndpointValue(collection, joinBaseAndPath(base, path), priority);
  }
};

const collectEnvCandidates = (collection) => {
  for (const key of ENV_BASE_KEYS) {
    const value = import.meta.env?.[key];
    if (!value) continue;

    if (/\/services\b/i.test(value)) {
      addDirectEndpointCandidate(collection, value, PRIORITIES.HIGH);
      continue;
    }

    addBaseEndpointCandidates(collection, value, PRIORITIES.HIGH);
  }

  for (const key of ENV_ENDPOINT_KEYS) {
    const value = import.meta.env?.[key];
    if (!value) continue;

    addDirectEndpointCandidate(collection, value, PRIORITIES.HIGH);
  }
};

const collectWindowCandidates = (collection) => {
  if (typeof window === 'undefined') {
    for (const candidate of STATIC_BASE_CANDIDATES) {
      addBaseEndpointCandidates(collection, candidate, PRIORITIES.NORMAL);
    }
    return;
  }

  const { origin, protocol, hostname, port } = window.location;

  if (origin) {
    const priority = port === '3000' || port === '4173' ? PRIORITIES.LOW : PRIORITIES.NORMAL;
    addBaseEndpointCandidates(collection, origin, priority);
  }

  const scheme = protocol === 'https:' ? 'https:' : 'http:';
  const hostnames = new Set([hostname, 'localhost', '127.0.0.1']);
  const preferredPorts = new Set(['3004', '4001']);

  if (port && port !== '3000' && port !== '4173') {
    preferredPorts.add(port);
  }

  for (const host of hostnames) {
    if (!host) continue;
    for (const preferredPort of preferredPorts) {
      addBaseEndpointCandidates(
        collection,
        `${scheme}//${host}:${preferredPort}`,
        PRIORITIES.HIGH,
      );
    }
  }

  for (const candidate of STATIC_BASE_CANDIDATES) {
    addBaseEndpointCandidates(collection, candidate, PRIORITIES.NORMAL);
  }
};

export const buildServiceEndpointCandidates = () => {
  const collection = createEndpointCollection();

  collectEnvCandidates(collection);
  collectWindowCandidates(collection);
  addBaseEndpointCandidates(collection, '', PRIORITIES.LOW);

  return [
    ...collection[PRIORITIES.HIGH],
    ...collection[PRIORITIES.NORMAL],
    ...collection[PRIORITIES.LOW],
  ];
};
