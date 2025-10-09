import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@zag-js/focus-visible', () => ({
  __esModule: true,
  trackFocusVisible: () => () => {},
  trackInteractionModality: () => () => {},
  getInteractionModality: () => null,
  setInteractionModality: () => {},
}));
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/testUtils.tsx';
import { fireEvent, waitFor, within } from '@testing-library/react';
import SetupPage from '../Setup.tsx';
import * as api from '../../setup/api.ts';

vi.mock('../../setup/api.ts', () => {
  return {
    installServices: vi.fn(async () => ({ results: [{ name: 'noona-vault', status: 'queued' }] })),
    fetchInstallProgress: vi.fn(async () => ({ status: 'installing', percent: 10, items: [] })),
    fetchInstallationLogs: vi.fn(async () => ({ entries: [], summary: {} })),
    fetchServiceLogs: vi.fn(async () => ({ entries: [], summary: {} })),
    fetchWizardState: vi.fn(),
    updateWizardState: vi.fn(),
    validatePortalDiscordConfig: vi.fn(async () => ({ guild: { name: 'Test Guild' }, roles: [], channels: [] })),
    createPortalDiscordRole: vi.fn(async () => ({ role: { id: 'role-123' } })),
    createPortalDiscordChannel: vi.fn(async () => ({ channel: { id: 'chan-456' } })),
    pullRavenContainer: vi.fn(async () => ({})),
    startRavenContainer: vi.fn(async () => ({})),
    fetchServiceHealth: vi.fn(async () => ({ status: 'healthy' })),
  } satisfies Partial<typeof import('../../setup/api.ts')>;
});

const defaultWizardState = {
  version: 1,
  updatedAt: null,
  foundation: { status: 'pending', detail: null, error: null, updatedAt: null, completedAt: null },
  portal: { status: 'pending', detail: null, error: null, updatedAt: null, completedAt: null },
  raven: { status: 'pending', detail: null, error: null, updatedAt: null, completedAt: null },
  verification: { status: 'pending', detail: null, error: null, updatedAt: null, completedAt: null },
};

const baseServices = [
  {
    name: 'noona-vault',
    displayName: 'Vault',
    description: 'Secrets manager.',
    installed: false,
    recommended: true,
    dependencies: [],
    envConfig: [
      {
        key: 'VAULT_ADDRESS',
        label: 'Vault Address',
        defaultValue: '',
        required: true,
        readOnly: false,
      },
    ],
    metadata: {},
  },
  {
    name: 'noona-redis',
    displayName: 'Redis',
    description: 'Caching layer.',
    installed: false,
    recommended: true,
    dependencies: [],
    envConfig: [],
    metadata: {},
  },
  {
    name: 'noona-mongo',
    displayName: 'Mongo',
    description: 'Database.',
    installed: false,
    recommended: true,
    dependencies: [],
    envConfig: [],
    metadata: {},
  },
  {
    name: 'noona-portal',
    displayName: 'Portal',
    description: 'Integration hub.',
    installed: false,
    recommended: true,
    dependencies: [],
    envConfig: [
      {
        key: 'DISCORD_BOT_TOKEN',
        label: 'Discord Bot Token',
        defaultValue: '',
        required: true,
        readOnly: false,
      },
      {
        key: 'DISCORD_GUILD_ID',
        label: 'Discord Guild ID',
        defaultValue: '',
        required: true,
        readOnly: false,
      },
    ],
    metadata: {},
  },
  {
    name: 'noona-raven',
    displayName: 'Raven',
    description: 'Downloader.',
    installed: false,
    recommended: true,
    dependencies: [],
    envConfig: [],
    metadata: {},
  },
];

async function completeFoundation({ getByTestId, getByLabelText }: ReturnType<typeof renderWithProviders>, user: ReturnType<typeof userEvent.setup>) {
  const addressField = getByLabelText(/vault address/i);
  fireEvent.change(addressField, { target: { value: 'http://vault.local' } });
  await user.click(getByTestId('setup-next'));
  await waitFor(() => {
    expect(api.installServices).toHaveBeenCalled();
    expect(api.fetchServiceHealth).toHaveBeenCalled();
  });
}

describe('SetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchWizardState).mockResolvedValue(defaultWizardState);
    vi.mocked(api.updateWizardState).mockResolvedValue(defaultWizardState);
    vi.mocked(api.fetchServiceHealth).mockResolvedValue({ status: 'healthy' });
  });

  it('bootstraps foundation services and advances to portal configuration', async () => {
    const user = userEvent.setup();
    const renderResult = renderWithProviders(<SetupPage />, {
      services: baseServices,
    });
    const { getByTestId, getByLabelText, queryByTestId } = renderResult;

    await waitFor(() => expect(api.fetchWizardState).toHaveBeenCalled());

    const addressField = getByLabelText(/vault address/i);
    fireEvent.change(addressField, { target: { value: 'http://vault.internal' } });

    await user.click(getByTestId('setup-next'));

    await waitFor(() => {
      expect(api.installServices).toHaveBeenCalledWith([
        { name: 'noona-vault', env: { VAULT_ADDRESS: 'http://vault.internal' } },
        { name: 'noona-redis' },
        { name: 'noona-mongo' },
      ]);
      expect(api.fetchServiceHealth).toHaveBeenCalledWith('noona-redis');
    });

    const updateCalls = vi.mocked(api.updateWizardState).mock.calls;
    expect(updateCalls[0]?.[0]).toMatchObject({ step: 'foundation', status: 'in-progress' });
    expect(updateCalls.at(-1)?.[0]).toMatchObject({ step: 'foundation', status: 'complete' });

    await waitFor(() => {
      expect(queryByTestId('foundation-panel')).not.toBeInTheDocument();
    });

    const discordTokenFields = within(getByTestId('discord-token')).getAllByLabelText(/Discord Bot Token/i);
    expect(discordTokenFields.length).toBeGreaterThan(0);
  });

  it('displays foundation error when bootstrap fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.installServices).mockRejectedValueOnce(new Error('boom'));

    const { getByTestId, getAllByText, getByLabelText } = renderWithProviders(<SetupPage />, {
      services: baseServices,
    });

    await waitFor(() => expect(api.fetchWizardState).toHaveBeenCalled());

    const addressField = getByLabelText(/vault address/i);
    fireEvent.change(addressField, { target: { value: 'http://vault.internal' } });
    await user.click(getByTestId('setup-next'));

    await waitFor(() => {
      expect(getAllByText(/boom/i).length).toBeGreaterThan(0);
    });
    expect(getByTestId('setup-next')).not.toHaveTextContent(/launch raven/i);
  });

  it('restores foundation overrides from wizard state detail', async () => {
    const detail = JSON.stringify({
      overrides: {
        'noona-vault': { VAULT_ADDRESS: 'http://vault.cached' },
      },
      lastStage: 'persist',
    });
    vi.mocked(api.fetchWizardState).mockResolvedValue({
      ...defaultWizardState,
      foundation: { ...defaultWizardState.foundation, detail },
    });

    const { getByLabelText } = renderWithProviders(<SetupPage />, {
      services: baseServices,
    });

    await waitFor(() => expect(api.fetchWizardState).toHaveBeenCalled());

    const addressField = getByLabelText(/vault address/i) as HTMLInputElement;
    expect(addressField.value).toBe('http://vault.cached');
  });

  it('requires Discord validation before installing Raven', async () => {
    const user = userEvent.setup();
    const renderResult = renderWithProviders(<SetupPage />, {
      services: baseServices,
    });
    const { getByTestId, getByLabelText, queryByTestId, findByTestId } = renderResult;

    await waitFor(() => expect(api.fetchWizardState).toHaveBeenCalled());

    await completeFoundation(renderResult, user);

    await waitFor(() => expect(queryByTestId('foundation-panel')).not.toBeInTheDocument());

    const botFieldGroup = within(getByTestId('discord-token')).getAllByLabelText(/Discord Bot Token/i);
    const guildFieldGroup = within(getByTestId('discord-guild')).getAllByLabelText(/Discord Guild ID/i);

    for (const field of botFieldGroup) {
      fireEvent.change(field, { target: { value: 'test-token' } });
    }

    for (const field of guildFieldGroup) {
      fireEvent.change(field, { target: { value: 'guild-123' } });
    }

    expect(getByTestId('setup-next')).toBeDisabled();

    const validateButton = await findByTestId('discord-validate');
    await user.click(validateButton);
    await waitFor(() => expect(api.validatePortalDiscordConfig).toHaveBeenCalled());
    await waitFor(() => expect(getByTestId('setup-next')).not.toBeDisabled());
    await user.click(getByTestId('setup-next'));

    await waitFor(() => expect(api.pullRavenContainer).toHaveBeenCalled());
  });
});
