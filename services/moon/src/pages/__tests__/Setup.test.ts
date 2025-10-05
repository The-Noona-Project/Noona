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
    props: ['modelValue', 'disabled', 'readonly', 'dataTest'],
    emits: ['update:modelValue'],
    template:
      '<input :value="modelValue" :disabled="disabled" :readonly="readonly" :data-test="dataTest || `text-field`" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  'v-select': {
    props: ['modelValue', 'disabled', 'dataTest'],
    emits: ['update:modelValue'],
    template:
      '<select :value="modelValue" :disabled="disabled" :data-test="dataTest || `boolean-select`" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>',
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
      envConfig: [
        { key: 'DISCORD_BOT_TOKEN', label: 'Discord Bot Token' },
        { key: 'DISCORD_GUILD_ID', label: 'Discord Guild ID' },
        { key: 'DISCORD_GUILD_ROLE_ID', label: 'Default Role' },
        {
          key: 'DISCORD_ONBOARDING_CHANNEL_ID',
          label: 'Onboarding Channel',
        },
        { key: 'PORTAL_HTTP_TIMEOUT', label: 'Portal HTTP Timeout' },
      ],
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

const PORTAL_TOKEN_KEY = 'DISCORD_BOT_TOKEN';
const PORTAL_GUILD_KEY = 'DISCORD_GUILD_ID';

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

  it('requires Discord validation before unlocking portal resources', async () => {
    const discordPayload = {
      guild: { id: '123', name: 'Noona Guild' },
      roles: [{ id: '456', name: 'Reader', position: 1 }],
      channels: [{ id: '789', name: 'general', type: 'GUILD_TEXT' }],
    };

    const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<Response>>((url) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';
      if (target.includes('/discord/validate')) {
        return Promise.resolve(mockResponse(discordPayload));
      }
      return Promise.resolve(mockResponse(servicesPayload));
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const wrapper = mount(SetupPage, {
      global: { stubs },
    });

    await flushAsync();
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as unknown as {
      $: {
        setupState: {
          activeStepIndex: number;
          expandedCards: string[];
          envForms: Record<string, Record<string, string>>;
          portalDiscordState: { verified: boolean };
          connectPortalDiscord: () => Promise<void>;
        };
      };
    };

    vm.$.setupState.activeStepIndex = 1;
    vm.$.setupState.expandedCards = ['noona-portal'];
    await wrapper.vm.$nextTick();

    const timeoutFieldBefore = wrapper.find('input[data-test="portal-field-PORTAL_HTTP_TIMEOUT"]');
    expect(timeoutFieldBefore.attributes('disabled')).toBeDefined();

    const roleSelectBefore = wrapper.find(
      'select[data-test="portal-resource-DISCORD_GUILD_ROLE_ID"]',
    );
    expect(roleSelectBefore.attributes('disabled')).toBeDefined();

    const envForms = vm.$.setupState.envForms;
    envForms['noona-portal'][PORTAL_TOKEN_KEY] = 'token-value';
    envForms['noona-portal'][PORTAL_GUILD_KEY] = 'guild-value';
    await wrapper.vm.$nextTick();

    await vm.$.setupState.connectPortalDiscord();
    await flushAsync();
    await wrapper.vm.$nextTick();

    expect(vm.$.setupState.portalDiscordState.verified).toBe(true);

    const roleSelectAfter = wrapper.find(
      'select[data-test="portal-resource-DISCORD_GUILD_ROLE_ID"]',
    );
    expect(roleSelectAfter.attributes('disabled')).toBeUndefined();

    const timeoutFieldAfter = wrapper.find('input[data-test="portal-field-PORTAL_HTTP_TIMEOUT"]');
    expect(timeoutFieldAfter.attributes('disabled')).toBeUndefined();

    const successAlert = wrapper.find('[data-test="portal-success"]');
    expect(successAlert.exists()).toBe(true);
  });

  it('persists new Discord resources created from the setup flow', async () => {
    const discordPayload = {
      guild: { id: '123', name: 'Noona Guild' },
      roles: [{ id: '456', name: 'Reader', position: 1 }],
      channels: [{ id: '789', name: 'general', type: 'GUILD_TEXT' }],
    };

    const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<Response>>((url) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';
      if (target.includes('/discord/roles')) {
        return Promise.resolve(
          mockResponse({ role: { id: 'role-2', name: 'Curator', position: 2 } }),
        );
      }
      if (target.includes('/discord/channels')) {
        return Promise.resolve(
          mockResponse({ channel: { id: 'channel-2', name: 'welcome', type: 'GUILD_TEXT' } }),
        );
      }
      if (target.includes('/discord/validate')) {
        return Promise.resolve(mockResponse(discordPayload));
      }
      return Promise.resolve(mockResponse(servicesPayload));
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    const wrapper = mount(SetupPage, {
      global: { stubs },
    });

    await flushAsync();
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as unknown as {
      $: {
        setupState: {
          activeStepIndex: number;
          expandedCards: string[];
          envForms: Record<string, Record<string, string>>;
          portalDiscordState: {
            verified: boolean;
            createRole: { name: string };
            createChannel: { name: string };
          };
          connectPortalDiscord: () => Promise<void>;
          handleCreatePortalRole: (fieldKey: string) => Promise<void>;
          handleCreatePortalChannel: (fieldKey: string) => Promise<void>;
        };
      };
    };

    vm.$.setupState.activeStepIndex = 1;
    vm.$.setupState.expandedCards = ['noona-portal'];
    const envForms = vm.$.setupState.envForms;
    envForms['noona-portal'][PORTAL_TOKEN_KEY] = 'token-value';
    envForms['noona-portal'][PORTAL_GUILD_KEY] = 'guild-value';

    await vm.$.setupState.connectPortalDiscord();
    await flushAsync();
    await wrapper.vm.$nextTick();

    vm.$.setupState.portalDiscordState.createRole.name = 'Curator';
    await vm.$.setupState.handleCreatePortalRole('DISCORD_GUILD_ROLE_ID');
    await flushAsync();
    await wrapper.vm.$nextTick();

    expect(envForms['noona-portal'].DISCORD_GUILD_ROLE_ID).toBe('role-2');

    vm.$.setupState.portalDiscordState.createChannel.name = 'welcome';
    await vm.$.setupState.handleCreatePortalChannel('DISCORD_ONBOARDING_CHANNEL_ID');
    await flushAsync();
    await wrapper.vm.$nextTick();

    expect(envForms['noona-portal'].DISCORD_ONBOARDING_CHANNEL_ID).toBe('channel-2');
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
      .mockResolvedValueOnce(mockResponse({ status: 'installing', percent: 0, items: [] }))
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
