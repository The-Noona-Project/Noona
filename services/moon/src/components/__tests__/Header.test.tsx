import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import Header from '../../components/Header.jsx';
import { renderWithProviders } from '../../test/testUtils.tsx';

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

  it('omits the Setup navigation link when no services are pending', async () => {
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
        initialEntries: ['/'],
      },
    );

    expect(screen.queryByRole('button', { name: /setup/i })).not.toBeInTheDocument();
  });
});
