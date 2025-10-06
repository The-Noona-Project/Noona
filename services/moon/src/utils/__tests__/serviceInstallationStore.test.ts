import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetServiceInstallationStore,
  useServiceInstallationStore,
} from '../../utils/serviceInstallationStore.js';

const mockResponse = (body: unknown) => ({
  ok: true,
  json: async () => body,
});

describe('serviceInstallationStore', () => {
  beforeEach(() => {
    __resetServiceInstallationStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalises string installation statuses as installed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse({
          services: [
            { name: 'noona-raven', installed: 'installed' },
            { name: 'noona-portal', status: 'ready' },
            { name: 'noona-mongo', installed: false },
          ],
        }),
      );

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as typeof fetch);

    const store = useServiceInstallationStore();
    const services = await store.ensureLoaded();

    const raven = services.find((service) => service.name === 'noona-raven');
    expect(raven?.installed).toBe(true);

    const portal = services.find((service) => service.name === 'noona-portal');
    expect(portal?.installed).toBe(true);

    const mongo = services.find((service) => service.name === 'noona-mongo');
    expect(mongo?.installed).toBe(false);
  });
});
