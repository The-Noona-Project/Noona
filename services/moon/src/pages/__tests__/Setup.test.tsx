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
import { fireEvent, waitFor, within, screen } from '@testing-library/react';
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

function clone<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

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

let currentWizardState: typeof defaultWizardState;

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
    currentWizardState = clone(defaultWizardState);
    vi.mocked(api.fetchWizardState).mockImplementation(async () => clone(currentWizardState));
    vi.mocked(api.updateWizardState).mockImplementation(async (updates) => {
      const list = Array.isArray(updates) ? updates : [updates];
      const next = clone(currentWizardState);
      for (const update of list) {
        const stepState = next[update.step];
        if (!stepState) continue;
        if (update.status) {
          stepState.status = update.status as typeof stepState.status;
          if (update.status === 'complete') {
            stepState.completedAt = update.completedAt ?? '2024-01-01T00:00:00.000Z';
          } else {
            stepState.completedAt = null;
          }
        }
        if (Object.prototype.hasOwnProperty.call(update, 'detail')) {
          stepState.detail = update.detail ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(update, 'error')) {
          stepState.error = update.error ?? null;
        }
        stepState.updatedAt = update.updatedAt ?? '2024-01-01T00:00:00.000Z';
      }
      next.updatedAt = new Date().toISOString();
      currentWizardState = next;
      return clone(currentWizardState);
    });
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

  it('restores portal overrides and timestamps from wizard state detail', async () => {
    const portalDetail = JSON.stringify({
      overrides: {
        'noona-portal': {
          DISCORD_BOT_TOKEN: 'persisted-token',
          DISCORD_GUILD_ID: 'persisted-guild',
        },
      },
      discord: {
        validatedAt: '2024-01-01T00:00:00.000Z',
        roleCreatedAt: '2024-01-02T00:00:00.000Z',
        channelCreatedAt: '2024-01-03T00:00:00.000Z',
      },
    });
    currentWizardState.portal = {
      ...currentWizardState.portal,
      detail: portalDetail,
    };

    const user = userEvent.setup();
    const renderResult = renderWithProviders(<SetupPage />, { services: baseServices });

    await waitFor(() => expect(api.fetchWizardState).toHaveBeenCalled());

    await completeFoundation(renderResult, user);

    await waitFor(() =>
      expect(screen.getByTestId('setup-step-portal')).toHaveAttribute('aria-current', 'step'),
    );

    const tokenInput = within(await screen.findByTestId('discord-token')).getByLabelText(
      /Discord Bot Token/i,
    ) as HTMLInputElement;
    expect(tokenInput.value).toBe('persisted-token');

    const guildInput = within(await screen.findByTestId('discord-guild')).getByLabelText(
      /Discord Guild ID/i,
    ) as HTMLInputElement;
    expect(guildInput.value).toBe('persisted-guild');

    expect(await screen.findByTestId('discord-validation-success')).toHaveTextContent(
      /Validated/,
    );
    expect(await screen.findByTestId('discord-role-created')).toHaveTextContent(/Role created/);
    expect(await screen.findByTestId('discord-channel-created')).toHaveTextContent(
      /Channel created/,
    );
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
    let resolvePortalInstall: ((value: { results: Array<Record<string, unknown>> }) => void) | null = null;
    vi.mocked(api.installServices).mockImplementationOnce(() => {
      return new Promise((resolve) => {
        resolvePortalInstall = resolve;
      });
    });

    await user.click(validateButton);
    await waitFor(() => expect(api.validatePortalDiscordConfig).toHaveBeenCalled());

    expect(resolvePortalInstall).not.toBeNull();

    const portalUpdates = vi.mocked(api.updateWizardState).mock.calls.filter((call) => {
      const updates = Array.isArray(call[0]) ? call[0] : [call[0]];
      return updates.some((entry) => entry.step === 'portal');
    });
    expect(portalUpdates.length).toBeGreaterThan(0);
    const portalDetailUpdate = portalUpdates.find((call) => {
      const updates = Array.isArray(call[0]) ? call[0] : [call[0]];
      return updates.some((entry) => entry.step === 'portal' && entry.status === 'in-progress');
    });
    expect(portalDetailUpdate).toBeDefined();
    const portalUpdateEntry = (Array.isArray(portalDetailUpdate?.[0])
      ? portalDetailUpdate?.[0]
      : [portalDetailUpdate?.[0]])
      .find((entry) => entry?.step === 'portal');
    const portalDetail = JSON.parse(portalUpdateEntry?.detail ?? '{}');
    expect(portalDetail?.overrides?.['noona-portal']).toMatchObject({
      DISCORD_BOT_TOKEN: 'test-token',
      DISCORD_GUILD_ID: 'guild-123',
    });

    expect(getByTestId('setup-next')).toBeDisabled();

    const completionTimestamp = new Date().toISOString();
    currentWizardState = {
      ...currentWizardState,
      portal: {
        ...currentWizardState.portal,
        status: 'complete',
        detail: JSON.stringify({
          overrides: {
            'noona-portal': {
              DISCORD_BOT_TOKEN: 'test-token',
              DISCORD_GUILD_ID: 'guild-123',
            },
          },
          discord: { validatedAt: completionTimestamp },
          installTriggeredAt: completionTimestamp,
        }),
        error: null,
        updatedAt: completionTimestamp,
        completedAt: completionTimestamp,
      },
    };

    resolvePortalInstall?.({ results: [] });

    await waitFor(() => expect(getByTestId('setup-next')).not.toBeDisabled());

    await user.click(getByTestId('setup-next'));

    await waitFor(() => expect(api.pullRavenContainer).toHaveBeenCalled());
  });

  it('surfaces portal installation errors and locks the step', async () => {
    const user = userEvent.setup();
    const renderResult = renderWithProviders(<SetupPage />, { services: baseServices });
    const { getByTestId, queryByTestId, findByTestId } = renderResult;

    await waitFor(() => expect(api.fetchWizardState).toHaveBeenCalled());

    await completeFoundation(renderResult, user);

    await waitFor(() => expect(queryByTestId('foundation-panel')).not.toBeInTheDocument());

    const botFieldGroup = within(getByTestId('discord-token')).getAllByLabelText(/Discord Bot Token/i);
    const guildFieldGroup = within(getByTestId('discord-guild')).getAllByLabelText(/Discord Guild ID/i);

    for (const field of botFieldGroup) {
      fireEvent.change(field, { target: { value: 'portal-token' } });
    }

    for (const field of guildFieldGroup) {
      fireEvent.change(field, { target: { value: 'guild-789' } });
    }

    const installError = new Error('Warden is offline');
    vi.mocked(api.installServices).mockRejectedValueOnce(installError);

    const validateButton = await findByTestId('discord-validate');
    await user.click(validateButton);

    await waitFor(() => expect(api.validatePortalDiscordConfig).toHaveBeenCalled());

    await waitFor(() =>
      expect(screen.getByTestId('environment-error')).toHaveTextContent(/warden is offline/i),
    );

    const portalUpdates = vi
      .mocked(api.updateWizardState)
      .mock.calls.flatMap((call) => (Array.isArray(call[0]) ? call[0] : [call[0]]));

    const errorUpdate = portalUpdates.find(
      (update) => update?.step === 'portal' && update.status === 'error',
    );

    expect(errorUpdate?.error).toBe('Warden is offline');

    const portalStep = screen.getByTestId('wizard-step-portal');
    expect(within(portalStep).getByText(/error/i)).toBeInTheDocument();
    expect(getByTestId('setup-next')).toBeDisabled();

    expect(api.installServices).toHaveBeenCalled();
  });
});
