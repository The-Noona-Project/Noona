import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import { OneUIProvider } from '../theme/index.jsx';
import {
  ServiceInstallationProvider,
  type ServiceInstallationProviderProps,
} from '../state/serviceInstallationContext.tsx';
import type { WizardState, WizardStepState } from '../setup/api.ts';

function createWizardStepState(overrides: Partial<WizardStepState> = {}): WizardStepState {
  return {
    status: 'pending',
    detail: null,
    error: null,
    updatedAt: null,
    completedAt: null,
    actor: null,
    retries: 0,
    timeline: [],
    ...overrides,
  } satisfies WizardStepState;
}

export function createMockWizardState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    version: 1,
    updatedAt: null,
    completed: false,
    foundation: createWizardStepState(),
    portal: createWizardStepState(),
    raven: createWizardStepState(),
    verification: createWizardStepState(),
    ...overrides,
  } satisfies WizardState;
}

interface RenderOptions {
  services?: ServiceInstallationProviderProps['initialServices'];
  fetchServices?: ServiceInstallationProviderProps['fetchServices'];
  wizardState?: WizardState | null;
  fetchWizardState?: ServiceInstallationProviderProps['fetchWizardState'];
  initialEntries?: string[];
  oneUI?: {
    themeURL?: string;
    ponyfillOptions?: Record<string, unknown>;
    maxThemeWait?: number;
    disableThemeInjection?: boolean;
  };
}

export function renderWithProviders(
  ui: React.ReactElement,
  {
    services = [],
    fetchServices,
    wizardState,
    fetchWizardState,
    initialEntries = ['/'],
    oneUI,
  }: RenderOptions = {},
) {
  const providerFetch: ServiceInstallationProviderProps['fetchServices'] =
    fetchServices ?? (async () => services ?? []);
  const hasWizardOverride = wizardState !== undefined;
  const resolvedWizardState = hasWizardOverride ? wizardState : null;

  function Wrapper({ children }: { children: React.ReactNode }) {
    const wizardProps = hasWizardOverride
      ? { initialWizardState: resolvedWizardState ?? null }
      : {};
    const wizardFetchProps = fetchWizardState ? { fetchWizardState } : {};

    return (
      <OneUIProvider {...(oneUI ?? {})}>
        <ServiceInstallationProvider
          initialServices={services}
          fetchServices={providerFetch}
          {...wizardProps}
          {...wizardFetchProps}
        >
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </ServiceInstallationProvider>
      </OneUIProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}
