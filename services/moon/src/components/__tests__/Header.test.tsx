import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import Header from '../../components/Header.jsx';
import { createMockWizardState, renderWithProviders } from '../../test/testUtils.tsx';

describe('Header navigation', () => {
  it('renders the Raven navigation item when the service is installed', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Header title="Dashboard">
        <div />
      </Header>,
      {
        services: [{ name: 'noona-raven', installed: true }],
        initialEntries: ['/'],
      },
    );

    await user.click(screen.getByLabelText(/open navigation/i));

    const ravenButton = await screen.findByRole('button', { name: /raven/i });
    expect(ravenButton).toBeInTheDocument();
  });

  it('omits the Setup navigation link once the wizard is completed', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Header title="Dashboard">
        <div />
      </Header>,
      {
        services: [
          { name: 'noona-warden', installed: true },
          { name: 'noona-vault', installed: true },
          { name: 'noona-portal', installed: true },
          { name: 'noona-sage', installed: true },
          { name: 'noona-moon', installed: true },
          { name: 'noona-raven', installed: true },
          { name: 'noona-oracle', installed: true },
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
      },
    );

    await user.click(screen.getByLabelText(/open navigation/i));

    expect(screen.queryByRole('button', { name: /setup/i })).not.toBeInTheDocument();
  });

  it('retains the Setup navigation link until the wizard is finished', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Header title="Dashboard">
        <div />
      </Header>,
      {
        services: [
          { name: 'noona-warden', installed: true },
          { name: 'noona-vault', installed: true },
          { name: 'noona-portal', installed: true },
          { name: 'noona-sage', installed: true },
          { name: 'noona-moon', installed: true },
          { name: 'noona-raven', installed: true },
          { name: 'noona-oracle', installed: true },
        ],
        wizardState: createMockWizardState({ completed: false }),
        initialEntries: ['/'],
      },
    );

    await user.click(screen.getByLabelText(/open navigation/i));

    expect(screen.getByRole('button', { name: /setup/i })).toBeInTheDocument();
  });
});
