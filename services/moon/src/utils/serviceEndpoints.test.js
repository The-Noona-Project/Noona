import {afterAll, afterEach, beforeEach, describe, expect, it} from 'vitest';

import {buildServiceEndpointCandidates} from './serviceEndpoints.js';

const ORIGINAL_ENV_ENTRIES = Object.entries(import.meta.env).filter(([key]) =>
  key.startsWith('VITE_'),
);

const ORIGINAL_HREF = typeof window !== 'undefined' ? window.location.href : '';

const resetViteEnv = () => {
  for (const key of Object.keys(import.meta.env)) {
    if (key.startsWith('VITE_')) {
      delete import.meta.env[key];
    }
  }

  for (const [key, value] of ORIGINAL_ENV_ENTRIES) {
    import.meta.env[key] = value;
  }
};

describe('buildServiceEndpointCandidates', () => {
  beforeEach(() => {
    resetViteEnv();
    if (typeof window !== 'undefined') {
      window.location.href = ORIGINAL_HREF || 'http://localhost:4173/';
    }
  });

  afterEach(() => {
    resetViteEnv();
    if (typeof window !== 'undefined') {
      window.location.href = ORIGINAL_HREF || 'http://localhost:4173/';
    }
  });

  afterAll(() => {
    resetViteEnv();
    if (typeof window !== 'undefined' && ORIGINAL_HREF) {
      window.location.href = ORIGINAL_HREF;
    }
  });

  it('prioritizes environment-provided base URLs before other candidates', () => {
    import.meta.env.VITE_API_BASE = 'http://warden.local/api';

    const candidates = buildServiceEndpointCandidates();

    expect(candidates[0]).toBe('http://warden.local/api/setup/services');
    expect(candidates[1]).toBe('http://warden.local/api/services?includeInstalled=false');
    expect(candidates[2]).toBe('http://warden.local/api/services');
  });

  it('prefers backend-friendly localhost ports before same-origin fallbacks', () => {
    if (typeof window !== 'undefined') {
      window.location.href = 'http://localhost:3000/';
    }

    const candidates = buildServiceEndpointCandidates();

    expect(candidates[0]).toBe('http://localhost:3004/api/setup/services');
    expect(candidates[1]).toBe('http://localhost:3004/api/services?includeInstalled=false');

    const relativeIndex = candidates.indexOf('/api/setup/services');
    expect(relativeIndex).toBeGreaterThan(1);
    expect(candidates.slice(-3)).toEqual([
      '/api/setup/services',
      '/api/services?includeInstalled=false',
      '/api/services',
    ]);
  });

  it('includes explicit service endpoints supplied via environment variables once', () => {
    import.meta.env.VITE_WARDEN_SERVICES_URL =
      'http://warden.local/api/services?includeInstalled=false';

    const candidates = buildServiceEndpointCandidates();

    const occurrences = candidates.filter((candidate) =>
      candidate === 'http://warden.local/api/services?includeInstalled=false',
    );

    expect(occurrences).toHaveLength(1);
    expect(candidates[0]).toBe('http://warden.local/api/services?includeInstalled=false');
  });
});
