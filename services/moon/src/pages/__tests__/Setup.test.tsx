import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/testUtils.tsx';
import { waitFor } from '@testing-library/react';
import SetupPage from '../Setup.tsx';
import * as api from '../../setup/api.ts';

vi.mock('../../setup/api.ts', () => {
  return {
    installServices: vi.fn(async () => ({ results: [{ name: 'noona-sage', status: 'queued' }] })),
    fetchInstallProgress: vi.fn(async () => ({ status: 'installing', percent: 10, items: [] })),
    fetchInstallationLogs: vi.fn(async () => ({ entries: [], summary: {} })),
    fetchServiceLogs: vi.fn(async () => ({ entries: [], summary: {} })),
    validatePortalDiscordConfig: vi.fn(async () => ({ guild: { name: 'Test Guild' }, roles: [], channels: [] })),
    createPortalDiscordRole: vi.fn(async () => ({ role: { id: 'role-123' } })),
    createPortalDiscordChannel: vi.fn(async () => ({ channel: { id: 'chan-456' } })),
    detectRavenMount: vi.fn(async () => ({ detection: {} })),
  } satisfies Partial<typeof import('../../setup/api.ts')>;
});

const baseServices = [
  {
    name: 'noona-sage',
    displayName: 'Sage',
    description: 'Monitoring and logging backbone.',
    installed: false,
    recommended: true,
    dependencies: [],
    envConfig: [
      {
        key: 'DEBUG',
        label: 'Debug',
        defaultValue: 'false',
        required: false,
        readOnly: false,
      },
    ],
    metadata: {},
  },
  {
    name: 'noona-portal',
    displayName: 'Portal',
    description: 'Integration hub.',
    installed: false,
    recommended: true,
    dependencies: ['noona-sage'],
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
];

describe('SetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires at least one service to be selected before continuing', async () => {
    const user = userEvent.setup();
    const { getByTestId, getByText } = renderWithProviders(<SetupPage />, {
      services: baseServices,
    });

    const next = getByTestId('setup-next');
    expect(next).not.toBeDisabled();

    await user.click(getByTestId('service-card-noona-sage'));
    await user.click(getByTestId('service-card-noona-portal'));

    expect(getByTestId('setup-next')).toBeDisabled();
    expect(getByText(/select at least one service/i)).toBeInTheDocument();

    await user.click(getByTestId('service-card-noona-sage'));
    expect(getByTestId('setup-next')).not.toBeDisabled();
  });

  it('validates required environment variables before allowing Discord step', async () => {
    const user = userEvent.setup();
    const { getByTestId, getByRole } = renderWithProviders(<SetupPage />, {
      services: baseServices,
    });

    await user.click(getByTestId('setup-next'));

    const botField = getByTestId('env-field-noona-portal-DISCORD_BOT_TOKEN').querySelector('input');
    const guildField = getByTestId('env-field-noona-portal-DISCORD_GUILD_ID').querySelector('input');
    expect(botField).toBeInTheDocument();
    expect(guildField).toBeInTheDocument();

    expect(getByTestId('setup-next')).toBeDisabled();

    await user.type(botField as HTMLInputElement, 'test-token');
    await user.type(guildField as HTMLInputElement, 'guild-123');

    expect(getByTestId('setup-next')).not.toBeDisabled();

    await user.click(getByTestId('setup-next'));

    expect(getByTestId('discord-setup')).toBeInTheDocument();
    expect(getByRole('button', { name: /validate credentials/i })).toBeInTheDocument();
  });

  it('blocks install until Discord credentials are validated', async () => {
    const user = userEvent.setup();
    const { getByTestId, getByRole, queryByTestId } = renderWithProviders(<SetupPage />, {
      services: baseServices,
    });

    await user.click(getByTestId('setup-next'));

    const botField = getByTestId('env-field-noona-portal-DISCORD_BOT_TOKEN').querySelector('input');
    const guildField = getByTestId('env-field-noona-portal-DISCORD_GUILD_ID').querySelector('input');
    await user.type(botField as HTMLInputElement, 'token-abc');
    await user.type(guildField as HTMLInputElement, 'guild-xyz');

    await user.click(getByTestId('setup-next'));

    const validateButton = getByRole('button', { name: /validate credentials/i });
    expect(getByTestId('setup-next')).toBeDisabled();

    await user.click(validateButton);

    await waitFor(() => {
      expect(api.validatePortalDiscordConfig).toHaveBeenCalled();
    });

    expect(queryByTestId('discord-validation-success')).toBeInTheDocument();
    expect(getByTestId('setup-next')).not.toBeDisabled();
  });

  it('triggers installation and displays progress once Discord is validated', async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ delay: null });
    const { getByTestId, getByRole, findByTestId } = renderWithProviders(<SetupPage />, {
      services: baseServices,
    });

    await user.click(getByTestId('setup-next'));

    const botField = getByTestId('env-field-noona-portal-DISCORD_BOT_TOKEN').querySelector('input');
    const guildField = getByTestId('env-field-noona-portal-DISCORD_GUILD_ID').querySelector('input');
    await user.type(botField as HTMLInputElement, 'token');
    await user.type(guildField as HTMLInputElement, 'guild');

    await user.click(getByTestId('setup-next'));
    await user.click(getByRole('button', { name: /validate credentials/i }));

    await waitFor(() => {
      expect(api.validatePortalDiscordConfig).toHaveBeenCalled();
    });

    await user.click(getByTestId('setup-next'));

    await waitFor(() => {
      expect(api.installServices).toHaveBeenCalledTimes(1);
    });

    await vi.runOnlyPendingTimersAsync();

    const statusPanel = await findByTestId('installer-panel');
    expect(statusPanel).toBeInTheDocument();
    expect(api.fetchInstallProgress).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('surfaces installation errors when install request fails', async () => {
    const installError = new Error('Failed to install services.');
    (api.installServices as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(installError);
    const user = userEvent.setup();
    const { getByTestId, getByRole, findByTestId } = renderWithProviders(<SetupPage />, {
      services: baseServices,
    });

    await user.click(getByTestId('setup-next'));
    const botField = getByTestId('env-field-noona-portal-DISCORD_BOT_TOKEN').querySelector('input');
    const guildField = getByTestId('env-field-noona-portal-DISCORD_GUILD_ID').querySelector('input');
    await user.type(botField as HTMLInputElement, 'token');
    await user.type(guildField as HTMLInputElement, 'guild');
    await user.click(getByTestId('setup-next'));
    await user.click(getByRole('button', { name: /validate credentials/i }));
    await waitFor(() => expect(api.validatePortalDiscordConfig).toHaveBeenCalled());

    await user.click(getByTestId('setup-next'));

    const errorAlert = await findByTestId('installer-error');
    expect(errorAlert).toHaveTextContent('Failed to install services.');
  });
});
