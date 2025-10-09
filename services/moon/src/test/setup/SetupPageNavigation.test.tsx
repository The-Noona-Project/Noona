import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SetupPage from '../../pages/Setup.tsx';
import { renderWithProviders } from '../testUtils.tsx';

vi.mock('../../setup/api.ts', () => ({
  fetchInstallProgress: vi.fn(async () => ({ status: 'idle', percent: 0, items: [] })),
  fetchInstallationLogs: vi.fn(async () => ({ entries: [] })),
  fetchServiceLogs: vi.fn(async () => ({ entries: [] })),
  installServices: vi.fn(async () => ({ results: [] })),
  createPortalDiscordChannel: vi.fn(async () => ({})),
  createPortalDiscordRole: vi.fn(async () => ({})),
  pullRavenContainer: vi.fn(async () => ({})),
  startRavenContainer: vi.fn(async () => ({})),
  validatePortalDiscordConfig: vi.fn(async () => ({})),
}));

const services = [
  { name: 'noona-portal', installed: false },
  { name: 'noona-raven', installed: false },
];

describe('SetupPage step navigation', () => {
  it('allows selecting the next step directly from the stepper', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SetupPage />, { services });

    const configureStep = await screen.findByTestId('setup-step-configure');
    expect(configureStep).not.toHaveAttribute('aria-current', 'step');

    await user.click(configureStep);

    expect(configureStep).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
  });

  it('keeps previously visited steps accessible after returning to an earlier step', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SetupPage />, { services });

    const configureStep = await screen.findByTestId('setup-step-configure');
    await user.click(configureStep);

    const selectStep = screen.getByTestId('setup-step-select');
    await user.click(selectStep);
    expect(selectStep).toHaveAttribute('aria-current', 'step');

    await user.click(configureStep);
    expect(configureStep).toHaveAttribute('aria-current', 'step');
  });

  it('prevents skipping ahead to unvisited steps', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SetupPage />, { services });

    const selectStep = await screen.findByTestId('setup-step-select');
    const installStep = screen.getByTestId('setup-step-install');

    await user.click(installStep);

    expect(selectStep).toHaveAttribute('aria-current', 'step');
  });
});

