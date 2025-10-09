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
import { fireEvent, waitFor } from '@testing-library/react';
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
    pullRavenContainer: vi.fn(async () => ({})),
    startRavenContainer: vi.fn(async () => ({})),
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
    const { getByTestId, getByRole, findByRole, getByLabelText } = renderWithProviders(<SetupPage />, {
      services: baseServices,
    });

    await user.click(getByTestId('setup-next'));

    const botField = getByLabelText(/Discord Bot Token/i);
    const guildField = getByLabelText(/Discord Guild ID/i);
    expect(botField).toBeInTheDocument();
    expect(guildField).toBeInTheDocument();

    expect(getByTestId('setup-next')).toBeDisabled();

    fireEvent.change(botField, { target: { value: 'test-token' } });
    fireEvent.change(guildField, { target: { value: 'guild-123' } });

    expect((botField as HTMLInputElement).value).toBe('test-token');
    expect((guildField as HTMLInputElement).value).toBe('guild-123');

    await waitFor(() => expect(getByTestId('setup-next')).not.toBeDisabled());

    await user.click(getByTestId('setup-next'));

    expect(getByTestId('discord-setup')).toBeInTheDocument();
    expect(await findByRole('button', { name: /validate credentials/i })).toBeInTheDocument();
  });

  it('blocks install until Discord credentials are validated', async () => {
    const user = userEvent.setup();
    const { getByTestId, getByRole, queryByTestId, findByRole, getByLabelText } = renderWithProviders(
      <SetupPage />,
      {
        services: baseServices,
      },
    );

    await user.click(getByTestId('setup-next'));

    const botField = getByLabelText(/Discord Bot Token/i);
    const guildField = getByLabelText(/Discord Guild ID/i);
    fireEvent.change(botField, { target: { value: 'token-abc' } });
    fireEvent.change(guildField, { target: { value: 'guild-xyz' } });

    expect((botField as HTMLInputElement).value).toBe('token-abc');
    expect((guildField as HTMLInputElement).value).toBe('guild-xyz');

    await waitFor(() => expect(getByTestId('setup-next')).not.toBeDisabled());

    await user.click(getByTestId('setup-next'));

    const validateButton = await findByRole('button', { name: /validate credentials/i });
    expect(getByTestId('setup-next')).toBeDisabled();

    await user.click(validateButton);

    await waitFor(() => {
      expect(api.validatePortalDiscordConfig).toHaveBeenCalled();
    });

    expect(queryByTestId('discord-validation-success')).toBeInTheDocument();
    expect(getByTestId('setup-next')).not.toBeDisabled();
  });

  it('triggers installation and displays progress once Discord is validated', async () => {
    const fetchProgressMock = vi.mocked(api.fetchInstallProgress);
    fetchProgressMock.mockResolvedValueOnce({ status: 'installing', percent: 10, items: [] });
    fetchProgressMock.mockResolvedValueOnce({ status: 'completed', percent: 100, items: [] });

    const user = userEvent.setup({ delay: null });
    const { getByTestId, getByRole, findByTestId, findByRole, getByLabelText } = renderWithProviders(
      <SetupPage />,
      {
        services: baseServices,
      },
    );

    await user.click(getByTestId('setup-next'));

    const botField = getByLabelText(/Discord Bot Token/i);
    const guildField = getByLabelText(/Discord Guild ID/i);
    fireEvent.change(botField, { target: { value: 'token' } });
    fireEvent.change(guildField, { target: { value: 'guild' } });

    expect((botField as HTMLInputElement).value).toBe('token');
    expect((guildField as HTMLInputElement).value).toBe('guild');

    await waitFor(() => expect(getByTestId('setup-next')).not.toBeDisabled());

    await user.click(getByTestId('setup-next'));
    await user.click(await findByRole('button', { name: /validate credentials/i }));

    await waitFor(() => {
      expect(api.validatePortalDiscordConfig).toHaveBeenCalled();
    });

    await waitFor(() => expect(getByTestId('setup-next')).not.toBeDisabled());

    await user.click(getByTestId('setup-next'));

    expect(getByTestId('install-step')).toBeInTheDocument();

    await waitFor(() => expect(getByTestId('setup-next')).not.toBeDisabled());

    await user.click(getByTestId('setup-next'));

    await waitFor(() => {
      expect(api.installServices).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(api.fetchInstallProgress).toHaveBeenCalled();
    });

    const statusPanel = await findByTestId('installer-panel');
    expect(statusPanel).toBeInTheDocument();
  });

  it('surfaces installation errors when install request fails', async () => {
    const installError = new Error('Failed to install services.');
    (api.installServices as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(installError);
    const user = userEvent.setup();
    const { getByTestId, getByRole, findByTestId, findByRole, getByLabelText } = renderWithProviders(
      <SetupPage />,
      {
        services: baseServices,
      },
    );

    await user.click(getByTestId('setup-next'));
    const botField = getByLabelText(/Discord Bot Token/i);
    const guildField = getByLabelText(/Discord Guild ID/i);
    fireEvent.change(botField, { target: { value: 'token' } });
    fireEvent.change(guildField, { target: { value: 'guild' } });

    expect((botField as HTMLInputElement).value).toBe('token');
    expect((guildField as HTMLInputElement).value).toBe('guild');

    await waitFor(() => expect(getByTestId('setup-next')).not.toBeDisabled());

    await user.click(getByTestId('setup-next'));
    await user.click(await findByRole('button', { name: /validate credentials/i }));
    await waitFor(() => expect(api.validatePortalDiscordConfig).toHaveBeenCalled());

    await waitFor(() => expect(getByTestId('setup-next')).not.toBeDisabled());

    await user.click(getByTestId('setup-next'));

    expect(getByTestId('install-step')).toBeInTheDocument();

    await waitFor(() => expect(getByTestId('setup-next')).not.toBeDisabled());

    await user.click(getByTestId('setup-next'));

    await waitFor(() => {
      expect(api.installServices).toHaveBeenCalled();
    });

    const errorAlert = await findByTestId('installer-error');
    expect(errorAlert).toHaveTextContent('Failed to install services.');
  });

  it('pulls and starts Raven when environment is confirmed', async () => {
    const user = userEvent.setup();
    const services = [
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
        name: 'noona-raven',
        displayName: 'Raven',
        description: 'Downloader.',
        installed: false,
        recommended: true,
        dependencies: [],
        envConfig: [
          {
            key: 'APPDATA',
            label: 'Raven Downloads Root',
            defaultValue: '',
            required: false,
            readOnly: false,
          },
          {
            key: 'KAVITA_DATA_MOUNT',
            label: 'Kavita Data Mount',
            defaultValue: '',
            required: false,
            readOnly: false,
          },
        ],
        metadata: {},
      },
    ];

    const pullMock = vi.mocked(api.pullRavenContainer);
    const startMock = vi.mocked(api.startRavenContainer);

    const { getByTestId, getByLabelText } = renderWithProviders(<SetupPage />, {
      services,
    });

    await user.click(getByTestId('setup-next'));

    const appDataField = getByLabelText(/Raven Downloads Root/i);
    const mountField = getByLabelText(/Kavita Data Mount/i);

    fireEvent.change(appDataField, { target: { value: '/downloads' } });
    fireEvent.change(mountField, { target: { value: '/srv/kavita' } });

    await user.click(getByTestId('setup-next'));

    await waitFor(() => {
      expect(pullMock).toHaveBeenCalledWith({
        APPDATA: '/downloads',
        KAVITA_DATA_MOUNT: '/srv/kavita',
      });
      expect(startMock).toHaveBeenCalledWith({
        APPDATA: '/downloads',
        KAVITA_DATA_MOUNT: '/srv/kavita',
      });
    });

    expect(getByTestId('install-step')).toBeInTheDocument();
  });
});
