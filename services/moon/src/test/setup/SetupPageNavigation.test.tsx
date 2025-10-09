import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
  fetchWizardState: vi.fn(),
  updateWizardState: vi.fn(),
  fetchServiceHealth: vi.fn(async () => ({ status: 'healthy' })),
}));

const services = [
  {
    name: 'noona-vault',
    installed: false,
    envConfig: [
      { key: 'VAULT_ADDRESS', label: 'Vault Address', defaultValue: 'http://vault', required: true, readOnly: false },
    ],
  },
  { name: 'noona-redis', installed: false, envConfig: [] },
  { name: 'noona-mongo', installed: false, envConfig: [] },
  { name: 'noona-portal', installed: false, envConfig: [] },
  { name: 'noona-raven', installed: false, envConfig: [] },
];

const wizardState = {
  version: 1,
  updatedAt: null,
  foundation: {
    status: 'complete' as const,
    detail: JSON.stringify({
      overrides: {
        'noona-vault': { VAULT_ADDRESS: 'http://vault' },
      },
      lastStage: 'health',
      completed: true,
    }),
    error: null,
    updatedAt: null,
    completedAt: null,
  },
  portal: { status: 'pending' as const, detail: null, error: null, updatedAt: null, completedAt: null },
  raven: { status: 'pending' as const, detail: null, error: null, updatedAt: null, completedAt: null },
  verification: { status: 'pending' as const, detail: null, error: null, updatedAt: null, completedAt: null },
};

const api = vi.mocked(await import('../../setup/api.ts'));

describe('SetupPage step navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchWizardState.mockResolvedValue(wizardState);
    api.updateWizardState.mockResolvedValue(wizardState);
  });

  it('allows selecting the next step directly from the stepper', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SetupPage />, { services });

    await waitFor(() => expect(api.fetchWizardState).toHaveBeenCalled());

    const portalStep = await screen.findByTestId('setup-step-portal');
    expect(portalStep).not.toHaveAttribute('aria-current', 'step');

    await user.click(portalStep);

    await waitFor(() => expect(portalStep).toHaveAttribute('aria-current', 'step'));
    expect(await screen.findByText('Step 2 of 4')).toBeInTheDocument();
  });

  it('keeps previously visited steps accessible after returning to an earlier step', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SetupPage />, { services });

    await waitFor(() => expect(api.fetchWizardState).toHaveBeenCalled());

    const portalStep = await screen.findByTestId('setup-step-portal');
    await user.click(portalStep);

    const foundationStep = screen.getByTestId('setup-step-foundation');
    await user.click(foundationStep);
    await waitFor(() => expect(foundationStep).toHaveAttribute('aria-current', 'step'));

    await user.click(portalStep);
    await waitFor(() => expect(portalStep).toHaveAttribute('aria-current', 'step'));
  });

  it('prevents skipping ahead to unvisited steps', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SetupPage />, { services });

    await waitFor(() => expect(api.fetchWizardState).toHaveBeenCalled());

    const foundationStep = await screen.findByTestId('setup-step-foundation');
    const verificationStep = screen.getByTestId('setup-step-verification');

    await user.click(verificationStep);

    await waitFor(() => expect(foundationStep).toHaveAttribute('aria-current', 'step'));
  });
});
