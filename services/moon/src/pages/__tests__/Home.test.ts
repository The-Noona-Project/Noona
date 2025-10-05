import {mount} from '@vue/test-utils';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import HomePage from '../Home.vue';
import {__resetServiceInstallationStore} from '../../utils/serviceInstallationStore.js';

const flushAsync = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const stubs = {
  Header: {template: '<div><slot /></div>'},
  'v-container': {template: '<div><slot /></div>'},
  'v-row': {template: '<div><slot /></div>'},
  'v-col': {template: '<div><slot /></div>'},
  'v-card': {template: '<div><slot /></div>'},
  'v-card-title': {template: '<div><slot /></div>'},
  'v-card-subtitle': {template: '<div><slot /></div>'},
  'v-card-actions': {template: '<div><slot /></div>'},
  'v-img': {template: '<img />'},
  'v-icon': {template: '<i />'},
  'v-divider': {template: '<hr />'},
  'v-btn': {
    template:
      '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
  },
};

describe('Home page service cards', () => {
  beforeEach(() => {
    __resetServiceInstallationStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error cleanup test-only global
    delete global.fetch;
  });

  it('disables service navigation while installation is pending', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        services: [
          {name: 'noona-warden', installed: false},
        ],
      }),
    });

    // @ts-expect-error assign test fetch mock
    global.fetch = fetchMock;

    const wrapper = mount(HomePage, {
      global: {stubs},
    });

    await flushAsync();
    await wrapper.vm.$nextTick();

    const wardenButton = wrapper.get('[data-test="service-link-/warden"]');
    expect(wardenButton.attributes('disabled')).toBeDefined();
    expect(wardenButton.attributes('title')).toContain('pending');
  });

  it('enables service navigation once installation is complete', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        services: [
          {name: 'noona-warden', installed: true},
          {name: 'noona-vault', installed: true},
          {name: 'noona-portal', installed: true},
          {name: 'noona-sage', installed: true},
          {name: 'noona-moon', installed: true},
          {name: 'noona-raven', installed: true},
          {name: 'noona-oracle', installed: true},
        ],
      }),
    });

    // @ts-expect-error assign test fetch mock
    global.fetch = fetchMock;

    const wrapper = mount(HomePage, {
      global: {stubs},
    });

    await flushAsync();
    await wrapper.vm.$nextTick();

    const wardenButton = wrapper.get('[data-test="service-link-/warden"]');
    expect(wardenButton.attributes('disabled')).toBeUndefined();
    expect(wardenButton.attributes('title')).toBeUndefined();
  });
});

