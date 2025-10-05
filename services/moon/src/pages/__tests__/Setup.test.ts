import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SetupPage from '../Setup.vue';

const mockResponse = (payload: unknown) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  headers: { get: () => null },
} as Response);

const flushAsync = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const stubs = {
  Header: { template: '<div><slot /></div>' },
  'v-container': { template: '<div><slot /></div>' },
  'v-row': { template: '<div><slot /></div>' },
  'v-col': { template: '<div><slot /></div>' },
  'v-card': { template: '<div><slot /></div>' },
  'v-card-title': { template: '<div><slot /></div>' },
  'v-card-subtitle': { template: '<div><slot /></div>' },
  'v-card-text': { template: '<div><slot /></div>' },
  'v-alert': {
    template: '<div><slot /><slot name="append" /></div>',
  },
  'v-btn': {
    template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
  },
  'v-chip': { template: '<span><slot /></span>' },
  'v-progress-linear': {
    template: '<div role="progressbar" v-bind="$attrs"></div>',
  },
  'v-progress-circular': {
    template: '<div role="progressbar" v-bind="$attrs"></div>',
  },
  'v-expand-transition': { template: '<div><slot /></div>' },
  'v-text-field': {
    template: '<input data-test="text-field" />',
  },
  'v-select': {
    template: '<select data-test="boolean-select"><slot /></select>',
  },
  'v-checkbox': {
    props: ['modelValue', 'disabled'],
    template:
      '<input type="checkbox" :checked="modelValue" :disabled="disabled" data-test="checkbox" />',
  },
  'v-icon': { template: '<i><slot /></i>' },
  'v-chip-group': { template: '<div><slot /></div>' },
  'v-chip-group-item': { template: '<div><slot /></div>' },
  'v-card-actions': { template: '<div><slot /></div>' },
  'v-list': { template: '<div><slot /></div>' },
  'v-divider': { template: '<hr />' },
};

const servicesPayload = {
  services: [
    {
      name: 'noona-redis',
      installed: false,
      envConfig: [
        { key: 'REDIS_TLS', defaultValue: 'true', label: 'TLS Enabled' },
      ],
    },
    {
      name: 'noona-mongo',
      installed: false,
      envConfig: [],
    },
    {
      name: 'noona-portal',
      installed: false,
      envConfig: [],
    },
    {
      name: 'noona-vault',
      installed: false,
      envConfig: [],
    },
    {
      name: 'noona-raven',
      installed: false,
      envConfig: [],
    },
  ],
};

describe('Setup page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the dependencies step with service cards', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(servicesPayload));

    const wrapper = mount(SetupPage, {
      global: { stubs },
    });

    await flushAsync();
    await wrapper.vm.$nextTick();

    const steps = wrapper.findAll('.setup-stepper__item');
    expect(steps).toHaveLength(3);

    const cardTitles = wrapper
      .findAll('.setup-service-card__title .text-subtitle-1')
      .map((node) => node.text());

    expect(cardTitles).toContain('noona-redis');
    expect(cardTitles).toContain('noona-mongo');
    expect(cardTitles).not.toContain('noona-portal');
  });

  it('renders boolean environment fields as dropdowns inside cards', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(servicesPayload));

    const wrapper = mount(SetupPage, {
      global: { stubs },
    });

    await flushAsync();
    await wrapper.vm.$nextTick();

    const selects = wrapper.findAll('select[data-test="boolean-select"]');
    expect(selects.length).toBeGreaterThan(0);
  });

  it('shows the success message after completing the Raven install', async () => {
    const initialServices = {
      services: [
        { name: 'noona-redis', installed: true, envConfig: [] },
        { name: 'noona-mongo', installed: true, envConfig: [] },
        { name: 'noona-portal', installed: true, envConfig: [] },
        { name: 'noona-vault', installed: true, envConfig: [] },
        { name: 'noona-raven', installed: false, envConfig: [] },
      ],
    };

    const postResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ name: 'noona-raven', status: 'installed' }],
      }),
      headers: { get: () => null },
    } as Response;

    const refreshedServices = {
      services: [
        { name: 'noona-redis', installed: true, envConfig: [] },
        { name: 'noona-mongo', installed: true, envConfig: [] },
        { name: 'noona-portal', installed: true, envConfig: [] },
        { name: 'noona-vault', installed: true, envConfig: [] },
        { name: 'noona-raven', installed: true, envConfig: [] },
      ],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(initialServices))
      .mockResolvedValueOnce(mockResponse({ items: [], status: 'Installing' }))
      .mockResolvedValueOnce(postResponse)
      .mockResolvedValueOnce(mockResponse(refreshedServices));

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const wrapper = mount(SetupPage, {
      global: { stubs },
    });

    await flushAsync();
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as unknown as {
      $: {
        setupState: {
          portalAction: { success: boolean };
          ravenAction: { success: boolean };
          selectedServices: string[];
        };
      };
    };

    vm.$.setupState.portalAction.success = true;
    vm.$.setupState.selectedServices = ['noona-raven'];
    await wrapper.vm.$nextTick();

    const stepButtons = wrapper.findAll('.setup-stepper__item');
    await stepButtons[2].trigger('click');

    const installButton = wrapper.find('.setup-step__install');
    await installButton.trigger('click');

    await flushAsync();
    await wrapper.vm.$nextTick();

    await flushAsync();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Thanks for installing Noona—check out Raven');
  });
});
