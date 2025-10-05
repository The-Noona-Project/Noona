import { describe, expect, it, afterEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import Setup from '../Setup.vue';

const createFetchMock = (logEntries, requests) =>
  vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url.includes('/installation/logs')) {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ entries: logEntries }),
      };
    }

    if (url.includes('/api/setup/services')) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ services: [] }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    };
  });

describe('Setup installer logs', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
    vi.restoreAllMocks();
  });

  it('limits rendered log lines to the display count after showing more logs', async () => {
    const logEntries = [
      { message: 'first log entry' },
      { message: 'second log entry' },
      { message: 'third log entry' },
      { message: 'fourth log entry' },
      { message: 'fifth log entry' },
    ];
    const requests = [];

    global.fetch = createFetchMock(logEntries, requests);

    const wrapper = mount(Setup, {
      global: {
        stubs: {
          Header: {
            template: '<div><slot /></div>',
          },
        },
        config: {
          compilerOptions: {
            isCustomElement: (tag) => tag.startsWith('v-'),
          },
        },
      },
    });

    await flushPromises();

    wrapper.vm.showProgressDetails = true;
    await nextTick();

    await wrapper.vm.fetchInstallLogs();
    await flushPromises();
    await nextTick();

    const showMoreButton = wrapper.find('[data-test="show-more-logs"]');
    expect(showMoreButton.exists()).toBe(true);

    await showMoreButton.trigger('click');
    await flushPromises();
    await nextTick();

    const logRequests = requests.filter((url) => url.includes('/installation/logs'));
    expect(logRequests.at(-1)).toContain('limit=3');

    const renderedLogs = wrapper
      .find('.progress-logs__body')
      .text()
      .split('\n')
      .filter((line) => line.trim().length > 0);

    expect(renderedLogs.length).toBeLessThanOrEqual(3);
    expect(renderedLogs).toEqual([
      'third log entry',
      'fourth log entry',
      'fifth log entry',
    ]);
  });

  it('keeps the Discord connection intact while refreshing services during portal install', async () => {
    vi.useFakeTimers();

    const createServiceEntry = (overrides = {}) => ({
      name: 'noona-portal',
      installed: false,
      required: true,
      envConfig: [
        { key: 'DISCORD_BOT_TOKEN', defaultValue: '' },
        { key: 'DISCORD_GUILD_ID', defaultValue: '' },
      ],
      ...overrides,
    });

    const baseServices = [
      createServiceEntry(),
      { name: 'noona-vault', installed: false, required: true },
      { name: 'noona-redis', installed: true, required: true },
      { name: 'noona-mongo', installed: true, required: true },
    ];

    const installedServices = [
      createServiceEntry({ installed: true }),
      { name: 'noona-vault', installed: true, required: true },
      { name: 'noona-redis', installed: true, required: true },
      { name: 'noona-mongo', installed: true, required: true },
    ];

    const serviceResponses = [
      { services: baseServices },
      { services: installedServices },
      { services: installedServices },
    ];

    global.fetch = vi.fn(async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = init?.method || (typeof input === 'object' ? input?.method : undefined);

      if (url.includes('/install/progress')) {
        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              status: 'complete',
              percent: 100,
              items: [],
            }),
        };
      }

      if (url.includes('/installation/logs')) {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ entries: [] }),
        };
      }

      if (url.includes('/noona-portal/test')) {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        };
      }

      if (url.includes('/setup/install') && method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              results: [
                { name: 'noona-portal', status: 'installed' },
                { name: 'noona-vault', status: 'installed' },
              ],
            }),
        };
      }

      if (url.includes('/api/setup/services')) {
        const response = serviceResponses.shift() || serviceResponses[serviceResponses.length - 1];
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve(response),
        };
      }

      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      };
    });

    const wrapper = mount(Setup, {
      global: {
        stubs: {
          Header: {
            template: '<div><slot /></div>',
          },
        },
        config: {
          compilerOptions: {
            isCustomElement: (tag) => tag.startsWith('v-'),
          },
        },
      },
    });

    try {
      await flushPromises();
      await nextTick();

      wrapper.vm.activeStepIndex = 1;
      await nextTick();

      const portalEnv = wrapper.vm.portalEnvForm;
      portalEnv.DISCORD_BOT_TOKEN = 'token-value';
      portalEnv.DISCORD_GUILD_ID = 'guild-value';

      const state = wrapper.vm.portalDiscordState;
      state.verified = true;
      state.guild = { id: 'guild-value', name: 'Guild Name' };
      state.roles = [{ id: 'role-id', name: 'Role Name' }];
      state.channels = [{ id: 'channel-id', name: 'Channel Name' }];
      state.lastVerifiedToken = 'token-value';
      state.lastVerifiedGuildId = 'guild-value';

      const resetSpy = vi.spyOn(wrapper.vm, 'resetPortalDiscordState');
      resetSpy.mockClear();

      await wrapper.vm.installCurrentStep();
      await flushPromises();
      await nextTick();
      vi.runAllTimers();
      await flushPromises();
      await nextTick();

      expect(wrapper.vm.portalDiscordState.verified).toBe(true);
      expect(wrapper.vm.portalDiscordState.guild).toEqual({
        id: 'guild-value',
        name: 'Guild Name',
      });
      expect(wrapper.vm.portalDiscordState.roles).toEqual([
        { id: 'role-id', name: 'Role Name' },
      ]);
      expect(wrapper.vm.portalDiscordState.channels).toEqual([
        { id: 'channel-id', name: 'Channel Name' },
      ]);
      expect(resetSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
