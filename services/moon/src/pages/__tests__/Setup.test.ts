import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SetupPage from '../Setup.vue';

const stubs = {
  Header: { template: '<div><slot /></div>' },
  'v-container': { template: '<div><slot /></div>' },
  'v-row': { template: '<div><slot /></div>' },
  'v-col': { template: '<div><slot /></div>' },
  'v-card': { template: '<div><slot /></div>' },
  'v-card-title': { template: '<div><slot /></div>' },
  'v-card-subtitle': { template: '<div><slot /></div>' },
  'v-card-text': { template: '<div><slot /></div>' },
  'v-card-actions': { template: '<div><slot /></div>' },
  'v-alert': { template: '<div><slot /><slot name="append" /></div>' },
  'v-btn': { template: '<button><slot /></button>' },
  'v-chip': { template: '<div><slot /></div>' },
  'v-list': { template: '<div><slot /></div>' },
  'v-divider': { template: '<hr />' },
  'v-progress-linear': { template: '<div role="progressbar" v-bind="$attrs"></div>' },
  'v-progress-circular': { template: '<div role="progressbar" v-bind="$attrs"></div>' },
  'v-expand-transition': { template: '<div><slot /></div>' },
  'v-text-field': { template: '<input />' },
  'v-icon': { template: '<i><slot /></i>' },
  SetupListItem: { template: '<div />' },
};

describe('Setup page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a download progress bar while services are loading', () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}) as unknown as Promise<Response>,
    );

    const wrapper = mount(SetupPage, {
      global: {
        stubs,
      },
    });

    const progressBar = wrapper.find('[aria-label="Downloading services"]');
    expect(progressBar.exists()).toBe(true);
  });
});
