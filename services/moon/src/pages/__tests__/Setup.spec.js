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
});
