import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SetupPage from '../Setup.vue';

const mockResponse = (payload: unknown) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  headers: { get: () => null },
} as Response);

const mockErrorResponse = (status = 500, payload: unknown = { error: 'Request failed' }) => ({
  ok: false,
  status,
  json: async () => payload,
  headers: { get: () => null },
} as Response);

const flushAsync = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const unwrap = <T>(input: T | { value: T }): T => {
  if (input && typeof input === 'object' && 'value' in (input as Record<string, unknown>)) {
    return (input as { value: T }).value;
  }

  return input as T;
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

const cloneServicesPayload = () =>
  JSON.parse(JSON.stringify(servicesPayload)) as typeof servicesPayload;

const PORTAL_TOKEN_KEY = 'DISCORD_BOT_TOKEN';
const PORTAL_GUILD_KEY = 'DISCORD_GUILD_ID';

describe('Setup page', () => {
  beforeEach(() => {
    for (const service of servicesPayload.services) {
      service.installed = false;
    }
  });

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

  it('renders required role fields as role dropdowns after Discord validation', async () => {
    const discordPayload = {
      guild: { id: '123', name: 'Noona Guild' },
      roles: [
        { id: '456', name: 'Reader', position: 1 },
        { id: '789', name: 'Writer', position: 2 },
      ],
      channels: [],
    };

    const requiredRoleServices = cloneServicesPayload();
    const portalService = requiredRoleServices.services.find(
      (service) => service.name === 'noona-portal',
    );
    if (portalService) {
      portalService.envConfig = [
        ...portalService.envConfig,
        { key: 'REQUIRED_ROLE_DING', label: 'Required Role Ding' },
      ];
    }

    const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<Response>>((url) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';
      if (target.includes('/discord/validate')) {
        return Promise.resolve(mockResponse(discordPayload));
      }
      return Promise.resolve(mockResponse(requiredRoleServices));
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
          getPortalSelectItems: (field: { key: string }) => Array<{ value: string }>;
        };
      };
    };

    vm.$.setupState.activeStepIndex = 1;
    vm.$.setupState.expandedCards = ['noona-portal'];
    await wrapper.vm.$nextTick();

    const requiredRoleSelectBefore = wrapper.find(
      'select[data-test="portal-resource-REQUIRED_ROLE_DING"]',
    );
    expect(requiredRoleSelectBefore.exists()).toBe(true);
    expect(requiredRoleSelectBefore.attributes('disabled')).toBeDefined();

    const envForms = vm.$.setupState.envForms;
    envForms['noona-portal'][PORTAL_TOKEN_KEY] = 'token-value';
    envForms['noona-portal'][PORTAL_GUILD_KEY] = 'guild-value';
    await wrapper.vm.$nextTick();

    await vm.$.setupState.connectPortalDiscord();
    await flushAsync();
    await wrapper.vm.$nextTick();

    expect(vm.$.setupState.portalDiscordState.verified).toBe(true);

    const requiredRoleSelectAfter = wrapper.find(
      'select[data-test="portal-resource-REQUIRED_ROLE_DING"]',
    );
    expect(requiredRoleSelectAfter.attributes('disabled')).toBeUndefined();

    const selectItems = vm.$.setupState.getPortalSelectItems({ key: 'REQUIRED_ROLE_DING' });
    expect(selectItems).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: '456' })]),
    );
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

  it('resets install state and re-enables step actions when switching steps', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(servicesPayload));

    const wrapper = mount(SetupPage, {
      global: { stubs },
    });

    await flushAsync();
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as unknown as {
      $: {
        setupState: {
          state: { services: Array<{ name: string; installed: boolean }> };
          goToStep: (index: number) => void;
          installError: string;
          installResults: null | { status: string; results: Array<Record<string, unknown>> };
          installSuccessMessageVisible: boolean;
          showProgressDetails: boolean;
          installLogs: string;
          portalAction: {
            loading: boolean;
            success: boolean;
            error: string;
            completed: boolean;
          };
          ravenAction: {
            loading: boolean;
            success: boolean;
            error: string;
          };
        };
      };
    };

    for (const service of vm.$.setupState.state.services) {
      if (service.name === 'noona-redis' || service.name === 'noona-mongo') {
        service.installed = true;
      }
    }

    vm.$.setupState.goToStep(1);
    await wrapper.vm.$nextTick();

    for (const service of vm.$.setupState.state.services) {
      if (service.name === 'noona-portal' || service.name === 'noona-vault') {
        service.installed = true;
      }
    }

    vm.$.setupState.installError = 'Install failed';
    vm.$.setupState.installResults = {
      status: 'failed',
      results: [{ name: 'noona-portal', status: 'error', error: 'bad' }],
    };
    vm.$.setupState.installSuccessMessageVisible = true;
    vm.$.setupState.showProgressDetails = true;
    vm.$.setupState.installLogs = 'previous logs';

    vm.$.setupState.portalAction.loading = true;
    vm.$.setupState.portalAction.success = true;
    vm.$.setupState.portalAction.error = 'Test failed';
    vm.$.setupState.portalAction.completed = true;

    vm.$.setupState.ravenAction.loading = true;
    vm.$.setupState.ravenAction.success = true;
    vm.$.setupState.ravenAction.error = 'Raven failed';

    await wrapper.vm.$nextTick();

    const installButtonBefore = wrapper.find('button.setup-step__install');
    expect(installButtonBefore.exists()).toBe(true);
    expect(installButtonBefore.attributes('disabled')).toBeDefined();

    const nextButtonBefore = wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Next step');
    expect(nextButtonBefore).toBeTruthy();
    expect(nextButtonBefore?.attributes('disabled')).toBeUndefined();

    vm.$.setupState.goToStep(0);
    await wrapper.vm.$nextTick();

    expect(vm.$.setupState.installResults).toBeNull();
    expect(vm.$.setupState.installError).toBe('');
    expect(vm.$.setupState.installSuccessMessageVisible).toBe(false);
    expect(vm.$.setupState.showProgressDetails).toBe(false);
    expect(vm.$.setupState.installLogs).toBe('');

    expect(vm.$.setupState.portalAction.loading).toBe(false);
    expect(vm.$.setupState.portalAction.success).toBe(false);
    expect(vm.$.setupState.portalAction.error).toBe('');

    expect(vm.$.setupState.ravenAction.loading).toBe(false);
    expect(vm.$.setupState.ravenAction.success).toBe(false);
    expect(vm.$.setupState.ravenAction.error).toBe('');

    vm.$.setupState.goToStep(1);
    await wrapper.vm.$nextTick();

    const installButtonAfter = wrapper.find('button.setup-step__install');
    expect(installButtonAfter.exists()).toBe(true);
    expect(installButtonAfter.attributes('disabled')).toBeUndefined();
    const infoToggle = wrapper.find('[data-test="step-info-toggle"]');
    expect(infoToggle.exists()).toBe(true);
    await infoToggle.trigger('click');
    wrapper.vm.showStepInfo = true;
    await wrapper.vm.$nextTick();
    const infoPanel = wrapper.find('.setup-step__info-panel');
    expect(infoPanel.exists()).toBe(true);
    expect(infoPanel.text()).toContain('Installing this step automatically starts the Portal bot');
    expect(wrapper.text()).not.toContain('Portal bot verified successfully.');
    expect(wrapper.text()).not.toContain('Portal install failed');

    const nextButtonAfter = wrapper
      .findAll('button')
      .find((btn) => btn.text() === 'Next step');
    expect(nextButtonAfter).toBeTruthy();
    expect(nextButtonAfter?.attributes('disabled')).toBeDefined();
  });

  it('derives Discord endpoints from the active services endpoint', async () => {
    const discordPayload = {
      guild: { id: '123', name: 'Noona Guild' },
      roles: [{ id: '456', name: 'Reader', position: 1 }],
      channels: [{ id: '789', name: 'general', type: 'GUILD_TEXT' }],
    };

    const fetchMock = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      (url) => {
        const target =
          typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';
        if (target.includes('/discord/roles')) {
          return Promise.resolve(
            mockResponse({ role: { id: 'role-2', name: 'Curator', position: 2 } }),
          );
        }
        if (target.includes('/discord/channels')) {
          return Promise.resolve(
            mockResponse({
              channel: { id: 'channel-2', name: 'welcome', type: 'GUILD_TEXT' },
            }),
          );
        }
        if (target.includes('/discord/validate')) {
          return Promise.resolve(mockResponse(discordPayload));
        }
        return Promise.resolve(mockResponse(servicesPayload));
      },
    );

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
          activeServicesEndpoint: string;
          connectPortalDiscord: () => Promise<void>;
          handleCreatePortalRole: (fieldKey: string) => Promise<void>;
          handleCreatePortalChannel: (fieldKey: string) => Promise<void>;
        };
      };
    };

    vm.$.setupState.activeStepIndex = 1;
    vm.$.setupState.expandedCards = ['noona-portal'];
    vm.$.setupState.activeServicesEndpoint = 'https://sage.example/setup/services';

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

    vm.$.setupState.portalDiscordState.createChannel.name = 'welcome';
    await vm.$.setupState.handleCreatePortalChannel('DISCORD_ONBOARDING_CHANNEL_ID');
    await flushAsync();
    await wrapper.vm.$nextTick();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sage.example/setup/services/noona-portal/discord/validate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sage.example/setup/services/noona-portal/discord/roles',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sage.example/setup/services/noona-portal/discord/channels',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('fetches additional installer logs when the show more control is clicked', async () => {
    const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<Response>>((url) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';
      if (target.includes('/installation/logs')) {
        return Promise.resolve(
          mockResponse({
            entries: [
              { message: 'Installer started' },
              { message: 'Preparing dependencies' },
              { message: 'Downloading assets' },
              { message: 'Configuring services' },
              { message: 'Installer ready' },
            ],
          }),
        );
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
          showProgressDetails: boolean;
        };
      };
    };

    vm.$.setupState.showProgressDetails = true;

    await wrapper.vm.$nextTick();
    await flushAsync();

    const logRequestsAfterOpen = fetchMock.mock.calls
      .map(([arg]) => (typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : ''))
      .filter((call) => call.includes('/installation/logs'));

    expect(logRequestsAfterOpen).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/api/setup/services/installation/logs?limit=3'),
      ]),
    );

    const initialLogs = wrapper
      .find('.progress-logs__body')
      .text()
      .split('\n')
      .filter((line) => line.trim().length > 0);

    expect(initialLogs).toEqual([
      'Downloading assets',
      'Configuring services',
      'Installer ready',
    ]);

    const showMoreButton = wrapper.find('[data-test="show-more-logs"]');
    expect(showMoreButton.exists()).toBe(true);

    await showMoreButton.trigger('click');

    await flushAsync();
    await wrapper.vm.$nextTick();

    const logRequests = fetchMock.mock.calls
      .map(([arg]) => (typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : ''))
      .filter((call) => call.includes('/installation/logs'));

    const lastLogRequest = logRequests[logRequests.length - 1];
    expect(lastLogRequest).toContain('/api/setup/services/installation/logs?limit=3');

    const updatedLogs = wrapper
      .find('.progress-logs__body')
      .text()
      .split('\n')
      .filter((line) => line.trim().length > 0);

    expect(updatedLogs).toEqual([
      'Downloading assets',
      'Configuring services',
      'Installer ready',
    ]);
  });

  it('uses the fallback services endpoints for progress and logs when setup services fail', async () => {
    const fetchMock = vi.fn<(url: RequestInfo | URL) => Promise<Response>>((url) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';

      if (target.includes('/api/setup/services') && !target.includes('/install')) {
        return Promise.resolve({
          ok: false,
          status: 502,
          json: async () => ({ error: 'Bad gateway' }),
        } as Response);
      }

      if (target.includes('/api/services?includeInstalled=false') || target.endsWith('/api/services')) {
        return Promise.resolve(mockResponse(servicesPayload));
      }

      if (target.includes('/api/services/install/progress')) {
        return Promise.resolve(
          mockResponse({ status: 'installing', percent: 0, items: [] }),
        );
      }

      if (target.includes('/api/services/installation/logs')) {
        return Promise.resolve(
          mockResponse({
            entries: [
              { message: 'Installer started' },
              { message: 'Preparing dependencies' },
              { message: 'Downloading assets' },
              { message: 'Configuring services' },
              { message: 'Installer ready' },
            ],
          }),
        );
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
          fetchInstallProgress: () => Promise<void>;
          showProgressDetails: boolean;
        };
      };
    };

    await vm.$.setupState.fetchInstallProgress();

    vm.$.setupState.showProgressDetails = true;

    await wrapper.vm.$nextTick();
    await flushAsync();

    const progressRequests = fetchMock.mock.calls
      .map(([arg]) => (typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : ''))
      .filter((call) => call.includes('/install/progress'));

    expect(progressRequests).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/api/services/install/progress'),
      ]),
    );

    const logRequests = fetchMock.mock.calls
      .map(([arg]) => (typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : ''))
      .filter((call) => call.includes('/installation/logs'));

    expect(logRequests).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/api/services/installation/logs?limit=3'),
      ]),
    );

    const initialLogs = wrapper
      .find('.progress-logs__body')
      .text()
      .split('\n')
      .filter((line) => line.trim().length > 0);

    expect(initialLogs).toEqual([
      'Downloading assets',
      'Configuring services',
      'Installer ready',
    ]);

    const showMoreButton = wrapper.find('[data-test="show-more-logs"]');
    expect(showMoreButton.exists()).toBe(true);

    await showMoreButton.trigger('click');

    await flushAsync();
    await wrapper.vm.$nextTick();

    const updatedLogRequests = fetchMock.mock.calls
      .map(([arg]) => (typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : ''))
      .filter((call) => call.includes('/installation/logs'));

    const lastFallbackLogRequest =
      updatedLogRequests[updatedLogRequests.length - 1];
    expect(lastFallbackLogRequest).toContain('/api/services/installation/logs?limit=3');

    const updatedLogs = wrapper
      .find('.progress-logs__body')
      .text()
      .split('\n')
      .filter((line) => line.trim().length > 0);

    expect(updatedLogs).toEqual([
      'Downloading assets',
      'Configuring services',
      'Installer ready',
    ]);
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

    let servicesCallCount = 0;

    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const target =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';

      if (target === '/api/setup/services/noona-raven/detect') {
        return mockResponse({ detection: { mountPath: '/srv/kavita' } });
      }

      if (target.includes('/api/setup/services/install/progress')) {
        return mockResponse({ status: 'installing', percent: 0, items: [] });
      }

      if (target.includes('/api/setup/services/installation/logs')) {
        return mockResponse({ entries: [] });
      }

      if (target.includes('/api/setup/install') && (init?.method || '').toUpperCase() === 'POST') {
        return postResponse;
      }

      if (target.includes('/api/setup/services')) {
        servicesCallCount += 1;
        return servicesCallCount === 1
          ? mockResponse(initialServices)
          : mockResponse(refreshedServices);
      }

      return mockResponse({});
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
          goToStep: (index: number) => void;
          portalAction: { success: boolean; completed: boolean };
          ravenAction: { success: boolean };
          selectedServices: string[];
        };
      };
    };

    vm.$.setupState.portalAction.success = true;
    vm.$.setupState.portalAction.completed = true;
    vm.$.setupState.selectedServices = ['noona-raven'];
    await wrapper.vm.$nextTick();

    vm.$.setupState.goToStep(2);
    await wrapper.vm.$nextTick();

    vm.$.setupState.portalAction.success = true;
    vm.$.setupState.portalAction.completed = true;
    await wrapper.vm.$nextTick();

    vm.$.setupState.activeStepIndex = 2;
    await wrapper.vm.$nextTick();

    await wrapper.vm.installCurrentStep();

    await flushAsync();
    await wrapper.vm.$nextTick();

    await flushAsync();
    await wrapper.vm.$nextTick();

    expect(vm.$.setupState.installResults).not.toBeNull();

    await wrapper.vm.runRavenHandshake();
    await flushAsync();
    await wrapper.vm.$nextTick();

    expect(vm.$.setupState.installSuccessMessageVisible).toBe(true);
    expect(wrapper.text()).toContain('Thanks for installing Noona—check out Raven');
  });

  it('completes the Raven handshake using manual overrides when detection fails', async () => {
    const installedPayload = cloneServicesPayload();
    for (const service of installedPayload.services) {
      service.installed = true;
      if (service.name === 'noona-raven') {
        service.envConfig = [
          { key: 'APPDATA', label: 'Raven Downloads Root' },
          { key: 'KAVITA_DATA_MOUNT', label: 'Kavita Data Mount (Host Path)' },
        ];
      }
    }

    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
        const target =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
        if (target === '/api/setup/services/noona-raven/detect') {
          return Promise.resolve(mockResponse({ detection: null }));
        }

        return Promise.resolve(mockResponse(installedPayload));
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
          goToStep: (index: number) => void;
          activeStepIndex: number;
          portalAction: { completed: boolean; success: boolean };
          ravenAction: { success: boolean; completed: boolean; error: string; message: string };
          envForms: Record<string, Record<string, string>>;
        };
      };
    };

    vm.$.setupState.portalAction.completed = true;
    vm.$.setupState.portalAction.success = true;
    await wrapper.vm.$nextTick();

    vm.$.setupState.goToStep(2);
    await wrapper.vm.$nextTick();

    vm.$.setupState.portalAction.completed = true;
    vm.$.setupState.portalAction.success = true;
    await wrapper.vm.$nextTick();

    vm.$.setupState.activeStepIndex = 2;
    await wrapper.vm.$nextTick();

    const envForms = vm.$.setupState.envForms;
    envForms['noona-raven'].KAVITA_DATA_MOUNT = '/srv/kavita';
    envForms['noona-raven'].APPDATA = '/downloads';

    await wrapper.vm.$nextTick();

    await wrapper.vm.runRavenHandshake();

    await flushAsync();
    await wrapper.vm.$nextTick();

    expect(vm.$.setupState.ravenAction.success).toBe(true);
    expect(vm.$.setupState.ravenAction.completed).toBe(true);
    expect(vm.$.setupState.ravenAction.error).toBe('');
    expect(vm.$.setupState.ravenAction.message).toContain('/srv/kavita');
    expect(vm.$.setupState.ravenAction.message).toContain('→ /downloads');

    expect(fetchMock).toHaveBeenCalledWith('/api/setup/services/noona-raven/detect', {
      method: 'POST',
    });
  });

  it('shows guidance when Raven mount detection fails without manual overrides', async () => {
    const installedPayload = cloneServicesPayload();
    for (const service of installedPayload.services) {
      service.installed = true;
      if (service.name === 'noona-raven') {
        service.envConfig = [
          { key: 'APPDATA', label: 'Raven Downloads Root' },
          { key: 'KAVITA_DATA_MOUNT', label: 'Kavita Data Mount (Host Path)' },
        ];
      }
    }

    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((input, init) => {
        const target =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : '';
        if (target === '/api/setup/services/noona-raven/detect') {
          return Promise.resolve(mockResponse({ detection: null }));
        }

        return Promise.resolve(mockResponse(installedPayload));
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
          goToStep: (index: number) => void;
          activeStepIndex: number;
          portalAction: { completed: boolean; success: boolean };
          ravenAction: { success: boolean; completed: boolean; error: string; message: string };
        };
      };
    };

    vm.$.setupState.portalAction.completed = true;
    vm.$.setupState.portalAction.success = true;
    await wrapper.vm.$nextTick();

    vm.$.setupState.goToStep(2);
    await wrapper.vm.$nextTick();

    vm.$.setupState.portalAction.completed = true;
    vm.$.setupState.portalAction.success = true;
    await wrapper.vm.$nextTick();

    vm.$.setupState.activeStepIndex = 2;
    await wrapper.vm.$nextTick();

    await wrapper.vm.runRavenHandshake();

    await flushAsync();
    await wrapper.vm.$nextTick();

    expect(vm.$.setupState.ravenAction.success).toBe(false);
    expect(vm.$.setupState.ravenAction.completed).toBe(false);
    expect(vm.$.setupState.ravenAction.message).toContain('Checking Raven configuration');
    expect(vm.$.setupState.ravenAction.error).toContain('Kavita data mount not detected automatically');

    expect(fetchMock).toHaveBeenCalledWith('/api/setup/services/noona-raven/detect', {
      method: 'POST',
    });
  });

  it('resets install state and action buttons when moving between steps', async () => {
    const installedPayload = cloneServicesPayload();
    for (const service of installedPayload.services) {
      service.installed = true;
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse(installedPayload));

    const wrapper = mount(SetupPage, {
      global: { stubs },
    });

    await flushAsync();
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as unknown as {
      $: {
        setupState: {
          goToStep: (index: number) => void;
          installError: string;
          installResults: unknown;
          installSuccessMessageVisible: boolean;
          showProgressDetails: boolean;
          installLogs: string;
          portalAction: { loading: boolean; success: boolean; error: string; completed: boolean };
          ravenAction: { loading: boolean; success: boolean; error: string; completed: boolean };
        };
      };
    };

    const { setupState } = vm.$;

    setupState.installError = 'previous error';
    setupState.installResults = { status: 500, results: [{ name: 'noona-portal', status: 'failed' }] };
    setupState.installSuccessMessageVisible = true;
    setupState.showProgressDetails = true;
    setupState.installLogs = 'old logs';
    setupState.portalAction.loading = true;
    setupState.portalAction.success = true;
    setupState.portalAction.error = 'Portal failed previously';
    setupState.portalAction.completed = true;
    setupState.ravenAction.loading = true;
    setupState.ravenAction.success = true;
    setupState.ravenAction.error = 'Raven failed previously';
    setupState.ravenAction.completed = true;

    setupState.goToStep(1);
    await wrapper.vm.$nextTick();

    expect(setupState.installError).toBe('');
    expect(setupState.installResults).toBeNull();
    expect(setupState.installSuccessMessageVisible).toBe(false);
    expect(setupState.showProgressDetails).toBe(false);
    expect(setupState.installLogs).toBe('');
    expect(setupState.portalAction.loading).toBe(false);
    expect(setupState.portalAction.success).toBe(false);
    expect(setupState.portalAction.error).toBe('');
    expect(wrapper.text()).not.toContain('Portal bot verified successfully.');
    expect(wrapper.text()).not.toContain('Portal install failed');
    expect(setupState.ravenAction.loading).toBe(false);
    expect(setupState.ravenAction.success).toBe(false);
    expect(setupState.ravenAction.error).toBe('');
    expect(setupState.ravenAction.completed).toBe(false);
    expect(setupState.ravenAction.message).toBe('');

    const installButton = wrapper.find('button.setup-step__install');
    expect(installButton.exists()).toBe(true);
    expect(installButton.attributes('disabled')).toBeUndefined();
    const infoToggle = wrapper.find('[data-test="step-info-toggle"]');
    expect(infoToggle.exists()).toBe(true);
    await infoToggle.trigger('click');
    wrapper.vm.showStepInfo = true;
    await wrapper.vm.$nextTick();
    const infoPanel = wrapper.find('.setup-step__info-panel');
    expect(infoPanel.exists()).toBe(true);
    expect(infoPanel.text()).toContain('Installing this step automatically starts the Portal bot');

    setupState.goToStep(0);
    await wrapper.vm.$nextTick();

    const nextStepButton = wrapper.find('button.setup-step__next');
    expect(nextStepButton.exists()).toBe(true);
    expect(nextStepButton.attributes('disabled')).toBeUndefined();
  });

  it('installs the portal step before running the portal test', async () => {
    const initialServices = cloneServicesPayload();
    const refreshedServices = cloneServicesPayload();
    for (const service of refreshedServices.services) {
      if (service.name === 'noona-portal' || service.name === 'noona-vault') {
        service.installed = true;
      }
    }

    const serviceResponses = [initialServices, refreshedServices];

    const fetchMock = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (url, init) => {
        const target =
          typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';

        if (target.endsWith('/noona-portal/test')) {
          return mockResponse({ success: true });
        }

        if (target.includes('/api/setup/install')) {
          expect(init?.method).toBe('POST');
          return mockResponse({
            results: [
              { name: 'noona-portal', status: 'installed' },
              { name: 'noona-vault', status: 'installed' },
            ],
          });
        }

        if (target.includes('/api/setup/services/install/progress')) {
          return mockResponse({ status: 'installing', percent: 0, items: [] });
        }

        if (target.includes('/api/setup/services')) {
          const payload = serviceResponses.shift() ?? refreshedServices;
          return mockResponse(payload);
        }

        return mockResponse({});
      },
    );

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
          selectedServices: string[];
          portalAction: { success: boolean; error: string };
        };
      };
    };

    vm.$.setupState.activeStepIndex = 1;
    vm.$.setupState.selectedServices = ['noona-portal', 'noona-vault'];

    await wrapper.vm.$nextTick();

    const installButton = wrapper.find('button.setup-step__install');

    expect(installButton.exists()).toBe(true);

    await installButton.trigger('click');

    await flushAsync();
    await wrapper.vm.$nextTick();
    await flushAsync();
    await wrapper.vm.$nextTick();

    const calls = fetchMock.mock.calls.map(([arg]) =>
      typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : '',
    );

    const installCallIndex = calls.findIndex((call) => call.includes('/api/setup/install'));
    const expectedTestEndpoint = unwrap(
      (vm.$.setupState as Record<string, unknown>).portalTestEndpoint,
    ) as string;
    expect(typeof expectedTestEndpoint).toBe('string');

    const testCallIndex = calls.findIndex((call) => call === expectedTestEndpoint);

    expect(installCallIndex).toBeGreaterThan(-1);
    expect(testCallIndex).toBeGreaterThan(-1);
    expect(installCallIndex).toBeLessThan(testCallIndex);

    expect(vm.$.setupState.portalAction.success).toBe(true);
    expect(vm.$.setupState.portalAction.error).toBe('');
    expect(wrapper.text()).toContain('Portal bot verified successfully.');
  });

  it.each(['unchanged', 'already-installed'])
    ('allows portal verification when install status is %s', async (status) => {
      const initialServices = cloneServicesPayload();
      const refreshedServices = cloneServicesPayload();
      for (const service of refreshedServices.services) {
        if (service.name === 'noona-portal' || service.name === 'noona-vault') {
          service.installed = true;
        }
      }

      const serviceResponses = [initialServices, refreshedServices];

      const fetchMock = vi.fn<
        (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      >(async (url, init) => {
        const target =
          typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';

        if (target.endsWith('/noona-portal/test')) {
          return mockResponse({ success: true });
        }

        if (target.includes('/api/setup/install')) {
          expect(init?.method).toBe('POST');
          return mockResponse({
            results: [
              { name: 'noona-portal', status },
              { name: 'noona-vault', status: 'already-installed' },
            ],
          });
        }

        if (target.includes('/api/setup/services/install/progress')) {
          return mockResponse({ status: 'installing', percent: 0, items: [] });
        }

        if (target.includes('/api/setup/services')) {
          const payload = serviceResponses.shift() ?? refreshedServices;
          return mockResponse(payload);
        }

        return mockResponse({});
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
            selectedServices: string[];
            portalAction: { success: boolean; error: string };
          };
        };
      };

      vm.$.setupState.activeStepIndex = 1;
      vm.$.setupState.selectedServices = ['noona-portal', 'noona-vault'];

      await wrapper.vm.$nextTick();

      const installButton = wrapper.find('button.setup-step__install');

      expect(installButton.exists()).toBe(true);

      await installButton.trigger('click');

      await flushAsync();
      await wrapper.vm.$nextTick();
      await flushAsync();
      await wrapper.vm.$nextTick();

      const calls = fetchMock.mock.calls.map(([arg]) =>
        typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : '',
      );

      const expectedTestEndpoint = unwrap(
        (vm.$.setupState as Record<string, unknown>).portalTestEndpoint,
      ) as string;
      expect(typeof expectedTestEndpoint).toBe('string');

      const installCallIndex = calls.findIndex((call) =>
        call.includes('/api/setup/install'),
      );
      const testCallIndex = calls.findIndex((call) => call === expectedTestEndpoint);

      expect(installCallIndex).toBeGreaterThan(-1);
      expect(testCallIndex).toBeGreaterThan(-1);
      expect(installCallIndex).toBeLessThan(testCallIndex);

      expect(vm.$.setupState.portalAction.success).toBe(true);
      expect(vm.$.setupState.portalAction.error).toBe('');
      expect(wrapper.text()).toContain('Portal bot verified successfully.');
    });

  it('derives the portal test endpoint from the active services endpoint', async () => {
    const initialServices = cloneServicesPayload();
    const refreshedServices = cloneServicesPayload();
    for (const service of refreshedServices.services) {
      if (service.name === 'noona-portal' || service.name === 'noona-vault') {
        service.installed = true;
      }
    }

    const serviceResponses = [initialServices, refreshedServices];
    let resolvedServicesEndpoint = '';

    const fetchMock = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (url, init) => {
        const target =
          typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';

        if (target.endsWith('/noona-portal/test')) {
          const normalizedBase = resolvedServicesEndpoint
            ? resolvedServicesEndpoint.replace(/\/+$/, '')
            : '/api/services';
          const expectedEndpoint = `${normalizedBase}/noona-portal/test`;
          expect(target).toBe(expectedEndpoint);
          return mockResponse({ success: true });
        }

        if (target.endsWith('/services/install')) {
          const normalizedBase = resolvedServicesEndpoint
            ? resolvedServicesEndpoint.replace(/\/+$/, '')
            : '/api/services';
          expect(target).toBe(`${normalizedBase}/install`);
          expect(init?.method).toBe('POST');
          return mockResponse({
            results: [
              { name: 'noona-portal', status: 'installed' },
              { name: 'noona-vault', status: 'installed' },
            ],
          });
        }

        if (target.endsWith('/services/install/progress')) {
          const normalizedBase = resolvedServicesEndpoint
            ? resolvedServicesEndpoint.replace(/\/+$/, '')
            : '/api/services';
          expect(target).toBe(`${normalizedBase}/install/progress`);
          return mockResponse({ status: 'installing', percent: 0, items: [] });
        }

        if (target.includes('/api/setup/services')) {
          return mockErrorResponse(404, { error: 'Not found' });
        }

        if (/\/api\/services(?:\?|$)/.test(target)) {
          if (target.includes('?includeInstalled=false')) {
            return mockErrorResponse(404, { error: 'Not found' });
          }

          resolvedServicesEndpoint = target.split('?')[0];
          const payload = serviceResponses.shift() ?? refreshedServices;
          return mockResponse(payload);
        }

        return mockResponse({});
      },
    );

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
          selectedServices: string[];
          portalAction: { success: boolean; error: string };
          portalTestEndpoint: string;
        };
      };
    };

    vm.$.setupState.activeStepIndex = 1;
    vm.$.setupState.selectedServices = ['noona-portal', 'noona-vault'];

    await wrapper.vm.$nextTick();

    expect(resolvedServicesEndpoint).not.toBe('');

    const normalizedBase = resolvedServicesEndpoint.replace(/\/+$/, '');
    const expectedInstallEndpoint = `${normalizedBase}/install`;
    const expectedTestEndpoint = `${normalizedBase}/noona-portal/test`;

    const portalTestEndpointFromState = unwrap(
      (vm.$.setupState as Record<string, unknown>).portalTestEndpoint,
    ) as string;
    expect(portalTestEndpointFromState).toBe(expectedTestEndpoint);

    const installButton = wrapper.find('button.setup-step__install');
    expect(installButton.exists()).toBe(true);

    await installButton.trigger('click');

    await flushAsync();
    await wrapper.vm.$nextTick();
    await flushAsync();
    await wrapper.vm.$nextTick();

    const calls = fetchMock.mock.calls.map(([arg]) =>
      typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : '',
    );

    expect(calls).toContain(expectedInstallEndpoint);
    expect(calls).toContain(expectedTestEndpoint);
    expect(vm.$.setupState.portalAction.success).toBe(true);
    expect(vm.$.setupState.portalAction.error).toBe('');
  });

  it('requests a portal restart when the portal step has no selectable services', async () => {
    const installedPayload = cloneServicesPayload();
    for (const service of installedPayload.services) {
      if (service.name === 'noona-portal' || service.name === 'noona-vault') {
        service.installed = true;
      }
    }

    const fetchMock = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (url, init) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';

      if (target.endsWith('/noona-portal/test')) {
        return mockResponse({ success: true });
      }

      if (target.includes('/api/setup/install')) {
        expect(init?.method).toBe('POST');
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        const names = Array.isArray(body?.services)
          ? body.services.map((entry: { name: string }) => entry?.name)
          : [];
        expect(names).toContain('noona-portal');
        return mockResponse({
          results: [
            { name: 'noona-portal', status: 'already-installed' },
            { name: 'noona-vault', status: 'already-installed' },
          ],
        });
      }

      if (target.includes('/api/setup/services/install/progress')) {
        return mockResponse({ status: 'installing', percent: 0, items: [] });
      }

      if (target.includes('/api/setup/services')) {
        return mockResponse(installedPayload);
      }

      return mockResponse({});
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
        };
      };
    };

    vm.$.setupState.activeStepIndex = 1;

    await wrapper.vm.$nextTick();

    const installButton = wrapper.find('button.setup-step__install');
    expect(installButton.exists()).toBe(true);

    await installButton.trigger('click');

    await flushAsync();
    await wrapper.vm.$nextTick();
    await flushAsync();
    await wrapper.vm.$nextTick();

    const calls = fetchMock.mock.calls.map(([arg]) =>
      typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : '',
    );

    expect(calls.some((call) => call.includes('/api/setup/install'))).toBe(true);
  });

  it('surfaces portal install failures before running the test', async () => {
    const initialServices = cloneServicesPayload();

    const fetchMock = vi.fn<(url: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (url, init) => {
        const target =
          typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';

        if (target.endsWith('/noona-portal/test')) {
          throw new Error('Portal test should not run when installation fails');
        }

        if (target.includes('/api/setup/install')) {
          expect(init?.method).toBe('POST');
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Portal install failed' }),
            headers: { get: () => null },
          } as Response;
        }

        if (target.includes('/api/setup/services/install/progress')) {
          return mockResponse({ status: 'installing', percent: 0, items: [] });
        }

        if (target.includes('/api/setup/services')) {
          return mockResponse(initialServices);
        }

        return mockResponse({});
      },
    );

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
          selectedServices: string[];
          portalAction: { error: string; success: boolean };
        };
      };
    };

    vm.$.setupState.activeStepIndex = 1;
    vm.$.setupState.selectedServices = ['noona-portal', 'noona-vault'];

    await wrapper.vm.$nextTick();

    const installButton = wrapper.find('button.setup-step__install');

    expect(installButton.exists()).toBe(true);

    await installButton.trigger('click');

    await flushAsync();
    await wrapper.vm.$nextTick();

    await flushAsync();
    await wrapper.vm.$nextTick();

    const calls = fetchMock.mock.calls.map(([arg]) =>
      typeof arg === 'string' ? arg : arg instanceof URL ? arg.toString() : '',
    );

    const expectedTestEndpoint = unwrap(
      (vm.$.setupState as Record<string, unknown>).portalTestEndpoint,
    ) as string;
    expect(typeof expectedTestEndpoint).toBe('string');

    const testCallIndex = calls.findIndex((call) => call === expectedTestEndpoint);

    expect(testCallIndex).toBe(-1);
    expect(vm.$.setupState.portalAction.success).toBe(false);
    expect(vm.$.setupState.portalAction.error).toBe('Portal install failed');
    expect(wrapper.text()).toContain('Portal install failed');
    expect(wrapper.text()).not.toContain('Portal bot verified successfully.');
  });
});
