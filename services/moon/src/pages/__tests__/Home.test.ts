import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SERVICE_NAVIGATION_CONFIG,
  __resetServiceInstallationStore,
  useServiceInstallationStore,
} from '../../utils/serviceInstallationStore.js';

const push = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ name: 'Home', path: '/' }),
}));

vi.mock('vuetify', () => ({
  useTheme: () => ({
    global: {
      current: { value: { dark: false } },
      name: { value: 'light' },
    },
  }),
}));

const Home = (await import('../Home.vue')).default;

const stubs = {
  'v-app': { template: '<div><slot /></div>' },
  'v-navigation-drawer': { template: '<aside><slot /></aside>' },
  'v-list': { template: '<div><slot /></div>' },
  'v-list-subheader': { template: '<div><slot /></div>' },
  'v-list-item': {
    props: ['prependIcon'],
    emits: ['click'],
    template:
      '<button class="v-list-item" type="button" @click="$emit(\'click\')"><slot /></button>',
  },
  'v-list-item-title': { template: '<span><slot /></span>' },
  'v-list-item-subtitle': { template: '<small><slot /></small>' },
  'v-divider': { template: '<hr />' },
  'v-app-bar': { template: '<header><slot /></header>' },
  'v-app-bar-nav-icon': {
    emits: ['click'],
    template: '<button class="nav-icon" type="button" @click="$emit(\'click\')"></button>',
  },
  'v-img': { template: '<img />' },
  'v-toolbar-title': { template: '<div><slot /></div>' },
  'v-main': { template: '<main><slot /></main>' },
  'v-container': { template: '<div class="v-container"><slot /></div>' },
  'v-row': { template: '<div class="v-row"><slot /></div>' },
  'v-col': { template: '<div class="v-col"><slot /></div>' },
  'v-card': { template: '<section><slot /></section>' },
  'v-card-title': { template: '<h2><slot /></h2>' },
  'v-card-subtitle': { template: '<h3><slot /></h3>' },
  'v-btn': { template: '<button class="v-btn" type="button"><slot /></button>' },
  'v-icon': { template: '<i><slot /></i>' },
  'v-card-actions': { template: '<footer><slot /></footer>' },
};

describe('Home page setup call-to-action', () => {
  beforeEach(() => {
    __resetServiceInstallationStore();
    push.mockClear();
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (global as any).fetch;
  });

  it('shows the Launch Setup Wizard button while installations are pending', async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ services: [] }),
    });

    const store = useServiceInstallationStore();
    await store.refresh();

    const wrapper = mount(Home, {
      global: {
        stubs,
        config: {
          globalProperties: {
            $router: { push },
          },
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Launch Setup Wizard');
  });

  it('hides the Launch Setup Wizard button once all services are installed', async () => {
    const services = SERVICE_NAVIGATION_CONFIG
      .map((item) => item.requiredService)
      .filter((service): service is string => Boolean(service))
      .map((service) => ({ name: service, installed: true }));

    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ services }),
    });

    const store = useServiceInstallationStore();
    await store.refresh();

    const wrapper = mount(Home, {
      global: {
        stubs,
        config: {
          globalProperties: {
            $router: { push },
          },
        },
      },
    });

    await flushPromises();

    expect(wrapper.text()).not.toContain('Launch Setup Wizard');
  });
});
