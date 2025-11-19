import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { vi } from 'vitest';
import VerificationPanel from '../VerificationPanel.tsx';
import type { InstallState, VerificationState } from '../../useSetupSteps.ts';
import { createMockWizardState } from '../../../test/testUtils.tsx';
import { OneUIProvider } from '../../../theme/index.jsx';

describe('VerificationPanel', () => {
  const baseInstall: InstallState = {
    started: false,
    installing: false,
    completed: false,
    error: '',
    progressError: '',
    results: [],
    progress: null,
  };

  const createVerificationState = (overrides: Partial<VerificationState> = {}): VerificationState => ({
    loading: false,
    running: false,
    completing: false,
    error: '',
    summary: {
      lastRunAt: '2024-01-01T00:00:00.000Z',
      checks: [
        {
          service: 'noona-vault',
          label: 'Vault',
          success: true,
          supported: true,
          status: 'pass',
          message: 'Vault health check succeeded.',
          detail: null,
          checkedAt: '2024-01-01T00:00:00.000Z',
          duration: 150,
        },
        {
          service: 'noona-raven',
          label: 'Raven',
          success: false,
          supported: true,
          status: 'fail',
          message: 'Raven test failed.',
          detail: null,
          checkedAt: '2024-01-01T00:05:00.000Z',
          duration: 230,
        },
      ],
    },
    health: {
      warden: {
        service: 'noona-warden',
        status: 'ok',
        message: 'Warden responded successfully.',
        checkedAt: '2024-01-01T00:10:00.000Z',
        success: true,
        detail: null,
      },
      sage: {
        service: 'noona-sage',
        status: 'error',
        message: 'Unable to reach Sage.',
        checkedAt: '2024-01-01T00:11:00.000Z',
        success: false,
        detail: null,
      },
    },
    ...overrides,
  });

  const renderPanel = (props: Parameters<typeof VerificationPanel>[0]) =>
    render(
      <OneUIProvider disableThemeInjection>
        <VerificationPanel {...props} />
      </OneUIProvider>,
    );

  it('renders verification health and check summaries', () => {
    renderPanel({
      install: baseInstall,
      verification: createVerificationState(),
      wizardState: createMockWizardState({
        verification: {
          status: 'error',
          detail: null,
          error: 'Verification checks reported failures.',
          updatedAt: '2024-01-01T00:05:00.000Z',
          completedAt: null,
        },
      }),
      wizardLoading: false,
      onRefresh: vi.fn(),
      onRunChecks: vi.fn(),
      onComplete: vi.fn(),
    });

    expect(screen.getByTestId('verification-health-warden')).toHaveTextContent('Warden');
    expect(screen.getByTestId('verification-health-sage')).toHaveTextContent('Unable to reach Sage.');
    expect(screen.getByText('Vault')).toBeInTheDocument();
    expect(screen.getByText('Raven test failed.')).toBeInTheDocument();
  });

  it('disables completion when the wizard step is not marked complete', async () => {
    const user = userEvent.setup();
    renderPanel({
      install: baseInstall,
      verification: createVerificationState({
        summary: {
          lastRunAt: '2024-01-01T00:00:00.000Z',
          checks: [
            {
              service: 'noona-warden',
              label: 'Warden',
              success: true,
              supported: true,
              status: 'pass',
              message: 'All good.',
              detail: null,
              checkedAt: '2024-01-01T00:00:00.000Z',
              duration: 40,
            },
          ],
        },
      }),
      wizardState: createMockWizardState({
        verification: {
          status: 'pending',
          detail: null,
          error: null,
          updatedAt: '2024-01-01T00:00:00.000Z',
          completedAt: null,
        },
      }),
      wizardLoading: false,
      onRefresh: vi.fn(),
      onRunChecks: vi.fn(),
      onComplete: vi.fn(),
    });

    const completeButton = screen.getByTestId('verification-complete');
    expect(completeButton).toBeDisabled();
    await user.hover(completeButton);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Verification step must reach the "complete" state');
  });

  it('enables completion when checks pass and the wizard step is complete', async () => {
    const onComplete = vi.fn();
    const onRunChecks = vi.fn();
    const user = userEvent.setup();
    renderPanel({
      install: baseInstall,
      verification: createVerificationState({
        summary: {
          lastRunAt: '2024-01-01T00:00:00.000Z',
          checks: [
            {
              service: 'noona-warden',
              label: 'Warden',
              success: true,
              supported: true,
              status: 'pass',
              message: 'All good.',
              detail: null,
              checkedAt: '2024-01-01T00:00:00.000Z',
              duration: 40,
            },
          ],
        },
      }),
      wizardState: createMockWizardState({
        verification: {
          status: 'complete',
          detail: null,
          error: null,
          updatedAt: '2024-01-01T00:00:00.000Z',
          completedAt: '2024-01-01T00:00:00.000Z',
        },
      }),
      wizardLoading: false,
      onRefresh: vi.fn(),
      onRunChecks,
      onComplete,
    });

    const runButton = screen.getByTestId('verification-run');
    await user.click(runButton);
    expect(onRunChecks).toHaveBeenCalledTimes(1);

    const completeButton = screen.getByTestId('verification-complete');
    expect(completeButton).toBeEnabled();
    await user.click(completeButton);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
