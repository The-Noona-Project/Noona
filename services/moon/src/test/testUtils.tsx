import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import theme from '../theme.js';
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
}

export function renderWithProviders(
  ui: React.ReactElement,
  {
    services = [],
    fetchServices,
    wizardState,
    fetchWizardState,
    initialEntries = ['/'],
  }: RenderOptions = {},
) {
  const providerFetch: ServiceInstallationProviderProps['fetchServices'] =
    fetchServices ?? (async () => services ?? []);
  const resolvedWizardState =
    wizardState === undefined ? createMockWizardState() : wizardState;
  const providerWizardFetch: ServiceInstallationProviderProps['fetchWizardState'] =
    fetchWizardState ?? (async () => resolvedWizardState ?? createMockWizardState());

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ChakraProvider theme={theme}>
        <ServiceInstallationProvider
          initialServices={services}
          fetchServices={providerFetch}
          initialWizardState={resolvedWizardState ?? null}
          fetchWizardState={providerWizardFetch}
        >
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </ServiceInstallationProvider>
      </ChakraProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}
