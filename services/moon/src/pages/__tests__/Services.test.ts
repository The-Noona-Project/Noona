import {describe, expect, it} from 'vitest';
import {mount} from '@vue/test-utils';
import Warden from '../Warden.vue';
import Vault from '../Vault.vue';
import Portal from '../Portal.vue';
import Sage from '../Sage.vue';
import MoonService from '../MoonService.vue';
import Oracle from '../Oracle.vue';

const mountWithLayout = (component: any) =>
  mount(component, {
    global: {
      stubs: {
        Header: {
          template: '<div><slot /></div>',
        },
      },
    },
  });

describe('Service summary pages', () => {
  it('renders Warden summary', () => {
    const wrapper = mountWithLayout(Warden);
    expect(wrapper.text()).toContain(
      'Orchestrator for the entire stack. Builds Docker images, provisions containers, enforces boot order, performs health checks, and manages rolling updates across master and node deployments.',
    );
  });

  it('renders Vault summary', () => {
    const wrapper = mountWithLayout(Vault);
    expect(wrapper.text()).toContain(
      'Authentication and data access gateway. Issues JWTs to services, brokers reads/writes to MongoDB and Redis, and secures internal APIs.',
    );
  });

  it('renders Portal summary', () => {
    const wrapper = mountWithLayout(Portal);
    expect(wrapper.text()).toContain(
      "External integrations hub. Handles Discord command logic, listens for guild events, and bridges to Kavita's APIs.",
    );
  });

  it('renders Sage summary', () => {
    const wrapper = mountWithLayout(Sage);
    expect(wrapper.text()).toContain(
      'Monitoring and logging backbone using Prometheus for metrics collection and Grafana for visualization.',
    );
  });

  it('renders Moon service summary', () => {
    const wrapper = mountWithLayout(MoonService);
    expect(wrapper.text()).toContain(
      'Web-based control center built with React. Provides dashboards for admins and readers, Discord authentication, AI chat, request management, and service status.',
    );
  });

  it('renders Oracle summary', () => {
    const wrapper = mountWithLayout(Oracle);
    expect(wrapper.text()).toContain(
      'AI assistant layer powered by LangChain, LocalAI/AnythingLLM for conversational insights and recommendations.',
    );
  });
});
