import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetServiceInstallationStore,
  useServiceInstallationStore,
} from '../../utils/serviceInstallationStore.js';

const push = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ name: 'Test Route', path: '/raven' }),
}));

vi.mock('vuetify', () => ({
  useTheme: () => ({
    global: {
      current: { value: { dark: false } },
      name: { value: 'light' },
    },
  }),
}));

const Header = (await import('../Header.vue')).default;

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
};

describe('Header navigation', () => {
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

  it('renders a Raven navigation item that navigates when clicked', async () => {
    (global as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        services: [{ name: 'noona-raven', installed: true }],
      }),
    });

    const store = useServiceInstallationStore();
    await store.refresh();

    const wrapper = mount(Header, {
      global: {
        stubs,
      },
    });

    const ravenItem = wrapper
      .findAll('.v-list-item')
      .find((item) => item.text().includes('Raven'));

    expect(ravenItem).toBeDefined();
    await ravenItem!.trigger('click');
    expect(push).toHaveBeenCalledWith('/raven');
  });
});
