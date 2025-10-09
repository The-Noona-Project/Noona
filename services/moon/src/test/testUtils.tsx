import React from 'react';
import { ChakraProvider } from '@chakra-ui/react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import theme from '../theme.js';
import {
  ServiceInstallationProvider,
  type ServiceInstallationProviderProps,
} from '../state/serviceInstallationContext.tsx';

interface RenderOptions {
  services?: ServiceInstallationProviderProps['initialServices'];
  fetchServices?: ServiceInstallationProviderProps['fetchServices'];
  initialEntries?: string[];
}

export function renderWithProviders(
  ui: React.ReactElement,
  { services = [], fetchServices, initialEntries = ['/'] }: RenderOptions = {},
) {
  const providerFetch: ServiceInstallationProviderProps['fetchServices'] =
    fetchServices ?? (async () => services ?? []);

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ChakraProvider theme={theme}>
        <ServiceInstallationProvider initialServices={services} fetchServices={providerFetch}>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </ServiceInstallationProvider>
      </ChakraProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}
