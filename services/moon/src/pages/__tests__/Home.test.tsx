import { screen, waitFor } from '@testing-library/react';
import React from 'react';
import HomePage from '../../pages/Home.jsx';
import { createMockWizardState, renderWithProviders } from '../../test/testUtils.tsx';

describe('Home page service cards', () => {
  it('enables service navigation when the dependency is installed', async () => {
    renderWithProviders(<HomePage />, {
      services: [{ name: 'noona-raven', installed: true }],
      initialEntries: ['/'],
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /view raven/i })).toBeEnabled();
    });
  });

  it('disables service navigation when installation is pending', async () => {
    renderWithProviders(<HomePage />, {
      services: [],
      initialEntries: ['/'],
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /view raven/i })).toBeDisabled();
    });
  });

  it('shows the setup wizard button while services are pending', async () => {
    renderWithProviders(<HomePage />, {
      services: [],
      initialEntries: ['/'],
    });

    await waitFor(() => {
      expect(screen.getByTestId('launch-setup')).toBeInTheDocument();
    });
  });

  it('hides the setup wizard button once the wizard is completed', async () => {
    renderWithProviders(<HomePage />, {
      services: [
        { name: 'noona-warden', installed: true },
        { name: 'noona-vault', installed: true },
        { name: 'noona-portal', installed: true },
        { name: 'noona-sage', installed: true },
        { name: 'noona-moon', installed: true },
      ],
      wizardState: createMockWizardState({
        completed: true,
        verification: {
          status: 'complete',
          detail: null,
          error: null,
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      }),
      initialEntries: ['/'],
    });

    await waitFor(() => {
      expect(screen.queryByTestId('launch-setup')).not.toBeInTheDocument();
    });
  });
});
